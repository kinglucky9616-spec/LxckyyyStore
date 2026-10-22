export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const suppliedSecret =
    req.headers["x-telegram-bot-api-secret-token"];

  if (!secret || suppliedSecret !== secret) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const update = req.body || {};

  console.log("TELEGRAM_UPDATE_RECEIVED", {
    updateTypes: Object.keys(update),
    hasChatMember: Boolean(update.chat_member)
  });

  const change = update.chat_member;
console.log("TELEGRAM_MEMBER_STATUS", {
  oldStatus: change.old_chat_member?.status,
  newStatus: change.new_chat_member?.status,
  oldIsMember: change.old_chat_member?.is_member,
  newIsMember: change.new_chat_member?.is_member
});
    const isMember = (member) =>
      ["member", "administrator", "creator"].includes(member?.status) ||
      (member?.status === "restricted" && member?.is_member === true);

    const wasMember = isMember(oldMember);
    const nowMember = isMember(newMember);

    if (!wasMember && nowMember) {
      const chatId = change.chat?.id;
      const userId = newMember?.user?.id;
      const joinedAt = new Date().toISOString();

      if (chatId == null || userId == null) {
        console.error("Telegram join missing chat or user ID");
        return res.status(200).json({ ok: true });
      }

      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceKey) {
        console.error("Supabase server configuration is missing");
        return res.status(500).json({ error: "Server configuration error" });
      }

      try {
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
              joined_at: joinedAt
            })
          }
        );

        if (!response.ok) {
          console.error("Supabase insert failed", response.status);
          return res.status(500).json({ error: "Database insert failed" });
        }

        console.log("TELEGRAM_GROUP_JOIN_SAVED", {
          chatId,
          joinedAt
        });
      } catch (error) {
        console.error("Telegram join database request failed");
        return res.status(500).json({ error: "Database request failed" });
      }
    }
  }

  return res.status(200).json({ ok: true });
}
