// api/trains.js — Vercel serverless function
//
// Acts as a proxy + normalizer for the Ray-Ban Display web app.
// The browser on the glasses cannot:
//   (a) call the CTA API directly (no CORS headers), or
//   (b) decode Metra's GTFS-realtime protobuf feed.
// So this function does both server-side and returns clean JSON.
// It also keeps your API keys OFF the glasses (they live in Vercel env vars).
//
// Request:  GET /api/trains?lat=41.8837&lon=-87.6298
// Response: { stations: [ { name, system, line, dist_m, trains: [ {dest, eta_min, delayed} ] } ] }

const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

// ---------------------------------------------------------------------------
// STARTER STATION LIST
// ---------------------------------------------------------------------------
// This is a STARTER set of well-known stations so the app works immediately.
// The CTA "mapid" values below are the major hubs; verify/expand them from the
// official CTA "L stops" dataset before relying on every station.
// Metra "stop_id" values MUST come from the current Metra GTFS static feed
// (the ones below are placeholders — see README, step 3).
const STATIONS = [
  // ---- CTA 'L' (mapid) ----
  { name: 'Clark/Lake',        system: 'cta',   line: 'Loop (multi-line)', lat: 41.885737, lon: -87.630886, id: '40380' },
  { name: 'Roosevelt',         system: 'cta',   line: 'Red/Orange/Green',  lat: 41.867368, lon: -87.627402, id: '41400' },
  { name: 'Belmont',           system: 'cta',   line: 'Red/Brown/Purple',  lat: 41.939751, lon: -87.653238, id: '41320' },
  { name: 'Fullerton',         system: 'cta',   line: 'Red/Brown/Purple',  lat: 41.925051, lon: -87.652866, id: '41220' },
  { name: 'Howard',            system: 'cta',   line: 'Red/Purple/Yellow', lat: 42.019063, lon: -87.672892, id: '40900' },
  { name: 'O’Hare',       system: 'cta',   line: 'Blue',              lat: 41.979265, lon: -87.903813, id: '40890' },
  { name: 'Forest Park',       system: 'cta',   line: 'Blue',              lat: 41.874039, lon: -87.817318, id: '40390' },
  { name: 'Jackson (Blue)',    system: 'cta',   line: 'Blue',              lat: 41.878183, lon: -87.629524, id: '40070' },
  { name: '95th/Dan Ryan',     system: 'cta',   line: 'Red',               lat: 41.722377, lon: -87.624342, id: '40450' },

  // ---- Metra (stop_id — VERIFY against current Metra GTFS, see README) ----
  { name: 'Chicago Union Station', system: 'metra', line: 'BNSF / MD / NCS / SWS / HC', lat: 41.878765, lon: -87.639753, id: 'CUS' },
  { name: 'Ogilvie (OTC)',         system: 'metra', line: 'UP-N / UP-NW / UP-W',        lat: 41.882664, lon: -87.640426, id: 'OTC' },
  { name: 'Millennium Station',    system: 'metra', line: 'Metra Electric / SSL',       lat: 41.882662, lon: -87.624207, id: 'MILLENNIUM' },
  { name: 'LaSalle Street',        system: 'metra', line: 'Rock Island',                lat: 41.876513, lon: -87.631860, id: 'LASALLE' },
];

// ---------------------------------------------------------------------------
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getCtaArrivals(mapid) {
  const key = process.env.CTA_KEY;
  if (!key) return [];
  const url = `https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=${key}&mapid=${mapid}&max=4&outputType=JSON`;
  const r = await fetch(url);
  const j = await r.json();
  const etas = (j.ctatt && j.ctatt.eta) || [];
  return etas.map(t => ({
    dest: t.destNm,
    eta_min: Math.max(0, Math.round((new Date(t.arrT.replace(' ', 'T')) - Date.now()) / 60000)),
    delayed: t.isDly === '1',
  }));
}

// Metra GTFS-realtime trip-updates feed (protobuf).
// Set METRA_RT_URL and METRA_TOKEN in Vercel env vars from your approved Metra API docs.
async function getMetraArrivals(stopId) {
  const base = process.env.METRA_RT_URL; // e.g. https://<approved-host>/gtfs/tripUpdates
  const token = process.env.METRA_TOKEN;
  if (!base || !token) return [];
  const url = `${base}${base.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
  const out = [];
  for (const e of feed.entity) {
    const tu = e.tripUpdate;
    if (!tu || !tu.stopTimeUpdate) continue;
    for (const stu of tu.stopTimeUpdate) {
      if (stu.stopId !== stopId || !stu.arrival || !stu.arrival.time) continue;
      const mins = Math.round((Number(stu.arrival.time) * 1000 - Date.now()) / 60000);
      if (mins < 0 || mins > 120) continue;
      out.push({
        dest: (tu.trip && tu.trip.routeId) || 'Metra',
        eta_min: mins,
        delayed: (stu.arrival.delay || 0) > 60,
      });
    }
  }
  return out.sort((a, b) => a.eta_min - b.eta_min).slice(0, 4);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    res.status(400).json({ error: 'Missing or invalid lat/lon' });
    return;
  }

  // Nearest 3 stations to the wearer.
  const nearest = STATIONS
    .map(s => ({ ...s, dist_m: Math.round(haversine(lat, lon, s.lat, s.lon)) }))
    .sort((a, b) => a.dist_m - b.dist_m)
    .slice(0, 3);

  try {
    const stations = [];
    for (const s of nearest) {
      let trains = [];
      try {
        trains = s.system === 'cta'
          ? await getCtaArrivals(s.id)
          : await getMetraArrivals(s.id);
      } catch (e) {
        trains = [];
      }
      stations.push({
        name: s.name, system: s.system, line: s.line,
        dist_m: s.dist_m, trains: trains.slice(0, 3),
      });
    }
    res.status(200).json({ stations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
