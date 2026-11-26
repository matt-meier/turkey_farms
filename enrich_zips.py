#!/usr/bin/env python3
"""Enrich data.json with official US Census 2020 ZCTA centroid coordinates.

Downloads the public Census 2020 ZCTA National Gazetteer file (zero third-party
dependencies required) and adds rounded lat/lon coordinates to all matching ZIP
codes in data.json. Once enriched, app.js automatically switches from the
out-of-the-box state choropleth + hub overlay to plotting every individual ZIP
code as a proportional circle on the US map.
"""

import csv
import io
import json
import os
import urllib.request
import zipfile

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "2020_Gazetteer/2020_Gaz_zcta_national.zip"
)
DATA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.json")


def fetch_zcta_centroids(url: str) -> dict:
    print(f"Downloading US Census 2020 ZCTA Gazetteer from {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "TurkeyFarmsDataApp/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw_bytes = resp.read()

    coords = {}
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
        txt_names = [n for n in zf.namelist() if n.lower().endswith(".txt")]
        if not txt_names:
            raise RuntimeError("No .txt gazetteer file found inside zip archive.")
        with zf.open(txt_names[0]) as fh:
            text_stream = io.TextIOWrapper(fh, encoding="utf-8-sig")
            reader = csv.DictReader(text_stream, delimiter="\t")
            for row in reader:
                cleaned = {k.strip(): (v.strip() if v is not None else "") for k, v in row.items()}
                geoid = cleaned.get("GEOID", "").zfill(5)
                lat_s = cleaned.get("INTPTLAT", "")
                lon_s = cleaned.get("INTPTLONG", "")
                if geoid and lat_s and lon_s:
                    coords[geoid] = (round(float(lat_s), 3), round(float(lon_s), 3))
    print(f"Loaded {len(coords):,} official ZCTA centroids.")
    return coords


def main() -> None:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        payload = json.load(f)

    centroids = fetch_zcta_centroids(GAZETTEER_URL)

    matched = 0
    for rec in payload["zips"]:
        z = str(rec["z"]).zfill(5)
        if z in centroids:
            lat, lon = centroids[z]
            rec["lat"] = lat
            rec["lon"] = lon
            matched += 1

    payload["meta"]["has_full_zip_coords"] = True
    payload["meta"]["geocoded_zips"] = matched

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)

    total = len(payload["zips"])
    pct = matched / total * 100 if total else 0.0
    print(f"Enriched {matched:,} of {total:,} ZIP codes ({pct:.1f}%) and updated {DATA_PATH}.")


if __name__ == "__main__":
    main()
