# 🌊 Dive Sites of the World

An interactive 3D-globe atlas of the world's dive sites and dive centers, built from the
public **SSI** and **PADI** locators.

**Live site:** https://nishantn15.github.io/dive-sites/

## What's in it

- **A real 3D globe** (MapLibre GL JS globe projection over MapTiler satellite imagery) —
  not stylised polygons, actual rendered map tiles.
- **26,000+ plotted points** across four independently toggleable layers:
  | Layer | Count | Notes |
  |-------|------:|-------|
  | SSI dive sites | 10,820 | sized & coloured by **logged dives** |
  | PADI dive sites | 5,903 | by type; some unnamed map pins |
  | SSI centers | 3,764 | full contact details |
  | PADI centers | 5,594 | membership tier, languages, activities |
- **Dashboard views** (no map needed): top 50 by logged dives, top 50 by depth, top dive
  nations by total logged dives.
- Click any ranked site to **fly to it** on the globe.

## Why SSI and PADI are separate layers

Only **SSI publishes a logged-dive count per site**, so every popularity ranking here is
SSI-only. PADI exposes no dive/visit metric, and the two sources share no common IDs — so
they are kept as separate layers rather than merged (merging would invent precision that
isn't in the data).

## Data

Lean per-layer GeoJSON powers the map; rich detail (images, wildlife, contact info) is
lazy-loaded per feature on click. Rankings are precomputed into `rankings.json`.

Built by `scripts/build_web_data.py` from harvested source data. Counts are point-in-time;
logged-dive numbers tick up live at the source.

## Local development

```sh
cd docs && python3 -m http.server 8765
# open http://localhost:8765/
```

The globe needs **WebGL**. If WebGL is unavailable the ranking tabs still work.

## Map tiles / API key

`docs/config.js` holds a MapTiler key. For a public deployment use a key **restricted to the
site's origin** (at maptiler.com → API keys → Allowed HTTP Origins: `nishantn15.github.io`).
Client-side map keys are always visible in static sites; origin-restriction is the mitigation.

## Tech

MapLibre GL JS · MapTiler imagery · vanilla JS (no build step) · GitHub Pages.

---

*Data harvested for educational use from the public SSI & PADI dive-site locators.*
