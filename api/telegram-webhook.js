
export default async function handler(req, res) {
  console.log("TELEGRAM_WEBHOOK_REQUEST_RECEIVED", {
    method: req.method,
    hasBody: Boolean(req.body),
    hasSecretHeader: Boolean(
      req.headers["x-telegram-bot-api-secret-token"]
    )
  });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const suppliedSecret =
      req.headers["x-telegram-bot-api-secret-token"];

    if (!secret || suppliedSecret !== secret) {
      console.error("TELEGRAM_WEBHOOK_SECRET_MISMATCH");
      return res.status(403).json({ error: "Forbidden" });
    }

    const update = req.body || {};
    const request = update.chat_join_request || null;
    const change = update.chat_member || null;

    if (!request && !change) {
      return res.status(200).json({ ok: true });
    }

    const chat = request ? request.chat : change.chat;
    const chatId = chat && chat.id;
    const expectedChatId = process.env.TELEGRAM_CHAT_ID;

    if (chatId == null) {
      console.error("TELEGRAM_UPDATE_MISSING_CHAT_ID");
      return res.status(200).json({ ok: true });
    }

    if (
      expectedChatId &&
      String(chatId) !== String(expectedChatId)
    ) {
      console.warn("TELEGRAM_UNEXPECTED_CHAT", { chatId });
      return res.status(200).json({ ok: true });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.error("TELEGRAM_SUPABASE_CONFIG_MISSING");
      return res.status(500).json({
        error: "Server configuration error"
      });
    }

    const supabaseHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    };

    function getInviteLink(updateObject) {
      const link = updateObject?.invite_link?.invite_link;
      return typeof link === "string" ? link : null;
    }

    // A join request is NOT a confirmed membership.
    // Save its invite link so approval can be attributed later.
    if (request) {
      const userId = request.from && request.from.id;
      const inviteLink = getInviteLink(request);

      if (userId == null) {
        console.error("TELEGRAM_JOIN_REQUEST_MISSING_USER_ID");
        return res.status(200).json({ ok: true });
      }

      const pendingResponse = await fetch(
        `${supabaseUrl}/rest/v1/telegram_join_requests?on_conflict=telegram_chat_id,telegram_user_id`,
        {
          method: "POST",
          headers: {
            ...supabaseHeaders,
            Prefer: "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify({
            telegram_chat_id: chatId,
            telegram_user_id: userId,
            invite_link: inviteLink,
            requested_at: new Date().toISOString()
          })
        }
      );

      if (!pendingResponse.ok) {
        console.error("TELEGRAM_JOIN_REQUEST_SAVE_FAILED", {
          status: pendingResponse.status,
          details: await pendingResponse.text()
        });

        return res.status(500).json({
          error: "Could not save join request"
        });
      }

      console.log("TELEGRAM_JOIN_REQUEST_SAVED", {
        chatId,
        userId,
        hasInviteLink: Boolean(inviteLink)
      });

      return res.status(200).json({
        ok: true,
        requestSaved: true,
        confirmed: false
      });
    }

    // From here onward, process chat_member updates only.
    const oldMember = change.old_chat_member || {};
    const newMember = change.new_chat_member || {};

    function isMember(member) {
      if (
        ["member", "administrator", "creator"].includes(member.status)
      ) {
        return true;
      }

      return (
        member.status === "restricted" &&
        member.is_member === true
      );
    }

    // Only a transition from non-member to member counts.
    // A pending request alone never reaches this point.
    if (isMember(oldMember) || !isMember(newMember)) {
      return res.status(200).json({ ok: true });
    }

    const userId = newMember.user && newMember.user.id;

    if (userId == null) {
      console.error("TELEGRAM_JOIN_MISSING_USER_ID");
      return res.status(200).json({ ok: true });
    }

    // Prefer the invite link on the approval update, if provided.
    let inviteLink = getInviteLink(change);

    // Otherwise recover the invite link saved with the join request.
    const pendingLookupUrl = new URL(
      `${supabaseUrl}/rest/v1/telegram_join_requests`
    );
    pendingLookupUrl.searchParams.set(
      "telegram_chat_id",
      `eq.${chatId}`
    );
    pendingLookupUrl.searchParams.set(
      "telegram_user_id",
      `eq.${userId}`
    );
    pendingLookupUrl.searchParams.set("select", "invite_link");
    pendingLookupUrl.searchParams.set("limit", "1");

    const pendingResponse = await fetch(
      pendingLookupUrl.toString(),
      {
        method: "GET",
        headers: supabaseHeaders
      }
    );

    if (!pendingResponse.ok) {
      console.error("TELEGRAM_PENDING_LOOKUP_FAILED", {
        status: pendingResponse.status,
        details: await pendingResponse.text()
      });

      return res.status(500).json({
        error: "Could not look up pending request"
      });
    }

    const pendingRows = await pendingResponse.json();
    const pending = pendingRows[0];

    if (!inviteLink && pending?.invite_link) {
      inviteLink = pending.invite_link;
    }

    // Insert only once. Do not overwrite the original join record
    // or send another conversion if this user rejoins later.
    const joinResponse = await fetch(
      `${supabaseUrl}/rest/v1/telegram_joins?on_conflict=telegram_chat_id,telegram_user_id`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders,
          Prefer: "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify({
          telegram_chat_id: chatId,
          telegram_user_id: userId,
          joined_at: new Date().toISOString()
        })
      }
    );

    if (!joinResponse.ok) {
      console.error("TELEGRAM_SUPABASE_INSERT_FAILED", {
        status: joinResponse.status,
        details: await joinResponse.text()
      });

      return res.status(500).json({
        error: "Database insert failed"
      });
    }

    const insertedRows = await joinResponse.json();

    // Empty result means this membership was already recorded.
    if (!Array.isArray(insertedRows) || insertedRows.length === 0) {
      console.log("TELEGRAM_JOIN_ALREADY_RECORDED", {
        chatId,
        userId
      });

      return res.status(200).json({
        ok: true,
        saved: false,
        duplicate: true,
        metaSent: false
      });
    }

    console.log("TELEGRAM_GROUP_JOIN_SAVED", {
      chatId,
      userId,
      hasInviteLink: Boolean(inviteLink)
    });

    // Remove the pending request after membership is recorded.
    const deletePendingUrl = new URL(
      `${supabaseUrl}/rest/v1/telegram_join_requests`
    );
    deletePendingUrl.searchParams.set(
      "telegram_chat_id",
      `eq.${chatId}`
    );
    deletePendingUrl.searchParams.set(
      "telegram_user_id",
      `eq.${userId}`
    );

    const deletePendingResponse = await fetch(
      deletePendingUrl.toString(),
      {
        method: "DELETE",
        headers: supabaseHeaders
      }
    );

    if (!deletePendingResponse.ok) {
      console.error("TELEGRAM_PENDING_DELETE_FAILED", {
        status: deletePendingResponse.status
      });
    }

    if (!inviteLink) {
      console.warn("TELEGRAM_JOIN_WITHOUT_INVITE_LINK", { userId });

      return res.status(200).json({
        ok: true,
        saved: true,
        tracked: false
      });
    }

    // Find the website visitor associated with this invite link.
    const lookupUrl = new URL(
      `${supabaseUrl}/rest/v1/telegram_invite_tracking`
    );
    lookupUrl.searchParams.set("invite_link", `eq.${inviteLink}`);
    lookupUrl.searchParams.set(
      "select",
      "fbp,fbc,client_ip_address,client_user_agent,event_source_url"
    );
    lookupUrl.searchParams.set("limit", "1");

    const trackingResponse = await fetch(lookupUrl.toString(), {
      method: "GET",
      headers: supabaseHeaders
    });

    if (!trackingResponse.ok) {
      console.error("INVITE_TRACKING_LOOKUP_FAILED", {
        status: trackingResponse.status,
        details: await trackingResponse.text()
      });

      return res.status(200).json({
        ok: true,
        saved: true,
        tracked: false
      });
    }

    const trackingRows = await trackingResponse.json();
    const tracking = trackingRows[0];

    if (!tracking) {
      console.warn("INVITE_LINK_NOT_FOUND_IN_TRACKING_TABLE");

      return res.status(200).json({
        ok: true,
        saved: true,
        tracked: false
      });
    }

    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

    if (!pixelId || !accessToken) {
      console.error("META_CAPI_CONFIG_MISSING");

      return res.status(200).json({
        ok: true,
        saved: true,
        tracked: true,
        metaSent: false
      });
    }

    const userData = {};

    if (tracking.fbp) userData.fbp = tracking.fbp;
    if (tracking.fbc) userData.fbc = tracking.fbc;

    if (tracking.client_ip_address) {
      userData.client_ip_address = tracking.client_ip_address;
    }

    if (tracking.client_user_agent) {
      userData.client_user_agent = tracking.client_user_agent;
    }

    const eventId = `telegram_join_${chatId}_${userId}`;

    const event = {
      event_name: "TelegramJoinConfirmed",
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      event_source_url:
        tracking.event_source_url || "https://luckystore7.vercel.app/",
      user_data: userData,
      custom_data: {
        telegram_chat_id: String(chatId)
      }
    };

    const payload = { data: [event] };

    if (process.env.META_CAPI_TEST_EVENT_CODE) {
      payload.test_event_code = process.env.META_CAPI_TEST_EVENT_CODE;
    }

    const metaResponse = await fetch(
      `https://graph.facebook.com/v26.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const metaResult = await metaResponse.json().catch(() => ({}));

    if (!metaResponse.ok) {
      console.error("TELEGRAM_META_CAPI_FAILED", {
        status: metaResponse.status,
        result: metaResult
      });

      return res.status(200).json({
        ok: true,
        saved: true,
        tracked: true,
        metaSent: false
      });
    }

    console.log("TELEGRAM_JOIN_CONFIRMED_SENT_TO_META", {
      eventsReceived: metaResult.events_received,
      eventId
    });

    return res.status(200).json({
      ok: true,
      saved: true,
      tracked: true,
      metaSent: true
    });
  } catch (error) {
    console.error("TELEGRAM_WEBHOOK_RUNTIME_ERROR", {
      message: error.message
    });

    return res.status(500).json({ error: "Webhook failed" });
  }
}

