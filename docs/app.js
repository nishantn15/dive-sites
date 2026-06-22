// ============================================================
// Dive Sites of the World — MapLibre globe + clustered layers
// ============================================================
const CFG = window.DIVE_CONFIG;
const KEY = CFG.MAPTILER_KEY;
const STYLE_URL = `https://api.maptiler.com/maps/${CFG.STYLE}/style.json?key=${KEY}`;

// layer styling palette
const PAL = {
  sites_ssi:   "#ff7964",
  sites_padi:  "#6be0d0",
  centers_ssi: "#ffd07b",
  centers_padi:"#c195ff",
};
const DATA = {
  sites_ssi:   "data/sites_ssi.geojson",
  sites_padi:  "data/sites_padi.geojson",
  centers_ssi: "data/centers_ssi.geojson",
  centers_padi:"data/centers_padi.geojson",
};
// details bundles, lazy-loaded on first popup of a layer
const detailCache = {};
async function getDetail(layer, id) {
  if (!detailCache[layer]) {
    detailCache[layer] = fetch(`data/details/${layer}.json`).then(r => r.json());
  }
  const bundle = await detailCache[layer];
  return bundle[id] || bundle[String(id)] || null;
}

let minDives = 0;
let map = null;
let mapReady = false;

// 1) Wire UI + load dashboard tables FIRST — these never depend on WebGL, so
//    the ranking views always work even if the globe can't initialise.
wireUI();
loadTables();

