#!/usr/bin/env python3
"""Build lean web data for the dive-sites map app.

Reads the 4 harvested full JSON files and emits, into docs/data/:
  - sites_ssi.geojson      lean: id,name,dives,depth,rating,country  (map layer)
  - sites_padi.geojson     lean: id,name,depth,types,country
  - centers_ssi.geojson    lean: id,name,city,country,rating
  - centers_padi.geojson   lean: id,name,membership,fiveStar,country
  - details/<layer>/<id>.json   per-feature rich detail (lazy-loaded on click)
  - rankings.json          precomputed: SSI top-by-dives, by-depth, by-country, PADI types, centers
  - meta.json              counts + provenance for the UI

Design: the map payload carries ONLY what's needed to render + label + filter.
Images, wildlife, contact, affiliated-sites etc. live in detail chunks fetched
on demand. This keeps first paint small (the SSI full file is 88% image URLs).
"""
import json, os, re
from collections import Counter, defaultdict

SRC = "/sdcard/Download/dive-data"
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
OUT = os.path.abspath(OUT)
DET = os.path.join(OUT, "details")
os.makedirs(DET, exist_ok=True)

def load(p): return json.load(open(os.path.join(SRC, p)))
def num(v):
    try: return float(v)
    except: return None
def int0(v):
    try: return int(float(v))
    except: return 0

def valid_lat(la, lo):
    return la is not None and lo is not None and -90 <= la <= 90 and -180 <= lo <= 180 and not (la == 0 and lo == 0)

def feat(lon, lat, props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}, "properties": props}

