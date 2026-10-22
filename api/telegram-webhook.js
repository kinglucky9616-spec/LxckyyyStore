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

  const update = req.body;

  if (update?.chat_member) {
    const change = update.chat_member;
    const oldStatus = change.old_chat_member?.status;
    const newStatus = change.new_chat_member?.status;

    const wasMember =
      ["member", "administrator", "creator"].includes(oldStatus) ||
      (oldStatus === "restricted" &&
        change.old_chat_member?.is_member === true);

    const isMember =
      ["member", "administrator", "creator"].includes(newStatus) ||
      (newStatus === "restricted" &&
        change.new_chat_member?.is_member === true);

    if (!wasMember && isMember) {
      console.log("TELEGRAM_GROUP_JOIN", {
        chatId: change.chat?.id,
        userId: change.new_chat_member?.user?.id,
        date: new Date().toISOString()
      });
    }
  }

  return res.status(200).json({ ok: true });
}