// 2) Try to build the globe. maplibregl.Map() throws synchronously when WebGL
//    is unavailable, so guard it — a failure must not kill the rest of the app.
try {
  map = new maplibregl.Map({
    container: "map",
    style: STYLE_URL,
    center: [99.82, 10.08],   // Koh Tao — the world's most-dived cluster
    zoom: 1.6,
    attributionControl: true,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  map.on("error", e => console.warn("map error", e && e.error));

  map.on("style.load", () => {
    try { map.setProjection({ type: "globe" }); } catch (e) { /* older style */ }
    map.setSky && map.setSky({ "sky-color": "#06101e", "horizon-color": "#173959", "fog-color": "#0a1f33", "fog-ground-blend": 0.5 });
  });

  map.on("load", async () => {
    await Promise.all(Object.keys(DATA).map(addLayer));
    document.getElementById("loading").style.display = "none";
    mapReady = true;
  });
} catch (e) {
  showGlobeUnavailable("Your browser/device has WebGL disabled, so the 3D globe can’t load.");
}

// Safety net: if the globe didn't come up within 8s (slow tiles, no WebGL),
// drop the overlay and point the user at the ranking tabs, which always work.
setTimeout(() => { if (!mapReady) showGlobeUnavailable(); }, 8000);

function showGlobeUnavailable(msg) {
  const l = document.getElementById("loading");
  if (!l) return;
  l.innerHTML = '<span style="max-width:280px;text-align:center;line-height:1.6">'
    + (msg || "The 3D globe is taking a while — it needs WebGL. The ranking tabs above still work.")
    + '</span><button onclick="this.parentElement.style.display=\'none\'" style="margin-top:14px;background:#ff7964;border:0;color:#1a0a06;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer">Dismiss</button>';
}

async function addLayer(layer) {
  const src = layer;
  map.addSource(src, {
    type: "geojson", data: DATA[layer],
    cluster: true, clusterRadius: 48, clusterMaxZoom: 7,
    // sum SSI dives inside clusters so big clusters read as "busy waters"
    clusterProperties: layer === "sites_ssi"
      ? { dives: ["+", ["coalesce", ["get", "dives"], 0]] } : {},
  });
  const color = PAL[layer];
  const initVis = (layer === "sites_ssi" || layer === "sites_padi") ? "visible" : "none";

  // cluster bubbles
  map.addLayer({
    id: `${layer}-cluster`, type: "circle", source: src, filter: ["has", "point_count"],
    layout: { visibility: initVis },
    paint: {
      "circle-color": color, "circle-opacity": 0.55,
      "circle-stroke-color": color, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.9,
      "circle-radius": ["interpolate", ["linear"], ["get", "point_count"],
        2, 12, 50, 20, 500, 30, 3000, 44],
    },
  });
  map.addLayer({
    id: `${layer}-cluster-count`, type: "symbol", source: src, filter: ["has", "point_count"],
    layout: { visibility: initVis, "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"], "text-size": 12 },
    paint: { "text-color": "#06101e" },
  });

  // unclustered points
  const radius = layer === "sites_ssi"
    ? ["interpolate", ["linear"], ["coalesce", ["get", "dives"], 0], 0, 3.5, 5000, 6, 50000, 11, 200000, 18]
    : 4.5;
  const pcolor = layer === "sites_ssi"
    ? ["interpolate", ["linear"], ["coalesce", ["get", "dives"], 0], 0, "#5b8a72", 5000, "#ffd07b", 40000, "#ff7964", 120000, "#ff2e1f"]
    : color;
  map.addLayer({
    id: `${layer}-pt`, type: "circle", source: src, filter: ["!", ["has", "point_count"]],
    layout: { visibility: initVis },
    paint: {
      "circle-color": pcolor, "circle-radius": radius,
      "circle-stroke-color": "rgba(6,16,30,0.85)", "circle-stroke-width": 0.8,
      "circle-opacity": 0.9,
    },
  });

  // interactions
  map.on("click", `${layer}-cluster`, (e) => {
    const f = e.features[0];
    map.getSource(src).getClusterExpansionZoom(f.properties.cluster_id).then(z => {
      map.easeTo({ center: f.geometry.coordinates, zoom: z });
    });
  });
  map.on("click", `${layer}-pt`, (e) => openPopup(layer, e.features[0]));
  map.on("mouseenter", `${layer}-pt`, () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", `${layer}-pt`, () => map.getCanvas().style.cursor = "");
  map.on("mouseenter", `${layer}-cluster`, () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", `${layer}-cluster`, () => map.getCanvas().style.cursor = "");
}

async function openPopup(layer, f) {
  const p = f.properties;
  const ll = f.geometry.coordinates.slice();
  const det = await getDetail(layer, p.id);
  const html = renderPopup(layer, p, det);
  new maplibregl.Popup({ maxWidth: "300px", offset: 10 }).setLngLat(ll).setHTML(html).addTo(map);
}

function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }
function row(k,v){ return v?`<div class="pp__row"><span>${k}</span><b>${esc(v)}</b></div>`:""; }

function renderPopup(layer, p, d) {
  d = d || {};
  if (layer === "sites_ssi") {
    const img = (d.images && d.images[0]) ? `<img class="pp__img" src="${esc(d.images[0])}" loading="lazy" referrerpolicy="no-referrer">` : "";
    const url = d.url ? `https://www.divessi.com/en${d.url}` : null;
    return `${img}<div class="pp"><span class="pp__tag pp__tag--ssi">SSI dive site</span>
      <h3>${esc(p.name)}</h3>
      ${row("Logged dives", (d.loggedDives||0).toLocaleString())}
      ${row("Divers", (d.loggedUsers||0).toLocaleString())}
      ${row("Avg max depth", d.maxDepth?d.maxDepth+" m":"")}
      ${row("Avg dive time", d.diveTime?d.diveTime+" min":"")}
      ${row("Visibility", d.vis?d.vis+" m":"")}
      ${row("Rating", d.rating?d.rating+"★":"")}
      ${row("Country", d.country)}
      ${url?`<a class="pp__link" href="${esc(url)}" target="_blank" rel="noopener">View on DiveSSI →</a>`:""}</div>`;
  }
  if (layer === "sites_padi") {
    const url = d.url ? `https://travel.padi.com${d.url}` : null;
    return `<div class="pp"><span class="pp__tag pp__tag--padi">PADI dive site</span>
      <h3>${esc(p.name)}</h3>
      ${row("Type", (d.types||[]).join(", "))}
      ${row("Max depth", d.maxDepth?d.maxDepth+" m":"")}
      ${row("Marine species", d.marineLifeCount||"")}
      <p class="pp__note">PADI does not publish logged-dive counts.</p>
      ${url?`<a class="pp__link" href="${esc(url)}" target="_blank" rel="noopener">View on PADI →</a>`:""}</div>`;
  }
  if (layer === "centers_ssi") {
    const url = d.url ? `https://www.divessi.com/en${d.url}` : null;
    return `<div class="pp"><span class="pp__tag pp__tag--scen">SSI center</span>
      <h3>${esc(d.name||p.name)}</h3>
      ${row("Location", [d.city,d.country].filter(Boolean).join(", "))}
      ${row("Address", [d.street,d.zip].filter(Boolean).join(", "))}
      ${row("Phone", d.tel)}
      ${d.email?`<div class="pp__row"><span>Email</span><b><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></b></div>`:""}
      ${d.web?`<div class="pp__row"><span>Web</span><b><a href="${esc(d.web)}" target="_blank" rel="noopener">site →</a></b></div>`:""}
      ${row("Affiliated sites", d.affiliatedSites||"")}
      ${url?`<a class="pp__link" href="${esc(url)}" target="_blank" rel="noopener">View on DiveSSI →</a>`:""}</div>`;
  }
  // centers_padi
  const url = d.url ? `https://travel.padi.com${d.url}` : null;
  return `<div class="pp"><span class="pp__tag pp__tag--pcen">PADI center</span>
    <h3>${esc(d.name||p.name)}</h3>
    ${row("Membership", d.membership)}
    ${row("Address", d.address)}
    ${row("Languages", (d.languages||[]).slice(0,6).join(", "))}
    ${row("Activities", (d.activities||[]).slice(0,4).join(", "))}
    ${row("Open", d.openHour)}
    <p class="pp__note">PADI center feed carries no phone/email.</p>
    ${url?`<a class="pp__link" href="${esc(url)}" target="_blank" rel="noopener">View on PADI →</a>`:""}</div>`;
}

function setLayerVisible(layer, on) {
  if (!map) return;
  ["-cluster","-cluster-count","-pt"].forEach(suf => {
    const id = layer+suf;
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  });
}

function applyMinDives() {
  if (!map) return;
  // filter SSI sites by min dives (clusters keep showing; points filter)
  const f = ["all", ["!", ["has", "point_count"]], [">=", ["coalesce", ["get","dives"],0], minDives]];
  if (map.getLayer("sites_ssi-pt")) map.setFilter("sites_ssi-pt", f);
}

// ---------------- UI wiring ----------------
function wireUI() {
  // layer toggles
  document.querySelectorAll('#layers input[data-layer]').forEach(cb => {
    cb.addEventListener("change", () => setLayerVisible(cb.dataset.layer, cb.checked));
  });
  // min dives
  const md = document.getElementById("minDives"), mo = document.getElementById("minDivesOut");
  md.addEventListener("input", () => {
    minDives = +md.value; mo.textContent = minDives.toLocaleString();
    applyMinDives();
  });
  document.getElementById("resetView").addEventListener("click", () =>
    map && map.easeTo({ center: [99.82,10.08], zoom: 1.6, pitch: 0, bearing: 0 }));

  // counts in legend
  fetch("data/meta.json").then(r=>r.json()).then(m => {
    for (const [k,v] of Object.entries(m.layers)) {
      const el = document.getElementById("c-"+k); if (el) el.textContent = v.count.toLocaleString();
    }
    const t = m.layers;
    document.getElementById("about-counts").innerHTML =
      `This atlas plots <strong>${(t.sites_ssi.count+t.sites_padi.count).toLocaleString()}</strong> dive sites `+
      `(${t.sites_ssi.count.toLocaleString()} SSI · ${t.sites_padi.count.toLocaleString()} PADI) and `+
      `<strong>${(t.centers_ssi.count+t.centers_padi.count).toLocaleString()}</strong> dive centers `+
      `(${t.centers_ssi.count.toLocaleString()} SSI · ${t.centers_padi.count.toLocaleString()} PADI).`;
  });

  // tabs
  document.querySelectorAll("#tabs .tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#tabs .tab").forEach(b=>b.classList.remove("tab--on"));
      btn.classList.add("tab--on");
      const v = btn.dataset.view;
      document.querySelectorAll(".view").forEach(s=>s.classList.remove("view--on"));
      document.getElementById("view-"+v).classList.add("view--on");
      if (v === "globe" && map) map.resize();
    });
  });
}

