// api/trains.js — Vercel serverless proxy + normalizer for the glasses app.
//
// Why this exists:
//   - The glasses browser can't call CTA APIs directly (no CORS headers).
//   - It can't decode Metra's GTFS-realtime protobuf.
//   - API keys must stay off the glasses (they live in Vercel env vars).
//
// Request:  GET /api/trains?lat=41.9107&lon=-87.6492
// Response: { stations: [ { name, system, kind, lines:[{label,color}], dist_m,
//                          trains: [ {dest, eta_min, line, color, delayed, approaching} ] } ] }
//   system: "cta" | "metra" | "bus"

const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const RAIL = require('./_stations.js');
const BUS_STOPS = require('./_bus_stops.js');

const CTA_COLORS = {
  Red: '#c60c30', Blue: '#00a1de', Brn: '#62361b', G: '#009b3a',
  Org: '#f9461c', P: '#522398', Pink: '#e27ea6', Pexp: '#522398',
  Y: '#f9e300', Purple: '#522398', Brown: '#62361b', Orange: '#f9461c',
  Green: '#009b3a', Yellow: '#f9e300',
};
const CTA_LABEL = {
  Red: 'Red', Blue: 'Blue', Brn: 'Brown', G: 'Green', Org: 'Orange',
  P: 'Purple', Pexp: 'Purple', Pink: 'Pink', Y: 'Yellow',
};
const METRA_COLOR = '#0072ce';
const BUS_COLOR = '#1f9eff';

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearest(list, lat, lon, n) {
  return list
    .map(s => ({ ...s, dist_m: Math.round(haversine(lat, lon, s.lat, s.lon)) }))
    .sort((a, b) => a.dist_m - b.dist_m)
    .slice(0, n);
}

// CTA timestamps are "yyyy-MM-ddTHH:mm:ss" (no zone); only ever subtracted.
function ctaTs(s) {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

async function getCtaArrivals(mapid) {
  const key = process.env.CTA_KEY;
  if (!key) return [];
  const url = `https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=${key}&mapid=${mapid}&max=6&outputType=JSON`;
  const j = await (await fetch(url)).json();
  const etas = (j.ctatt && j.ctatt.eta) || [];
  return etas.map(t => {
    const arr = ctaTs(t.arrT), gen = ctaTs(t.prdt);
    const mins = (arr != null && gen != null)
      ? Math.round((arr - gen) / 60000)
      : Math.max(0, Math.round((ctaTs(t.arrT) - Date.now()) / 60000));
    return {
      dest: t.destNm,
      eta_min: Math.max(0, mins),
      line: CTA_LABEL[t.rt] || t.rt || 'CTA',
      color: CTA_COLORS[t.rt] || '#ffffff',
      delayed: t.isDly === '1',
      approaching: t.isApp === '1',
    };
  }).sort((a, b) => a.eta_min - b.eta_min);
}

async function getMetraArrivals(stopId) {
  const base = process.env.METRA_RT_URL, token = process.env.METRA_TOKEN;
  if (!base || !token) return [];
  const url = `${base}${base.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(token)}`;
  const buf = await (await fetch(url)).arrayBuffer();
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
        line: (tu.trip && tu.trip.routeId) || 'Metra',
        color: METRA_COLOR,
        delayed: (stu.arrival.delay || 0) > 60,
      });
    }
  }
  return out.sort((a, b) => a.eta_min - b.eta_min).slice(0, 6);
}

// One batched call covers up to 10 bus stops. Returns predictions grouped by stop id.
async function getBusPredictions(stopIds) {
  const key = process.env.BUSTRACKER_KEY;
  if (!key || !stopIds.length) return {};
  const url = `https://www.ctabustracker.com/bustime/api/v2/getpredictions` +
    `?key=${key}&stpid=${stopIds.slice(0, 10).join(',')}&top=8&format=json`;
  const j = await (await fetch(url)).json();
  const prds = (j['bustime-response'] && j['bustime-response'].prd) || [];
  const byStop = {};
  for (const p of prds) {
    const raw = String(p.prdctdn || '').toUpperCase();
    const due = raw === 'DUE';
    const dlyOnly = raw === 'DLY';
    const n = parseInt(raw, 10);
    (byStop[p.stpid] = byStop[p.stpid] || []).push({
      dest: p.des || p.rtdir || ('Route ' + p.rt),
      eta_min: due ? 0 : (isNaN(n) ? 0 : n),
      line: p.rt,
      color: BUS_COLOR,
      delayed: p.dly === true || dlyOnly,
      approaching: due,
    });
  }
  return byStop;
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

  try {
    const railNear = nearest(RAIL, lat, lon, 3);            // CTA 'L' + Metra
    const busNear  = nearest(BUS_STOPS, lat, lon, 3);       // CTA buses

    // Batch all nearby bus predictions in a single API call.
    const busPreds = await getBusPredictions(busNear.map(b => b.id));

    const cards = [];

    for (const s of railNear) {
      let trains = [];
      try {
        trains = s.system === 'cta' ? await getCtaArrivals(s.id) : await getMetraArrivals(s.id);
      } catch (e) { trains = []; }
      cards.push({
        name: s.name, system: s.system, kind: s.system === 'metra' ? 'Metra' : 'Train',
        lines: s.lines || [], dist_m: s.dist_m, trains: trains.slice(0, 4),
      });
    }

    for (const b of busNear) {
      const trains = (busPreds[b.id] || []).sort((a, c) => a.eta_min - c.eta_min).slice(0, 4);
      const routes = [];
      trains.forEach(t => { if (!routes.includes(t.line)) routes.push(t.line); });
      cards.push({
        name: b.name || ('Stop ' + b.id), system: 'bus', kind: 'Bus',
        lines: routes.map(r => ({ label: r, color: BUS_COLOR })),
        dist_m: b.dist_m, trains,
      });
    }

    cards.sort((a, b) => a.dist_m - b.dist_m);
    res.status(200).json({ stations: cards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
