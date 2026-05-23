#!/usr/bin/env python3
"""Extract major downtown Chicago Metra stops from GTFS stops.txt and merge
with the existing CTA stops to create a comprehensive _stations.js file."""

import csv
import json
import os

# Input/output paths
SCHEDULE_DIR = os.path.expanduser("~/Desktop/chicago-train-hud/schedule (2)")
STOPS_TXT = os.path.join(SCHEDULE_DIR, "stops.txt")
OUTPUT_PATH = os.path.expanduser("~/Desktop/chicago-train-hud/api/_stations.js")

# Major downtown/accessible Metra stops (focus on zone 1, 2 + key transfer points)
# These are well-known stations that serve high-traffic routes
MAJOR_METRA_STOPS = {
    "UNION": "Union Station",           # Downtown hub
    "LASALLE": "La Salle",              # Downtown
    "MILLENNIUM": "Millennium Station", # Downtown (Rock Island, South Shore)
    "RANDOLPH": "Randolph",             # Loop
    "OCONNOR": "O'Connor",              # Loop area (Metra Electric)
    "VAN BUREN": "Van Buren",           # Loop
    "FULLERTON": "Fullerton",           # North (major transfer)
    "OGDEN": "Ogden",                   # West Loop (UP-W)
    "KEDZIE": "Kedzie",                 # West (UP-W)
    "HWTHORNE": "Hawthorne",            # South (Metra Electric)
    "18TH": "18th Street",              # South
    "MIDWAY": "Midway",                 # Southwest (SouthWest Service)
    "PELHAM": "Pelham",                 # North (UP-N)
    "HIGHWOOD": "Highwood",             # North (UP-N)
    "NAPERVILLE": "Naperville",         # West (BNSF)
    "DOWNERS": "Downers Grove",         # West (BNSF)
}

def read_metra_stops():
    """Parse stops.txt and extract major downtown stops."""
    metra_stops = {}
    try:
        with open(STOPS_TXT, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f, skipinitialspace=True)
            for row in reader:
                stop_id = (row.get('stop_id') or '').strip()
                stop_name = (row.get('stop_name') or '').strip()
                lat_str = (row.get('stop_lat') or '').strip()
                lon_str = (row.get('stop_lon') or '').strip()
                
                if not stop_id or not lat_str or not lon_str:
                    continue
                
                try:
                    lat = float(lat_str)
                    lon = float(lon_str)
                except ValueError:
                    continue
                
                # Store if it's a major stop or close to downtown
                if stop_id in MAJOR_METRA_STOPS or (41.8 <= lat <= 41.9 and -87.7 <= lon <= -87.5):
                    metra_stops[stop_id] = {
                        'id': stop_id,
                        'name': MAJOR_METRA_STOPS.get(stop_id, stop_name),
                        'lat': round(lat, 6),
                        'lon': round(lon, 6),
                        'system': 'metra',
                        'lines': []
                    }
    except FileNotFoundError:
        print(f"Error: {STOPS_TXT} not found")
        return {}
    
    return metra_stops

def build_stations_js():
    """Build the complete stations array with CTA + Metra stops."""
    # CTA stations (existing)
    cta_stations = [
        {'id': '40380', 'name': 'Clark/Lake', 'lat': 41.8857, 'lon': -87.6309, 'system': 'cta', 'lines': [
            {'label': 'Red', 'color': '#c60c30'},
            {'label': 'Blue', 'color': '#00a1de'},
            {'label': 'Brown', 'color': '#62361b'}
        ]},
        {'id': '40010', 'name': 'Fullerton', 'lat': 41.9231, 'lon': -87.6629, 'system': 'cta', 'lines': [
            {'label': 'Red', 'color': '#c60c30'},
            {'label': 'Brown', 'color': '#62361b'},
            {'label': 'Purple', 'color': '#522398'}
        ]},
        {'id': '40450', 'name': 'Roosevelt', 'lat': 41.8353, 'lon': -87.6244, 'system': 'cta', 'lines': [
            {'label': 'Red', 'color': '#c60c30'},
            {'label': 'Orange', 'color': '#f9461c'},
            {'label': 'Green', 'color': '#009b3a'}
        ]},
        {'id': '40210', 'name': 'Ashland', 'lat': 41.8078, 'lon': -87.6658, 'system': 'cta', 'lines': [
            {'label': 'Green', 'color': '#009b3a'},
            {'label': 'Red', 'color': '#c60c30'}
        ]},
        {'id': '40920', 'name': 'O\'Hare', 'lat': 41.9742, 'lon': -87.9073, 'system': 'cta', 'lines': [
            {'label': 'Blue', 'color': '#00a1de'}
        ]},
        {'id': '41280', 'name': 'Midway', 'lat': 41.7860, 'lon': -87.7524, 'system': 'cta', 'lines': [
            {'label': 'Orange', 'color': '#f9461c'}
        ]},
    ]
    
    # Get Metra stops
    metra_stops = read_metra_stops()
    
    # Convert to list and sort by proximity to downtown
    stations = cta_stations + list(metra_stops.values())
    stations.sort(key=lambda s: (
        abs(s['lat'] - 41.8857) + abs(s['lon'] + 87.6309)  # Distance from Clark/Lake
    ))
    
    return stations

def main():
    stations = build_stations_js()
    body = json.dumps(stations, ensure_ascii=False, separators=(',', ':'))
    
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write("// AUTO-GENERATED from CTA + Metra GTFS data.\n")
        f.write("// CTA stations from City of Chicago open data (dataset 8pix-ypme);\n")
        f.write("// Metra stops from https://schedules.metrarail.com/gtfs/schedule.zip\n")
        f.write("module.exports = " + body + ";\n")
    
    print(f"✓ Generated {OUTPUT_PATH}")
    print(f"  {len(stations)} total stations (CTA + Metra)")

if __name__ == "__main__":
    main()
