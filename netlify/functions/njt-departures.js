// ─── NJT DepartureVision Function (V2 API) ───────────────────────
// Uses raildata.njtransit.com/api/TrainData (same server as GTFS-RT)
// Returns track numbers, live status, GPS, and capacity data.
// ─────────────────────────────────────────────────────────────────

const API_BASE = "https://raildata.njtransit.com/api/TrainData";

// Station 2-character codes (from V2 API docs Appendix V)
const STATION_CODES = {
  pennstation: "NY", secaucus: "SE", hoboken: "HB", newark_broad: "ND",
  east_orange: "EO", brick_church: "BU", orange: "OG", highland_ave: "HI",
  south_orange: "SO", maplewood: "MW", millburn: "MB", short_hills: "RT",
  summit: "ST", chatham: "CM", madison: "MA", convent_station: "CN",
  morristown: "MR", morris_plains: "MX", mt_tabor: "TB", denville: "DV",
  dover: "DO", murray_hill: "MH", new_providence: "NV", berkeley_heights: "BY",
  gillette: "GI", stirling: "SG", millington: "GO", lyons: "LY",
  basking_ridge: "BI", bernardsville: "BV", far_hills: "FH", peapack: "PC",
  gladstone: "GL", bay_street: "MC", walnut_street: "WA", watchung_ave: "WG",
  upper_montclair: "UM", mountain_ave: "MS", montclair_state: "UV",
  little_falls: "FA", wayne_rt23: "23", mountain_view: "MV",
  lincoln_park: "LP", towaco: "TO", boonton: "BN",
};

// Token cache
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const username = process.env.NJT_USERNAME;
  const password = process.env.NJT_PASSWORD;

  if (!username || !password) {
    throw new Error("NJT_USERNAME and NJT_PASSWORD not set");
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
    tokenExpiry = Date.now() + 20 * 60 * 60 * 1000; // 20 hours
    return cachedToken;
  }

  throw new Error("Auth failed: " + JSON.stringify(data));
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=20",
  };

  try {
    const params = event.queryStringParameters || {};
    const stationId = params.station;

    if (!stationId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Missing 'station' parameter.",
          available: Object.keys(STATION_CODES),
        }),
      };
    }

    const stationCode = STATION_CODES[stationId];
    if (!stationCode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Unknown station '${stationId}'.` }),
      };
    }

    const token = await getToken();

    // Call getTrainSchedule19Rec — DepartureVision data without stop lists (lighter)
    const formData = new FormData();
    formData.append("token", token);
    formData.append("station", stationCode);
    formData.append("line", "");

    const res = await fetch(`${API_BASE}/getTrainSchedule19Rec`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error(`DV API returned ${res.status}`);

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error("Could not parse DV response: " + raw.substring(0, 300));
    }

    // Parse the V2 response
    // Structure: { STATION_2CHAR, STATIONNAME, STATIONMSGS: [], ITEMS: [...] }
    const items = data.ITEMS || [];
    const messages = data.STATIONMSGS || [];

    const departures = [];
    for (const item of items) {
      if (!item) continue;

      const dep = {
        trainId: item.TRAIN_ID || "",
        destination: item.DESTINATION || "",
        scheduledTime: item.SCHED_DEP_DATE || "",
        status: item.STATUS || "",
        track: (item.TRACK || "").trim(),
        line: item.LINE || "",
        lineCode: item.LINECODE || "",
        lineAbbrev: item.LINEABBREVIATION || "",
        direction: item.STATION_POSITION || "",
        secLate: parseInt(item.SEC_LATE || "0", 10),
        lastModified: item.LAST_MODIFIED || "",
        gpsLat: item.GPSLATITUDE || "",
        gpsLng: item.GPSLONGITUDE || "",
        inlineMsg: item.INLINEMSG || "",
        delayMinutes: 0,
        isApproaching: false,
        isCancelled: false,
      };

      // Parse status
      const status = (dep.status || "").toUpperCase();
      if (status.includes("CANCEL")) {
        dep.isCancelled = true;
      } else if (status.includes("MIN")) {
        const match = status.match(/(\d+)/);
        if (match) dep.delayMinutes = parseInt(match[1]);
      } else if (status.includes("BOARD") || status === "NOW" || status.includes("0 MIN")) {
        dep.isApproaching = true;
      }

      // Calculate delay from SEC_LATE
      if (dep.secLate > 120) {
        dep.delayMinutes = Math.round(dep.secLate / 60);
      }

      departures.push(dep);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        station: stationId,
        stationCode,
        stationName: data.STATIONNAME || "",
        timestamp: Date.now(),
        count: departures.length,
        departures,
        messages: messages.filter(m => m.MSG_TYPE !== "fullscreen").map(m => ({
          type: m.MSG_TYPE,
          text: m.MSG_TEXT,
          date: m.MSG_PUBDATE,
        })),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, timestamp: Date.now() }),
    };
  }
};
