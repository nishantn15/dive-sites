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
let ssiAllFeatures = null;   // cached raw SSI site features for slider filtering

// 1) Wire UI + load dashboard tables FIRST — these never depend on WebGL, so
//    the ranking views always work even if the globe can't initialise.
wireUI();
loadTables();
buildSearchIndex();

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
    addSearchLayer();
    document.getElementById("loading").style.display = "none";
    mapReady = true;
  });
} catch (e) {
  showGlobeUnavailable("Your browser/device has WebGL disabled, so the 3D globe can't load.");
}

// Safety net: if the globe didn't come up within 8s (slow tiles, no WebGL),
// drop the overlay and point the user at the ranking tabs, which always work.
setTimeout(() => { if (!mapReady) showGlobeUnavailable(); }, 8000);

function showGlobeUnavailable(msg) {
  const l = document.getElementById("loading");
  if (!l) return;
  l.innerHTML = '<span style="max-width:280px;text-align:center;line-height:1.6">'
    + (msg || "The 3D globe is taking a while - it needs WebGL. The ranking tabs above still work.")
    + '</span><button onclick="this.parentElement.style.display=\'none\'" style="margin-top:14px;background:#ff7964;border:0;color:#1a0a06;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer">Dismiss</button>';
}

async function addLayer(layer) {
  const src = layer;
  // For SSI sites we cache the raw features so the min-dives slider can filter
  // the SOURCE data (which makes clusters recompute) instead of only hiding
  // unclustered points — at world zoom everything is clustered, so a
  // point-only filter looked like it did nothing / "got stuck".
  let data = DATA[layer];
  if (layer === "sites_ssi") {
    ssiAllFeatures = (await fetch(DATA[layer]).then(r => r.json())).features;
    data = { type: "FeatureCollection", features: ssiAllFeatures };
  }
  map.addSource(src, {
    type: "geojson", data,
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
  if (!map || !ssiAllFeatures) return;
  const src = map.getSource("sites_ssi");
  if (!src) return;
  // Re-feed the SOURCE with only sites >= the threshold, so clusters recompute
  // and the whole layer (clusters + points) reflects the filter.
  const feats = minDives <= 0
    ? ssiAllFeatures
    : ssiAllFeatures.filter(f => (f.properties.dives || 0) >= minDives);
  src.setData({ type: "FeatureCollection", features: feats });
}

// ---------------- UI wiring ----------------
function wireUI() {
  // collapsible layers panel — start collapsed on small screens to free the map
  const panel = document.getElementById("layers");
  const ptoggle = document.getElementById("panelToggle");
  const startCollapsed = window.matchMedia("(max-width:640px)").matches;
  if (startCollapsed) { panel.classList.add("collapsed"); ptoggle.setAttribute("aria-expanded", "false"); }
  ptoggle.addEventListener("click", () => {
    const nowCollapsed = panel.classList.toggle("collapsed");
    ptoggle.setAttribute("aria-expanded", String(!nowCollapsed));
  });

  // layer toggles
  document.querySelectorAll('#layers input[data-layer]').forEach(cb => {
    cb.addEventListener("change", () => setLayerVisible(cb.dataset.layer, cb.checked));
  });
  // min dives — update the label live, debounce the (heavier) source refilter
  const md = document.getElementById("minDives"), mo = document.getElementById("minDivesOut");
  let mdT = null;
  md.addEventListener("input", () => {
    minDives = +md.value;
    mo.textContent = minDives.toLocaleString();
    clearTimeout(mdT);
    mdT = setTimeout(applyMinDives, 90);
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

// ============================================================
// SEARCH — free-text over named dive sites (SSI + named PADI)
// List updates live as you type; globe highlights on Enter/click.
// ============================================================
const SEARCH = { index: [], ready: false, matches: [], activeIdx: -1 };
const MAX_RESULTS = 30;
const MIN_CHARS = 2;

// ISO3 → country name, so "thailand"/"egypt" match sites stored as THA/EGY.
// Covers the dive nations present in the data; unknown codes just keep the code.
const ISO3 = {THA:"Thailand",IDN:"Indonesia",EGY:"Egypt",PHL:"Philippines",MEX:"Mexico",
ESP:"Spain",USA:"United States",FRA:"France",ITA:"Italy",GRC:"Greece",HRV:"Croatia",
AUS:"Australia",MDV:"Maldives",JPN:"Japan",DEU:"Germany",GBR:"United Kingdom",
MYS:"Malaysia",TUR:"Turkey",PRT:"Portugal",NLD:"Netherlands",CHE:"Switzerland",
ZAF:"South Africa",NZL:"New Zealand",CAN:"Canada",NOR:"Norway",SWE:"Sweden",
ISR:"Israel",SAU:"Saudi Arabia",ARE:"United Arab Emirates",IND:"India",CHN:"China",
KOR:"South Korea",VNM:"Vietnam",KHM:"Cambodia",LKA:"Sri Lanka",TZA:"Tanzania",
KEN:"Kenya",MOZ:"Mozambique",SDN:"Sudan",DJI:"Djibouti",CRI:"Costa Rica",
CUB:"Cuba",DOM:"Dominican Republic",HND:"Honduras",BLZ:"Belize",ECU:"Ecuador",
BRA:"Brazil",ARG:"Argentina",CHL:"Chile",COL:"Colombia",PAN:"Panama",
FJI:"Fiji",PLW:"Palau",FSM:"Micronesia",PNG:"Papua New Guinea",SLB:"Solomon Islands",
POL:"Poland",AUT:"Austria",BEL:"Belgium",DNK:"Denmark",FIN:"Finland",IRL:"Ireland",
MLT:"Malta",CYP:"Cyprus",JOR:"Jordan",OMN:"Oman",QAT:"Qatar",BHR:"Bahrain",
SGP:"Singapore",TWN:"Taiwan",MMR:"Myanmar",MUS:"Mauritius",SYC:"Seychelles",
MDG:"Madagascar",CPV:"Cape Verde",ISL:"Iceland",HKG:"Hong Kong",GUM:"Guam"};

function normalize(s){ return (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,""); }

async function buildSearchIndex() {
  try {
    const [ssi, padi] = await Promise.all([
      fetch(DATA.sites_ssi).then(r=>r.json()),
      fetch(DATA.sites_padi).then(r=>r.json()),
    ]);
    const idx = [];
    for (const f of ssi.features) {
      const p = f.properties;
      const cname = ISO3[p.country] || p.country || "";
      idx.push({ name: p.name, nameNorm: normalize(p.name), country: cname,
        // searchable country text = full name + ISO3 code, so "thailand" or "tha" both hit
        countryNorm: normalize(cname + " " + (p.country||"")), dives: p.dives||0, src: "ssi", id: p.id,
        lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
    for (const f of padi.features) {
      const p = f.properties;
      if (!p.named) continue;            // exclude ~1,100 "Unnamed PADI" points
      idx.push({ name: p.name, nameNorm: normalize(p.name), country: "",
        countryNorm: "", dives: -1, src: "padi", id: p.id,
        lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
    SEARCH.index = idx; SEARCH.ready = true;
  } catch (e) { console.warn("search index failed", e); }
}

function runSearch(q) {
  const nq = normalize(q.trim());
  if (nq.length < MIN_CHARS) return [];
  const scored = [];
  for (const r of SEARCH.index) {
    let s = -1;
    if (r.nameNorm === nq) s = 0;                       // exact name
    else if (r.nameNorm.startsWith(nq)) s = 1;          // name starts-with
    else if (r.nameNorm.includes(nq)) s = 2;            // name contains
    else if (r.countryNorm && r.countryNorm.startsWith(nq)) s = 3;
    else if (r.countryNorm && r.countryNorm.includes(nq)) s = 4;
    if (s >= 0) scored.push({ r, s });
  }
  // bucket by match quality, then by dives desc (SSI floats up), then name
  scored.sort((a,b) => a.s - b.s || (b.r.dives - a.r.dives) || a.r.name.localeCompare(b.r.name));
  return scored.map(x => x.r);
}

function renderResults(q) {
  const box = document.getElementById("results");
  const head = document.getElementById("resultsHead");
  const list = document.getElementById("resultsList");
  if (q.trim().length < MIN_CHARS) { box.hidden = true; return; }
  const all = SEARCH.matches;
  box.hidden = false;
  SEARCH.activeIdx = -1;
  if (!all.length) {
    head.textContent = `No sites match "${q.trim()}"`;
    list.innerHTML = `<li class="results__empty">Try a site name like "Blue Hole" or a country.</li>`;
    return;
  }
  const shown = all.slice(0, MAX_RESULTS);
  head.textContent = all.length > MAX_RESULTS
    ? `Showing top ${MAX_RESULTS} of ${all.length.toLocaleString()} · Enter to map`
    : `${all.length} match${all.length>1?"es":""} · Enter to map`;
  list.innerHTML = shown.map((r,i) => {
    const meta = r.src === "ssi"
      ? `${r.country||"-"}` : `PADI · no dive count`;
    const dives = r.src === "ssi" ? `${(r.dives||0).toLocaleString()}` : "";
    return `<li class="res" data-i="${i}">
      <span class="res__dot res__dot--${r.src}"></span>
      <span class="res__main"><span class="res__name">${esc(r.name)}</span>
        <span class="res__meta">${esc(meta)}</span></span>
      ${dives?`<span class="res__dives">${dives}<br><span class="res__src">dives</span></span>`:`<span class="res__src">PADI</span>`}
    </li>`;
  }).join("");
  list.querySelectorAll(".res").forEach(li => {
    li.addEventListener("click", () => selectResult(shown[+li.dataset.i]));
  });
}

function addSearchLayer() {
  if (!map || map.getSource("search-hits")) return;
  map.addSource("search-hits", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "search-hits-halo", type: "circle", source: "search-hits",
    paint: { "circle-radius": 11, "circle-color": "#fff3b0", "circle-opacity": 0.18,
      "circle-stroke-color": "#ffd07b", "circle-stroke-width": 1 },
  });
  map.addLayer({
    id: "search-hits-pt", type: "circle", source: "search-hits",
    paint: { "circle-radius": 6, "circle-color": ["match", ["get","src"], "ssi", "#ff7964", "#6be0d0"],
      "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 },
  });
  map.on("click", "search-hits-pt", e => {
    const p = e.features[0].properties;
    selectResult(SEARCH.index.find(r => String(r.id)===String(p.id) && r.src===p.src) || null, true);
  });
  map.on("mouseenter","search-hits-pt",()=>map.getCanvas().style.cursor="pointer");
  map.on("mouseleave","search-hits-pt",()=>map.getCanvas().style.cursor="");
}

function commitToMap() {
  if (!map || !map.getSource("search-hits")) return;
  const feats = SEARCH.matches.slice(0, 2000).map(r => ({   // cap plotted markers
    type:"Feature", geometry:{type:"Point",coordinates:[r.lng,r.lat]},
    properties:{ id:r.id, src:r.src, name:r.name } }));
  map.getSource("search-hits").setData({ type:"FeatureCollection", features: feats });
  if (feats.length) {
    const b = new maplibregl.LngLatBounds();
    feats.forEach(f => b.extend(f.geometry.coordinates));
    map.fitBounds(b, { padding: 80, maxZoom: 9, duration: 900 });
  }
}

function clearMapHits() {
  if (map && map.getSource("search-hits"))
    map.getSource("search-hits").setData({ type:"FeatureCollection", features: [] });
}

function closeResults() {
  document.getElementById("results").hidden = true;
  SEARCH.activeIdx = -1;
  const i = document.getElementById("searchInput");
  if (i) i.blur();   // dismiss the mobile keyboard
}

function selectResult(r, fromMap) {
  if (!r) return;
  closeResults();
  const goGlobe = document.querySelector('#tabs .tab[data-view="globe"]');
  if (goGlobe && !goGlobe.classList.contains("tab--on")) goGlobe.click();
  if (map) {
    if (!fromMap) {
      map.getSource("search-hits") && map.getSource("search-hits").setData({
        type:"FeatureCollection", features:[{type:"Feature",geometry:{type:"Point",coordinates:[r.lng,r.lat]},properties:{id:r.id,src:r.src,name:r.name}}] });
    }
    map.flyTo({ center: [r.lng, r.lat], zoom: 11, speed: 1.5 });
    const det = { name:r.name, country:r.country, loggedDives:r.dives>0?r.dives:0 };
    const layer = r.src==="ssi" ? "sites_ssi" : "sites_padi";
    getDetail(layer, r.id).then(d => {
      new maplibregl.Popup({maxWidth:"300px",offset:10})
        .setLngLat([r.lng,r.lat]).setHTML(renderPopup(layer, {name:r.name,id:r.id}, d)).addTo(map);
    });
  }
}

(function wireSearch(){
  const input = document.getElementById("searchInput");
  const clear = document.getElementById("searchClear");
  if (!input) return;
  let t = null;
  input.addEventListener("input", () => {
    clear.hidden = !input.value;
    clearTimeout(t);
    t = setTimeout(() => {
      SEARCH.matches = SEARCH.ready ? runSearch(input.value) : [];
      renderResults(input.value);
    }, 120);
  });
  input.addEventListener("keydown", e => {
    const shown = SEARCH.matches.slice(0, MAX_RESULTS);
    if (e.key === "Enter") {
      e.preventDefault();
      if (SEARCH.activeIdx >= 0 && shown[SEARCH.activeIdx]) selectResult(shown[SEARCH.activeIdx]);
      else { commitToMap(); closeResults(); }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const lis = document.querySelectorAll("#resultsList .res");
      if (!lis.length) return;
      SEARCH.activeIdx = (SEARCH.activeIdx + (e.key==="ArrowDown"?1:-1) + lis.length) % lis.length;
      lis.forEach((li,i)=>li.classList.toggle("res--active", i===SEARCH.activeIdx));
      lis[SEARCH.activeIdx].scrollIntoView({block:"nearest"});
    } else if (e.key === "Escape") { doClear(); }
  });
  function doClear(){
    input.value=""; clear.hidden=true; SEARCH.matches=[]; SEARCH.activeIdx=-1;
    document.getElementById("results").hidden=true; clearMapHits(); input.blur();
  }
  clear.addEventListener("click", doClear);
  // close button only hides the list (keeps the query + any map hits)
  document.getElementById("resultsClose").addEventListener("click", closeResults);
  // re-open the list when tapping back into a non-empty search box
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= MIN_CHARS && SEARCH.matches.length) {
      document.getElementById("results").hidden = false;
    }
  });
})();
