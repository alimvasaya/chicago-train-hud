#!/usr/bin/env python3
"""Convert the official 'CTA Bus Stops' CSV (data portal id hvnx-qtky) into
api/_bus_stops.js  ->  [{ id, lat, lon, name }, ...]

Usage:
    python3 gen_bus_stops.py path/to/CTA_Bus_Stops.csv

The CSV's exact column names vary; this script auto-detects the stop-id,
latitude/longitude (or a POINT geometry), and a human-readable name.
"""
import csv, json, os, re, sys

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "chicago-train-hud", "api", "_bus_stops.js")

ID_KEYS   = ["systemstop", "stop_id", "stpid", "systemwide", "objectid"]
LAT_KEYS  = ["latitude", "lat", "y", "point_y"]
LON_KEYS  = ["longitude", "lon", "lng", "x", "point_x"]
NAME_KEYS = ["public_nam", "public_name", "stop_name", "name", "cta_stop_name"]

def find(headers, candidates):
    low = {h.lower(): h for h in headers}
    for c in candidates:
        for h in low:
            if c == h or c in h:
                return low[h]
    return None

def parse_point(s):
    # handles "POINT (-87.65 41.91)" or "(41.91, -87.65)"
    nums = re.findall(r"-?\d+\.\d+", s or "")
    if len(nums) < 2:
        return None
    a, b = float(nums[0]), float(nums[1])
    # POINT is (lon lat); tuple form is (lat, lon)
    if s.strip().upper().startswith("POINT"):
        return (b, a)         # lat, lon
    return (a, b)             # lat, lon

def main(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rdr = csv.DictReader(f)
        headers = rdr.fieldnames or []
        id_k  = find(headers, ID_KEYS)
        lat_k = find(headers, LAT_KEYS)
        lon_k = find(headers, LON_KEYS)
        name_k = find(headers, NAME_KEYS)
        geom_k = find(headers, ["the_geom", "geometry", "location", "geocoded_column"])
        print("Detected columns -> id:", id_k, "| lat:", lat_k, "| lon:", lon_k,
              "| name:", name_k, "| geom:", geom_k)
        if not id_k:
            print("Could not find a stop-id column. Headers were:", headers); sys.exit(1)

        stops, seen = [], set()
        for row in rdr:
            sid = (row.get(id_k) or "").strip()
            if not sid or sid in seen:
                continue
            lat = lon = None
            if lat_k and lon_k:
                try:
                    lat = float(row[lat_k]); lon = float(row[lon_k])
                except (ValueError, TypeError):
                    lat = lon = None
            if (lat is None or lon is None) and geom_k:
                p = parse_point(row.get(geom_k, ""))
                if p:
                    lat, lon = p
            if lat is None or lon is None:
                continue
            name = (row.get(name_k) or "").strip() if name_k else ""
            seen.add(sid)
            stops.append({"id": sid, "lat": round(lat, 6), "lon": round(lon, 6), "name": name})

    body = json.dumps(stops, ensure_ascii=False, separators=(",", ":"))
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED from the CTA Bus Stops dataset (hvnx-qtky).\n")
        f.write("module.exports = " + body + ";\n")
    print("wrote", len(stops), "bus stops ->", OUT_PATH)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python3 gen_bus_stops.py path/to/CTA_Bus_Stops.csv"); sys.exit(1)
    main(sys.argv[1])
