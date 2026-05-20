// ─── NJT DepartureVision Function ────────────────────────────────
// Fetches real-time departure board data from NJ Transit's
// getTrainScheduleJSON endpoint. Returns track numbers, live status,
// and the next 19 departures from any station.
// ─────────────────────────────────────────────────────────────────

const DV_BASE = "http://traindata.njtransit.com:8092/njttraindata.asmx";

// Station 2-character codes (from NJT API docs)
const STATION_CODES = {
  pennstation: "NY", secaucus: "SE", hoboken: "HB", newark_broad: "NB",
  east_orange: "EO", brick_church: "BC", orange: "OR", highland_ave: "HA",
  south_orange: "SO", maplewood: "MP", millburn: "MB", short_hills: "SH",
  summit: "SM", chatham: "CH", madison: "MA", convent_station: "CV",
  morristown: "MT", morris_plains: "MR", mt_tabor: "TB", denville: "DV",
  dover: "DO", murray_hill: "MH", new_providence: "NP", berkeley_heights: "BH",
  gillette: "GL", stirling: "ST", millington: "MI", lyons: "LY",
  basking_ridge: "BR", bernardsville: "BN", far_hills: "FH", peapack: "PK",
  gladstone: "GD", bay_street: "BY", walnut_street: "WS", watchung_ave: "WA",
  upper_montclair: "UM", mountain_ave: "MN", montclair_state: "MS",
  little_falls: "LF", wayne_rt23: "WR", mountain_view: "MV",
  lincoln_park: "LP", towaco: "TO", boonton: "BO",
};

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

    const username = process.env.NJT_DV_USERNAME || process.env.NJT_USERNAME;
    const password = process.env.NJT_DV_PASSWORD || process.env.NJT_PASSWORD;

    if (!username || !password) {
      throw new Error("NJT credentials not set");
    }

    const url = `${DV_BASE}/getTrainScheduleJSON?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&station=${stationCode}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`DV API returned ${res.status}`);

    const raw = await res.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      const jsonMatch = raw.match(/\[.*\]/s) || raw.match(/\{.*\}/s);
      if (jsonMatch) {
        data = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Could not parse DV response: " + raw.substring(0, 200));
      }
    }

    // Parse departures from various response formats
    let items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data.STATION) {
      const station = Array.isArray(data.STATION) ? data.STATION[0] : data.STATION;
      if (station.ITEMS && station.ITEMS.ITEM) {
        items = Array.isArray(station.ITEMS.ITEM) ? station.ITEMS.ITEM : [station.ITEMS.ITEM];
      }
    } else if (data.ITEMS) {
      items = Array.isArray(data.ITEMS.ITEM) ? data.ITEMS.ITEM : [data.ITEMS.ITEM];
    }

    const departures = [];
    for (const item of items) {
      if (!item) continue;

      const dep = {
        trainId: item.TRAIN_ID || item.TRAINID || "",
        destination: item.DESTINATION || "",
        scheduledTime: item.SCHED_DEP_DATE || item.SCHED_DEPT_DATE || "",
        status: item.STATUS || "",
        track: (item.TRACK || "").trim(),
        line: item.LINE || item.LINENAME || "",
        direction: item.DIRECTION || "",
        delayMinutes: 0,
        isApproaching: false,
        isCancelled: false,
      };

      const status = (dep.status || "").toUpperCase();
      if (status.includes("CANCEL")) {
        dep.isCancelled = true;
      } else if (status.includes("MIN")) {
        const match = status.match(/(\d+)/);
        if (match) dep.delayMinutes = parseInt(match[1]);
      } else if (status.includes("APPROACH") || status.includes("BOARD") || status === "NOW") {
        dep.isApproaching = true;
      }

      departures.push(dep);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        station: stationId,
        stationCode,
        timestamp: Date.now(),
        count: departures.length,
        departures,
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
