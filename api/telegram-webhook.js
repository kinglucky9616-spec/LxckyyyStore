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

    console.log("TELEGRAM_UPDATE_RECEIVED", {
      updateTypes: Object.keys(update),
      hasChatMember: Boolean(update.chat_member)
    });

    const change = update.chat_member;

    if (!change) {
      return res.status(200).json({ ok: true });
    }

    const oldMember = change.old_chat_member || {};
    const newMember = change.new_chat_member || {};

  console.log("TELEGRAM_CHAT_MEMBER_EVENT", {
  chatId: change.chat?.id,
  chatTitle: change.chat?.title,
  oldStatus: oldMember.status,
  newStatus: newMember.status,
  userId: newMember.user?.id
});

    function isMember(member) {
      if (
        ["member", "administrator", "creator"].includes(
          member.status
        )
      ) {
        return true;
      }

      return (
        member.status === "restricted" &&
        member.is_member === true
      );
    }

    if (!isMember(oldMember) && isMember(newMember)) {
      const chatId = change.chat && change.chat.id;
      const userId = newMember.user && newMember.user.id;

      if (chatId == null || userId == null) {
        console.error("TELEGRAM_JOIN_MISSING_IDS");
        return res.status(200).json({ ok: true });
      }

      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceKey) {
        console.error("TELEGRAM_SUPABASE_CONFIG_MISSING");
        return res.status(500).json({
          error: "Server configuration error"
        });
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/telegram_joins?on_conflict=telegram_chat_id,telegram_user_id`,
        {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify({
            telegram_chat_id: chatId,
            telegram_user_id: userId,
            joined_at: new Date().toISOString()
          })
        }
      );

      if (!response.ok) {
        const details = await response.text();

        console.error("TELEGRAM_SUPABASE_INSERT_FAILED", {
          status: response.status,
          details: details
        });

        return res.status(500).json({
          error: "Database insert failed"
        });
      }

      console.log("TELEGRAM_GROUP_JOIN_SAVED", {
        chatId: chatId,
        userId: userId
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("TELEGRAM_WEBHOOK_RUNTIME_ERROR", {
      message: error.message,
      stack: error.stack
    });

    return res.status(500).json({ error: "Webhook failed" });
  }
}
