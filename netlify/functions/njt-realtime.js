// ─── NJT Schedule Function ───────────────────────────────────────
// Fetches schedule data from NJ Transit's API for any station pair.
// Uses the getTrainScheduleJSON endpoint for real schedule lookups.
// Falls back to GTFS static data cached in memory.
// ─────────────────────────────────────────────────────────────────

const API_BASE = "https://raildata.njtransit.com/api/GTFSRT";

// ─── TOKEN CACHE ─────────────────────────────────────────────────
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

// ─── SCHEDULE DATA SOURCE ────────────────────────────────────────
// NJ Transit's DepartureVision / TrainSchedule API
// Base URL for the XML/JSON schedule endpoints
const SCHEDULE_API = "https://datasource.njtransit.com/service/publicXMLFeed";

async function fetchScheduleFromAPI(origin, destination, scheduleType) {
  // Use the NJT public feed — this returns departure vision data
  // We need to use the developer API credentials
  const username = process.env.NJT_API_USER || process.env.NJT_USERNAME;
  const password = process.env.NJT_API_PASS || process.env.NJT_PASSWORD;

  // Try the getTrainScheduleJSON endpoint  
  const url = `https://datasource.njtransit.com/service/publicXMLFeed?command=getTrainScheduleJSON&NJT_Only=&station=${origin}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      },
    });
    
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (e) {
    console.log("Schedule API unavailable:", e.message);
  }
  
  return null;
}

// ─── HANDLER ─────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300", // Cache 5 minutes
  };

  try {
    const params = event.queryStringParameters || {};
    const origin = params.origin;
    const destination = params.destination;
    
    if (!origin || !destination) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Missing 'origin' and/or 'destination' query parameters. Use station abbreviations (e.g., 'MP' for Maplewood, 'NY' for NY Penn).",
          timestamp: Date.now(),
        }),
      };
    }

    // Try to get schedule from NJT API
    const apiData = await fetchScheduleFromAPI(origin, destination);
    
    if (apiData) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          source: "api",
          origin,
          destination,
          data: apiData,
          timestamp: Date.now(),
        }),
      };
    }

    // If API fails, return a message indicating to use embedded schedules
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        source: "unavailable",
        origin,
        destination,
        message: "Schedule API unavailable. App will use embedded schedule data.",
        timestamp: Date.now(),
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
