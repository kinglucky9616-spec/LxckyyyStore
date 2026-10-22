// Vercel serverless endpoint: /api/meta-capi // Required environment variables: // META_PIXEL_ID, META_CAPI_ACCESS_TOKEN // Optional: META_CAPI_TEST_EVENT_CODE
export default async function handler(req, res) { if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
const origin = req.headers.origin; const host = req.headers.host;
// Validate the browser request origin. if (origin) { try { const originUrl = new URL(origin); const requestHost = String(host || "") .split(":")[0] .toLowerCase();
  if (
    originUrl.protocol !== "https:" &&
    originUrl.protocol !== "http:"
  ) {
    return res.status(403).json({
      error: "Invalid origin"
    });
  }

  if (
    !requestHost ||
    originUrl.hostname.toLowerCase() !== requestHost
  ) {
    return res.status(403).json({
      error: "Invalid origin"
    });
  }
} catch {
  return res.status(403).json({
    error: "Invalid origin"
  });
}} else { return res.status(403).json({ error: "Missing origin" }); }
const allowedEvents = new Set([ "PageView", "JoinTelegram", "ContactAdmin" ]);
const body = req.body && typeof req.body === "object" ? req.body : {};
const eventName = body.event_name; const eventId = body.event_id;
if ( typeof eventName !== "string"  !allowedEvents.has(eventName)  typeof eventId !== "string"  eventId.length < 1  eventId.length > 100 ) { return res.status(400).json({ error: "Invalid event data" }); }
const pixelId = process.env.META_PIXEL_ID; const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
if (!pixelId || !accessToken) { console.error("Meta CAPI configuration is missing"); return res.status(500).json({ error: "Server configuration missing" }); }
const clientIp = String( req.headers["x-forwarded-for"] || "" ).split(",")[0].trim();
const userAgent = String( req.headers["user-agent"] || "" );
const eventSourceUrl = typeof body.event_source_url === "string" && body.event_source_url.startsWith(origin) ? body.event_source_url : origin + "/";
const userData = { client_user_agent: userAgent };
if (clientIp) { userData.client_ip_address = clientIp; }
const payload = { data: [ { event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId, action_source: "website", event_source_url: eventSourceUrl, user_data: userData } ] };
if (process.env.META_CAPI_TEST_EVENT_CODE) { payload.test_event_code = process.env.META_CAPI_TEST_EVENT_CODE; }
try { const endpoint = "https://graph.facebook.com/v26.0/" + encodeURIComponent(pixelId) + "/events?access_token=" + encodeURIComponent(accessToken);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

const result = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(
    "Meta CAPI rejected event:",
    JSON.stringify(result)
  );

  return res.status(502).json({
    error: "Meta rejected the event"
  });
}

return res.status(200).json({
  success: true,
  events_received: result.events_received ?? 0
});} catch (error) { console.error( "Meta CAPI request failed:", error?.message || "Unknown error" );
return res.status(502).json({
  error: "Could not send event to Meta"
});} }
