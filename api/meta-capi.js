export default async function handler(req, res) { if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
const origin = req.headers.origin; const host = req.headers.host;
try { if (!origin  !host  new URL(origin).host !== host) { return res.status(403).json({ error: "Invalid origin" }); } } catch { return res.status(403).json({ error: "Invalid origin" }); }
const allowedEvents = [ "PageView", "JoinTelegram", "ContactAdmin" ];
const body = req.body || {}; const eventName = body.event_name; const eventId = body.event_id;
if ( !allowedEvents.includes(eventName)  typeof eventId !== "string"  eventId.length < 1 || eventId.length > 100 ) { return res.status(400).json({ error: "Invalid event data" }); }
const token = process.env.META_CAPI_ACCESS_TOKEN; const pixelId = process.env.META_PIXEL_ID;
if (!token || !pixelId) { console.error("Meta CAPI configuration is missing"); return res.status(500).json({ error: "Server configuration missing" }); }
const forwardedFor = req.headers["x-forwarded-for"]; const clientIp = String(forwardedFor || "") .split(",")[0] .trim();
const userAgent = String(req.headers["user-agent"] || "");
if (!clientIp || !userAgent) { return res.status(400).json({ error: "Missing request metadata" }); }
const event = { event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId, action_source: "website", event_source_url: origin, user_data: { client_ip_address: clientIp, client_user_agent: userAgent } };
const payload = { data: [event] }; const testCode = process.env.META_CAPI_TEST_EVENT_CODE;
if (testCode) { payload.test_event_code = testCode; }
try { const endpoint = "https://graph.facebook.com/v26.0/" + encodeURIComponent(pixelId) + "/events?access_token=" + encodeURIComponent(token);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

const result = await response.json();

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
  events_received: result.events_received
});} catch (error) { console.error( "Meta CAPI request failed:", error.message );
return res.status(502).json({
  error: "Could not send event to Meta"
});} }
