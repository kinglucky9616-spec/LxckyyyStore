
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!botToken || !chatId || !supabaseUrl || !serviceKey) {
      console.error("INVITE_CONFIG_MISSING");
      return res.status(500).json({
        error: "Server configuration error"
      });
    }

    const body = req.body || {};
    const fbp = typeof body.fbp === "string" ? body.fbp : null;
    const fbc = typeof body.fbc === "string" ? body.fbc : null;
    const userAgent = req.headers["user-agent"] || null;

    const forwardedFor = req.headers["x-forwarded-for"];
    const clientIp =
      typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim()
        : null;

    const eventSourceUrl =
      typeof body.event_source_url === "string"
        ? body.event_source_url
        : null;

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/createChatInviteLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          member_limit: 1
        })
      }
    );

    const telegramResult = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramResult.ok) {
      console.error("TELEGRAM_INVITE_CREATE_FAILED", {
        description: telegramResult.description
      });

      return res.status(502).json({
        error: "Could not create Telegram invite link"
      });
    }

    const inviteLink = telegramResult.result.invite_link;

    const saveResponse = await fetch(
      `${supabaseUrl}/rest/v1/telegram_invite_tracking`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          invite_link: inviteLink,
          fbp,
          fbc,
          client_ip_address: clientIp,
          client_user_agent: userAgent,
          event_source_url: eventSourceUrl
        })
      }
    );

    if (!saveResponse.ok) {
      const details = await saveResponse.text();

      console.error("INVITE_TRACKING_SAVE_FAILED", {
        status: saveResponse.status,
        details
      });

      return res.status(500).json({
        error: "Could not save invite tracking"
      });
    }

    return res.status(200).json({
      invite_link: inviteLink
    });
  } catch (error) {
    console.error("CREATE_INVITE_RUNTIME_ERROR", {
      message: error.message
    });

    return res.status(500).json({
      error: "Internal server error"
    });
  }
}
