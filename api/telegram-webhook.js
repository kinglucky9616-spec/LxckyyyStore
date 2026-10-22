
export default async function handler(req, res) {
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
    const change = update.chat_member;

    if (!change) {
      return res.status(200).json({ ok: true });
    }

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

    // Process only a transition from non-member to member.
    if (isMember(oldMember) || !isMember(newMember)) {
      return res.status(200).json({ ok: true });
    }

    const chatId = change.chat && change.chat.id;
    const userId = newMember.user && newMember.user.id;
    const inviteLink =
      change.invite_link &&
      typeof change.invite_link.invite_link === "string"
        ? change.invite_link.invite_link
        : null;

    if (chatId == null || userId == null) {
      console.error("TELEGRAM_JOIN_MISSING_IDS");
      return res.status(200).json({ ok: true });
    }

    const expectedChatId = process.env.TELEGRAM_CHAT_ID;

    if (expectedChatId && String(chatId) !== String(expectedChatId)) {
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

    // Always save the confirmed Telegram membership.
    const joinResponse = await fetch(
      `${supabaseUrl}/rest/v1/telegram_joins?on_conflict=telegram_chat_id,telegram_user_id`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders,
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          telegram_chat_id: chatId,
          telegram_user_id: userId,
          joined_at: new Date().toISOString()
        })
      }
    );

    if (!joinResponse.ok) {
      const details = await joinResponse.text();
      console.error("TELEGRAM_SUPABASE_INSERT_FAILED", {
        status: joinResponse.status,
        details
      });

      return res.status(500).json({
        error: "Database insert failed"
      });
    }

    console.log("TELEGRAM_GROUP_JOIN_SAVED", {
      chatId,
      userId,
      hasInviteLink: Boolean(inviteLink)
    });

    // A tracked invite connects the join to the landing-page visitor.
    if (!inviteLink) {
      console.warn("TELEGRAM_JOIN_WITHOUT_INVITE_LINK", { userId });
      return res.status(200).json({
        ok: true,
        saved: true,
        tracked: false
      });
    }

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

    // Stable ID helps prevent duplicate Meta events on webhook retries.
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