// ---------------- tables ----------------
var tablesLoaded = false;
function loadTables() {
  if (tablesLoaded) return; tablesLoaded = true;
  fetch("data/rankings.json").then(r=>r.json()).then(R => {
    // top by dives
    document.getElementById("tbl-dives").innerHTML = tableHTML(
      ["#","Site","Country","Logged dives","Depth","Rating"],
      R.topByDives.map(s => [s.rank, flyName(s), s.country, s.dives.toLocaleString(), s.depth+" m", s.rating+"★"]),
      true);
    // by depth
    document.getElementById("tbl-depth").innerHTML = tableHTML(
      ["#","Site","Country","Avg max depth","Logged dives"],
      R.topByDepth.map(s => [s.rank, esc(s.name), s.country, s.depth+" m", s.dives.toLocaleString()]));
    // by country
    document.getElementById("tbl-country").innerHTML = tableHTML(
      ["#","Country","SSI sites","Total logged dives"],
      R.byCountry.map((c,i) => [i+1, c.country, c.ssiSites.toLocaleString(), c.ssiDives.toLocaleString()]));
    // make fly links work
    document.querySelectorAll(".flyto").forEach(a => a.addEventListener("click", ev => {
      ev.preventDefault();
      document.querySelector('#tabs .tab[data-view="globe"]').click();
      if (map) map.flyTo({ center: [ +a.dataset.lng, +a.dataset.lat ], zoom: 11, speed: 1.4 });
    }));
  });
}
function flyName(s){
  return `<a href="#" class="flyto" data-lat="${s.lat}" data-lng="${s.lng}">${esc(s.name)}</a>`;
}
function tableHTML(headers, rows, rawFirstCol) {
  let h = "<table class='tbl'><thead><tr>" + headers.map(x=>`<th>${x}</th>`).join("") + "</tr></thead><tbody>";
  h += rows.map(r => "<tr>" + r.map((c,i)=>`<td>${i===1&&rawFirstCol?c:(typeof c==='string'&&c.startsWith('<')?c:esc(c))}</td>`).join("") + "</tr>").join("");
  return h + "</tbody></table>";
}
