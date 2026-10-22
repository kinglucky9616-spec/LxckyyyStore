export default async function handler(req, res) { // Accept POST requests only if (req.method !== "POST") { return res.status(405).json({ error: "Method not allowed" }); }
// Validate request origin const origin = req.headers.origin; const host = req.headers.host;
try { if (!origin || new URL(origin).host !== host) { return res.status(403).json({ error: "Invalid origin" }); } } catch { return res.status(403).json({ error: "Invalid origin" }); }
// Allow only known events const allowedEvents = new Set([ "PageView", "JoinTelegram", "ContactAdmin" ]);
const { event_name, event_id } = req.body || {};
// FIX 1: Correct validation operators if ( !allowedEvents.has(event_name)  typeof event_id !== "string"  event_id.length < 1 || event_id.length > 100 ) { return res.status(400).json({ error: "Invalid event data" }); }
// Read Vercel environment variables const token = process.env.META_CAPI_ACCESS_TOKEN; const pixelId = process.env.META_PIXEL_ID;
if (!token || !pixelId) { return res.status(500).json({ error: "Server configuration missing" }); }
// Read request metadata const forwardedFor = req.headers["x-forwarded-for"]; const clientIp = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : "";
const userAgent = req.headers["user-agent"] || "";
if (!clientIp || !userAgent) { return res.status(400).json({ error: "Missing request metadata" }); }
// Create the Meta event const event = { event_name, event_time: Math.floor(Date.now() / 1000), event_id, action_source: "website", event_source_url: origin, user_data: { client_ip_address: clientIp, client_user_agent: userAgent } };
const payload = { data: [event] };
if (process.env.META_CAPI_TEST_EVENT_CODE) { payload.test_event_code = process.env.META_CAPI_TEST_EVENT_CODE; }
try { // FIX 2: Correct URL template string const url = https://graph.facebook.com/v26.0/${encodeURIComponent(pixelId)}/events + ?access_token=${encodeURIComponent(token)};
const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

const result = await response.json();

if (!response.ok) {
  console.error("Meta CAPI error:", result);

  return res.status(502).json({
    error: "Meta rejected the event"
  });
}

return res.status(200).json({
  success: true,
  events_received: result.events_received
});} catch (error) { console.error("Meta CAPI request failed:", error);
return res.status(502).json({
  error: "Could not send event to Meta"
});} }