def write_geojson(name, feats):
    fc = {"type": "FeatureCollection", "features": feats}
    path = os.path.join(OUT, name)
    json.dump(fc, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
    return os.path.getsize(path)

def write_details(layer, by_id):
    d = os.path.join(DET, layer)
    os.makedirs(d, exist_ok=True)
    # single bundled file keyed by id (one fetch, cached) — simpler than 26k files
    json.dump(by_id, open(os.path.join(DET, f"{layer}.json"), "w"), separators=(",", ":"), ensure_ascii=False)

# ---------------- SSI sites ----------------
ssi = load("sites/ssi/ssi_divesites_full.json")
ssi_feats, ssi_det = [], {}
for s in ssi:
    la, lo = num(s.get("lat")), num(s.get("lng"))
    if not valid_lat(la, lo): continue
    sid = s.get("id")
    ssi_feats.append(feat(lo, la, {
        "id": sid, "src": "ssi", "kind": "site",
        "name": s.get("name"), "dives": int0(s.get("loggedDives")),
        "depth": int0(s.get("averageMaxDepth")), "rating": int0(s.get("averageRating")),
        "country": s.get("country_iso3"),
    }))
    ssi_det[sid] = {
        "name": s.get("name"), "country": s.get("country_iso3"),
        "loggedDives": int0(s.get("loggedDives")), "loggedUsers": int0(s.get("loggedUsers")),
        "rating": s.get("averageRating"), "maxDepth": s.get("averageMaxDepth"),
        "diveTime": s.get("averageDivetime"), "vis": s.get("averageVis"),
        "level": s.get("level"), "wildlifeCount": len(s.get("wildlife") or []),
        "url": s.get("URL"),
        "images": [im.get("detail") for im in (s.get("images", {}).get("elements", []) if isinstance(s.get("images"), dict) else []) if im.get("detail")][:5],
    }
sz1 = write_geojson("sites_ssi.geojson", ssi_feats)
write_details("sites_ssi", ssi_det)

# ---------------- PADI sites ----------------
padi = load("sites/padi/padi_divesites_full.json")
padi_feats, padi_det = [], {}
for s in padi:
    la, lo = num(s.get("latitude")), num(s.get("longitude"))
    if not valid_lat(la, lo): continue
    sid = s.get("id")
    title = s.get("title")
    padi_feats.append(feat(lo, la, {
        "id": sid, "src": "padi", "kind": "site",
        "name": title or "Unnamed PADI site",
        "named": bool(title),
        "depth": int0(s.get("maximumDepth")),
        "types": "|".join(s.get("types") or []),
    }))
    padi_det[sid] = {
        "name": title, "maxDepth": s.get("maximumDepth"),
        "types": s.get("types"), "marineLifeCount": len(s.get("marineLife") or []),
        "url": s.get("travelUrl"),
    }
sz2 = write_geojson("sites_padi.geojson", padi_feats)
write_details("sites_padi", padi_det)

# ---------------- SSI centers ----------------
sc = load("centers/ssi/ssi_centers_full.json")
sc_feats, sc_det = [], {}
for c in sc:
    la, lo = num(c.get("lat")), num(c.get("lng"))
    if not valid_lat(la, lo): continue
    cid = c.get("id")
    sc_feats.append(feat(lo, la, {
        "id": cid, "src": "ssi", "kind": "center",
        "name": c.get("name"), "city": c.get("city"), "country": c.get("country"),
        "rating": c.get("centerRating") or "",
    }))
    sc_det[cid] = {
        "name": c.get("name"), "city": c.get("city"), "country": c.get("country"),
        "street": c.get("street"), "zip": c.get("zip"),
        "email": c.get("email"), "tel": c.get("tel"), "web": c.get("web"),
        "rating": c.get("centerRating"), "proCenter": c.get("proCenter"),
        "affiliatedSites": len(c.get("affiliatedSites") or []), "url": c.get("descriptive_url"),
    }
sz3 = write_geojson("centers_ssi.geojson", sc_feats)
write_details("centers_ssi", sc_det)

# ---------------- PADI centers ----------------
pc = load("centers/padi/padi_centers_full.json")
pc_feats, pc_det = [], {}
for c in pc:
    la, lo = num(c.get("latitude")), num(c.get("longitude"))
    if not valid_lat(la, lo): continue
    cid = c.get("id")
    title = c.get("title")
    pc_feats.append(feat(lo, la, {
        "id": cid, "src": "padi", "kind": "center",
        "name": title or "Unnamed PADI center", "named": bool(title),
        "membership": c.get("membershipLevel") or "",
        "fiveStar": bool(c.get("isFiveStar")),
    }))
    pc_det[cid] = {
        "name": title, "membership": c.get("membershipLevel"),
        "activities": c.get("activities"), "languages": c.get("languages"),
        "openHour": c.get("openHour"), "address": c.get("shortAddress"),
        "fiveStar": bool(c.get("isFiveStar")), "url": c.get("url"),
    }
sz4 = write_geojson("centers_padi.geojson", pc_feats)
write_details("centers_padi", pc_det)

# ---------------- rankings ----------------
def li(s, k): return int0(s.get(k))
ssi_ranked = sorted(ssi, key=lambda s: li(s, "loggedDives"), reverse=True)
top_dives = [{"rank": i, "name": s.get("name"), "country": s.get("country_iso3"),
              "dives": li(s, "loggedDives"), "depth": int0(s.get("averageMaxDepth")),
              "rating": int0(s.get("averageRating")),
              "lat": num(s.get("lat")), "lng": num(s.get("lng"))}
             for i, s in enumerate(ssi_ranked[:50], 1)]

# by depth (deepest avg-max, SSI, min 50 dives to avoid noise)
deep = sorted([s for s in ssi if li(s, "loggedDives") >= 50],
              key=lambda s: int0(s.get("averageMaxDepth")), reverse=True)[:50]
top_depth = [{"rank": i, "name": s.get("name"), "country": s.get("country_iso3"),
              "depth": int0(s.get("averageMaxDepth")), "dives": li(s, "loggedDives")}
             for i, s in enumerate(deep, 1)]

# by country: site counts + total dives (SSI) and PADI counts
ssi_by_country = Counter(s.get("country_iso3") for s in ssi)
ssi_dives_country = defaultdict(int)
for s in ssi: ssi_dives_country[s.get("country_iso3")] += li(s, "loggedDives")
top_country = sorted(ssi_by_country.items(), key=lambda kv: ssi_dives_country[kv[0]], reverse=True)[:40]
by_country = [{"country": c, "ssiSites": n, "ssiDives": ssi_dives_country[c]} for c, n in top_country]

padi_types = Counter()
for s in padi:
    for t in (s.get("types") or []): padi_types[t] += 1

pc_named = [c for c in pc if c.get("title")]
membership = Counter(c.get("membershipLevel") for c in pc_named).most_common()

rankings = {
    "topByDives": top_dives, "topByDepth": top_depth, "byCountry": by_country,
    "padiTypes": padi_types.most_common(20), "padiMembership": membership,
    "totals": {"ssiTotalDives": sum(li(s, "loggedDives") for s in ssi)},
}
json.dump(rankings, open(os.path.join(OUT, "rankings.json"), "w"), separators=(",", ":"), ensure_ascii=False)

meta = {
    "generated": "2026-06-22",
    "layers": {
        "sites_ssi": {"count": len(ssi_feats), "bytes": sz1, "label": "SSI dive sites", "metric": "loggedDives"},
        "sites_padi": {"count": len(padi_feats), "bytes": sz2, "label": "PADI dive sites"},
        "centers_ssi": {"count": len(sc_feats), "bytes": sz3, "label": "SSI centers"},
        "centers_padi": {"count": len(pc_feats), "bytes": sz4, "label": "PADI centers"},
    },
    "note": "Only SSI exposes a logged-dive popularity metric. PADI has no dive counts; "
            "cross-source ranking is not possible. Sources are kept as separate layers.",
}
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1, ensure_ascii=False)

print("LAYER SIZES (lean geojson):")
for k, v in meta["layers"].items():
    print(f"  {k:14} {v['count']:6} feats  {v['bytes']/1e6:.2f} MB")
det_total = sum(os.path.getsize(os.path.join(DET, f)) for f in os.listdir(DET) if f.endswith('.json'))
print(f"details bundles total: {det_total/1e6:.2f} MB")
print(f"rankings.json: {os.path.getsize(os.path.join(OUT,'rankings.json'))/1e3:.0f} KB")
