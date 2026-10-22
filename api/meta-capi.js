export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

    if (!pixelId || !accessToken) {
      console.error("Missing META_PIXEL_ID or META_CAPI_ACCESS_TOKEN");
      return res.status(500).json({
        error: "Meta API environment variables are missing"
      });
    }

    const body = req.body || {};
    const allowedEvents = [
      "PageView",
      "JoinTelegram",
      "ContactAdmin"
    ];

    const eventName = body.event_name;
    const eventId = body.event_id;

    if (
      typeof eventName !== "string" ||
      !allowedEvents.includes(eventName) ||
      typeof eventId !== "string" ||
      eventId.length < 1 ||
      eventId.length > 100
    ) {
      return res.status(400).json({
        error: "Invalid event_name or event_id"
      });
    }

    const headers = req.headers || {};
    const forwardedFor = headers["x-forwarded-for"];
    const clientIp = typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : "";

    const userAgent = String(headers["user-agent"] || "");
    const sourceUrl = typeof body.event_source_url === "string"
      ? body.event_source_url
      : "https://" + String(headers.host || "");

    const userData = {
      client_user_agent: userAgent
    };

    if (clientIp) {
      userData.client_ip_address = clientIp;
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: "website",
          event_source_url: sourceUrl,
          user_data: userData
        }
      ]
    };

    const testCode = process.env.META_CAPI_TEST_EVENT_CODE;
    if (testCode) {
      payload.test_event_code = testCode;
    }

    const url =
      "https://graph.facebook.com/v26.0/" +
      encodeURIComponent(pixelId) +
      "/events?access_token=" +
      encodeURIComponent(accessToken);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Meta API error:", JSON.stringify(result));
      return res.status(502).json({
        error: "Meta API rejected the event",
        details: result
      });
    }

    return res.status(200).json({
      success: true,
      events_received: result.events_received || 0,
      messages: result.messages || []
    });
  } catch (error) {
    console.error("Meta CAPI error:", error?.stack || error);

    return res.status(500).json({
      error: "Meta CAPI request failed"
    });
  }
}
