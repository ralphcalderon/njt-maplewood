const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

// ─── CONFIG ──────────────────────────────────────────────────────
const API_BASE = "https://raildata.njtransit.com/api/GTFSRT";

// ─── TOKEN CACHE (in-memory, per function instance) ──────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const username = process.env.NJT_USERNAME;
  const password = process.env.NJT_PASSWORD;

  if (!username || !password) {
    throw new Error("NJT_USERNAME and NJT_PASSWORD environment variables not set");
  }

  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);

  const res = await fetch(`${API_BASE}/getToken`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json();

  if (data.Authenticated === "True" && data.UserToken) {
    cachedToken = data.UserToken;
    tokenExpiry = Date.now() + 20 * 60 * 60 * 1000;
    return cachedToken;
  }

  throw new Error("Authentication failed: " + JSON.stringify(data));
}

async function fetchProtobuf(endpoint, token) {
  const formData = new FormData();
  formData.append("token", token);

  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${endpoint} failed (${res.status}): ${text}`);
  }

  const buffer = await res.arrayBuffer();
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );
}

// ─── HANDLER ─────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=30",
  };

  try {
    // Accept stop IDs and route filter from query params
    const params = event.queryStringParameters || {};
    const stopIds = params.stops ? params.stops.split(",") : [];
    const stopName = (params.stopName || "").toLowerCase();
    const routeFilter = params.routes ? params.routes.split(",") : [];

    if (stopIds.length === 0 && !stopName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Missing 'stops' or 'stopName' query parameter",
          timestamp: Date.now(),
        }),
      };
    }

    const token = await getToken();

    const [tripFeed, alertFeed] = await Promise.all([
      fetchProtobuf("getTripUpdates", token),
      fetchProtobuf("getAlerts", token).catch(() => null),
    ]);

    // Parse trip updates — extract stop time updates matching requested stop
    const trips = [];

    if (tripFeed && tripFeed.entity) {
      for (const entity of tripFeed.entity) {
        const tu = entity.tripUpdate;
        if (!tu || !tu.stopTimeUpdate) continue;

        const tripId = tu.trip?.tripId || "";
        const routeId = tu.trip?.routeId || "";
        const startDate = tu.trip?.startDate || "";
        const scheduleRelationship = tu.trip?.scheduleRelationship || 0;

        for (const stu of tu.stopTimeUpdate) {
          const sid = String(stu.stopId);
          const sidLower = sid.toLowerCase();

          // Match by stop ID or by stop name substring
          const matchById = stopIds.some(id => sid === id || sid === id.toString());
          const matchByName = stopName && sidLower.includes(stopName);

          if (matchById || matchByName) {
            const arrival = stu.arrival;
            const departure = stu.departure;

            trips.push({
              tripId,
              routeId,
              startDate,
              stopId: sid,
              cancelled: scheduleRelationship === 3,
              arrivalDelay: arrival?.delay || 0,
              arrivalTime: arrival?.time ? Number(arrival.time) : null,
              departureDelay: departure?.delay || 0,
              departureTime: departure?.time ? Number(departure.time) : null,
              scheduleRelationship: stu.scheduleRelationship || 0,
            });
          }
        }
      }
    }

    // Parse alerts — filter by route if specified
    const alerts = [];
    if (alertFeed && alertFeed.entity) {
      for (const entity of alertFeed.entity) {
        const alert = entity.alert;
        if (!alert) continue;

        let affectsUs = true;
        if (routeFilter.length > 0) {
          affectsUs = alert.informedEntity?.some((ie) => {
            const rid = (ie.routeId || "").toLowerCase();
            return routeFilter.some(rf => rid.includes(rf.toLowerCase()));
          });
        }

        if (affectsUs) {
          alerts.push({
            headerText: alert.headerText?.translation?.[0]?.text || "",
            descriptionText: alert.descriptionText?.translation?.[0]?.text || "",
            cause: alert.cause || 0,
            effect: alert.effect || 0,
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        timestamp: Date.now(),
        trips,
        alerts,
        debug: {
          totalEntities: tripFeed?.entity?.length || 0,
          matchedEntities: trips.length,
          requestedStops: stopIds,
          requestedStopName: stopName,
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message,
        timestamp: Date.now(),
      }),
    };
  }
};
