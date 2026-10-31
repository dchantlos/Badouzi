/* ============================================================
   Badouzi Port Digital Twin — application logic
   ArcGIS Maps SDK for JavaScript 5.1 (@arcgis/core, ES modules)
   ============================================================ */

// ArcGIS dark theme + ES module classes (bundled by Vite).
import "@arcgis/core/assets/esri/themes/dark/main.css";
import WebScene from "@arcgis/core/WebScene.js";
import SceneView from "@arcgis/core/views/SceneView.js";
import Slice from "@arcgis/core/widgets/Slice.js";
import Measurement from "@arcgis/core/widgets/Measurement.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Multipoint from "@arcgis/core/geometry/Multipoint.js";
import Point from "@arcgis/core/geometry/Point.js";
import Glow from "@arcgis/core/webscene/Glow.js";
import { createWeatherPanel } from "./weather.js";
import { setupFlight } from "./flight.js";
import { setupSmoothZoom } from "./smooth-zoom.js";
import {
  evaluateScenario,
  formatUSD,
  isAtOrBelowWater,
  isValidElevation,
  isValidUnitValue,
  summarizeCoverage
} from "./exposure.js";

// -------- Configuration --------------------------------------------------

// The ArcGIS Online Web Scene item to load.
const WEB_SCENE_ID = "4f053fd887b24a01927d47b766455e3c";

// Heavy 3D data layers exposed as simple on/off toggles.
// `title` must match the layer title inside the Web Scene exactly.
const DATA_LAYERS = [
  { title: "Badouzi (Gaussian Splat)", label: "Badouzi (Gaussian Splat)" },
  { title: "BIM Data", label: "BIM Data" },
  { title: "Point Cloud", label: "Point Cloud" }
];

// Mutually-exclusive storm-surge scenario layers.
// Order defines the segmented control order (Normal first).
const SURGE_LAYERS = [
  { title: "Normal Conditions", value: "0m", label: "Normal" },
  { title: "Above Sea Level 1m", value: "+1m", label: "Surge" },
  { title: "Above Sea Level 2m", value: "+2m", label: "Surge" },
  { title: "Above Sea Level 3m", value: "+3m", label: "Surge" }
];

// Approximate absolute water-surface elevation (gravity-related metres) for
// each scenario, taken from the scene's SeaLevel layer elevation offsets.
// `null` = baseline / no inundation analysis.
const SURGE_FLOOD_HEIGHTS = {
  "Normal Conditions": null,
  "Above Sea Level 1m": 3.0,
  "Above Sea Level 2m": 4.0,
  "Above Sea Level 3m": 5.0
};

// Waterfront point-asset layers assessed for exposure (Web Scene titles).
// `category` keys the assumed unit value; `nameField` / `namePrefix` label an
// individual asset in the marker inspector.
const ASSET_LAYERS = [
  {
    id: "bollards",
    title: "Mooring Bollards",
    category: "Mooring Bollards",
    label: "mooring bollards",
    singular: "mooring bollard",
    typeLabel: "Mooring bollard",
    nameField: "ID",
    namePrefix: "Bollard "
  },
  {
    id: "streetlights",
    title: "Street Lights",
    category: "Street Lights",
    label: "streetlights",
    singular: "streetlight",
    typeLabel: "Streetlight",
    nameField: "Pole_ID",
    namePrefix: ""
  }
];

// BIM building models expected in the scene. Any other BuildingSceneLayer in
// the scene is assessed too; an expected model that is missing or fails to
// load makes the result partial instead of silently shrinking the inventory.
const EXPECTED_BIM_MODELS = ["Fish Market", "Exhibition Center", "Bike Station"];

// ILLUSTRATIVE assumed replacement value (USD) per exposed feature. These are
// not damage or loss estimates. Every BIM model uses the same `building`
// value regardless of its size or use.
const ASSUMED_UNIT_VALUES_USD = {
  "Mooring Bollards": 1500,
  "Street Lights": 3200,
  building: 150000
};

// Display names for the assumed-value list in the assumptions panel.
const UNIT_VALUE_LABELS = {
  "Mooring Bollards": "Mooring bollard",
  "Street Lights": "Streetlight",
  building: "BIM building model"
};

// The reality mesh defines the land-sample footprint. It stays hidden (we only
// show the Gaussian Splat) but its extent is a stable analysis area for every
// scenario. If it is unavailable the land estimate is reported as unavailable
// rather than silently falling back to the current camera extent.
const REALITY_MESH_TITLE = "ArcGIS Reality Mesh - 2024";

// Baseline (normal) water-surface height in metres. Land above this is "dry"
// today; the land-sample estimate reports how much of that dry land lies at or
// below the scenario surface.
const BASELINE_WATER_HEIGHT = 2.2;

// Grid resolution (per axis) used to sample the site for coverage stats.
// 60 x 60 = 3600 elevation samples in a single query — plenty of detail.
const COVERAGE_GRID = 60;

// Fixed modelled-water-depth split for marker colours (orange below, red at or
// above). The same split applies to every scenario and drives the legend.
const DEPTH_SPLIT_M = 1.5;

// Friendly display config for the click inspector. Keys are layer titles;
// `fields` maps attribute field names to display labels (order preserved).
// Layers not listed here fall back to showing all populated attributes.
const INSPECTOR_FIELDS = {
  "Mooring Bollards": [
    { name: "ID", label: "Bollard ID" },
    { name: "Condition_Score", label: "Condition Score" },
    { name: "Date_Inspected", label: "Last Inspected", type: "date" }
  ],
  "Street Lights": [
    { name: "Pole_ID", label: "Pole ID" },
    { name: "Comments", label: "Name" },
    { name: "Height", label: "Height (m)" },
    { name: "Date_Installed", label: "Installed", type: "date" }
  ]
};

// -------- Load SDK modules -----------------------------------------------

/** Show a human-readable failure message on the intro overlay. */
function showOverlayError(message) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    const ring = overlay.querySelector(".loader-ring");
    if (ring) ring.style.animationPlayState = "paused";
    const title = overlay.querySelector(".loader-title");
    const sub = overlay.querySelector(".loader-sub");
    if (title) title.textContent = "Unable to load the scene";
    if (sub) sub.textContent = message;
  }
  const statusText = document.getElementById("statusText");
  if (statusText) statusText.textContent = "Error";
  console.error("[Badouzi Digital Twin]", message);
}

// Once the scene + view are ready we consider the app "up". After that point,
// stray async rejections (aborted ArcGIS requests, elevation/query hiccups,
// etc.) must NOT blank the whole UI — they're logged, not shown as fatal.
let appReady = false;

// Surface unexpected runtime errors ONLY while the app is still loading.
window.addEventListener("error", function (e) {
  if (appReady) {
    console.warn("[Badouzi Digital Twin] runtime error:", e.message);
    return;
  }
  showOverlayError(e.message || "Unexpected error. See the browser console.");
});
window.addEventListener("unhandledrejection", function (e) {
  const reason = e.reason && (e.reason.message || e.reason);
  if (appReady) {
    console.warn("[Badouzi Digital Twin] unhandled rejection:", reason);
    return;
  }
  showOverlayError("" + (reason || "Scene failed to load. See the browser console."));
});

function initApp() {
  // Live weather is independent of the 3D scene — start it now so the panel is
  // populated by the time the intro overlay lifts.
  createWeatherPanel();

  // Build the Web Scene from the portal item.
  const scene = new WebScene({
    portalItem: { id: WEB_SCENE_ID }
  });

  const view = new SceneView({
    container: "viewDiv",
    map: scene,
    // Keep the UI clean: only navigation zoom remains, styled via CSS.
    ui: { components: ["zoom"] },
    qualityProfile: "high"
  });

  // Graphics layer for exposure markers (glowing orbs, coloured by depth).
  const impactLayer = new GraphicsLayer({
    title: "__surge_impact__",
    listMode: "hide",
    elevationInfo: { mode: "absolute-height" }
  });
  scene.add(impactLayer);

  // Temporary marker layer for the click-to-check "Location Flood Check".
  // relative-to-ground so the reticle's flat base pad hugs the terrain/water
  // surface automatically (elevationInfo is a layer-level property in the JS API).
  const probeLayer = new GraphicsLayer({
    title: "__flood_probe__",
    listMode: "hide",
    elevationInfo: { mode: "relative-to-ground" }
  });
  scene.add(probeLayer);

  // High-tech 3D volumetric "holographic laser" reticle for the Location Flood
  // Check. Three stacked ObjectSymbol3DLayer cylinders — all true 3D volumes
  // (never billboard): a flat base pad that lies parallel to the surface, a
  // wide semi-transparent outer beam, and a narrow bright inner core.
  const RETICLE_SYMBOL = {
    type: "point-3d",
    symbolLayers: [
      // 1) Base pad — a very wide, flat disc. Being a flat cylinder it lies
      //    parallel to the 3D surface instead of facing the camera.
      {
        type: "object",
        resource: { primitive: "cylinder" },
        material: { color: [50, 205, 50, 0.7] },
        width: 7,
        depth: 7,
        height: 0.1,
        anchor: "bottom"
      },
      // 2) Holographic beam (outer) — short, wide, semi-transparent lime volume.
      {
        type: "object",
        resource: { primitive: "cylinder" },
        material: { color: [50, 205, 50, 0.4] },
        width: 1.6,
        depth: 1.6,
        height: 24,
        anchor: "bottom"
      },
      // 3) Laser core (inner) — a narrow bright core inside the beam.
      {
        type: "object",
        resource: { primitive: "cylinder" },
        material: { color: [200, 255, 180] },
        width: 0.35,
        depth: 0.35,
        height: 24,
        anchor: "bottom"
      }
    ]
  };

  // -------- Depth symbology ---------------------------------------------
  // Marker colour encodes MODELLED WATER DEPTH at the asset (water surface
  // minus sampled ground), using one fixed split for every scenario:
  // orange below DEPTH_SPLIT_M, red at or above. It is not a damage category.
  function depthSeverity(depth) {
    if (depth >= DEPTH_SPLIT_M) return { color: [255, 0, 0], level: "deep" }; // #FF0000
    return { color: [255, 165, 0], level: "shallow" }; // #FFA500
  }

  // -------- Holographic HUD risk markers --------------------------------
  // Minimal white line-art glyphs (viewBox 24), tinted at runtime via
  // material.color and drawn as a small second icon layer centred over the
  // glassy ring so each marker reads its feature type. Encoded as data URIs.
  function svgGlyph(inner) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" ' +
      'stroke-linejoin="round">' + inner + "</svg>";
    return "data:image/svg+xml;base64," + btoa(svg);
  }

  const RISK_GLYPHS = {
    // anchor — mooring bollards
    "Mooring Bollards": svgGlyph(
      '<circle cx="12" cy="4" r="2"/><path d="M12 6v14"/>' +
        '<path d="M5 12a7 7 0 0 0 14 0"/><path d="M3 12h4M17 12h4"/>'
    ),
    // lamp — street lights
    "Street Lights": svgGlyph(
      '<path d="M12 2a3 3 0 0 1 3 3c0 2.2-3 4-3 4s-3-1.8-3-4a3 3 0 0 1 3-3z"/>' +
        '<path d="M12 9v11"/><path d="M9 20h6"/>'
    ),
    // building — BIM facilities
    building: svgGlyph(
      '<rect x="5" y="3" width="14" height="18" rx="1"/>' +
        '<path d="M10 21v-5h4v5"/><path d="M9 8h6M9 12h6"/>'
    )
  };

  // -------- Glowing orb risk markers ------------------------------------
  // Each at-risk feature is flagged with a translucent, severity-tinted 3D
  // "orb" (a sphere object symbol) that SELF-EMITS light via an emissive
  // material and blooms through the scene-level webscene Glow enabled in
  // view.when() — so markers read as glowing beacons floating on a thin
  // callout "pin" above the reality mesh. The type glyph stays legible inside
  // the glassy orb. Orb size is world-space (metres); tune ORB_* to taste.
  const ORB_EMISSIVE = 2.4; // self-emission strength (bloomed by scene Glow)
  const ORB_ALPHA = 0.55; // glassy translucency so the glyph reads through
  const ORB_SIZE = 2; // point-asset orb diameter, metres
  const BUILDING_ORB_SIZE = 3; // larger orb for at-risk BIM buildings

  // Emissive "glowing glass" sphere tinted by severity.
  function orbLayer(color, size) {
    return {
      type: "object",
      resource: { primitive: "sphere" },
      material: {
        color: [color[0], color[1], color[2], ORB_ALPHA],
        emissive: { strength: ORB_EMISSIVE, source: "color" }
      },
      width: size,
      depth: size,
      height: size,
      anchor: "center"
    };
  }

  // Glowing-orb marker hung on a near-invisible hairline callout "pin" so it
  // never blocks the reality mesh. The small type glyph reads through the glass.
  function makeImpactSymbol(depth, layerTitle) {
    const c = depthSeverity(depth).color;
    const layers = [orbLayer(c, ORB_SIZE)];
    const glyph = RISK_GLYPHS[layerTitle];
    if (glyph) {
      layers.push({
        type: "icon",
        resource: { href: glyph },
        material: { color: [255, 255, 255, 0.9] },
        size: 6
      });
    }
    return {
      type: "point-3d",
      symbolLayers: layers,
      verticalOffset: { screenLength: 26, maxWorldLength: 60, minWorldLength: 12 },
      callout: { type: "line", size: 0.75, color: [255, 255, 255, 0.4] }
    };
  }

  // Larger glowing orb for an at-risk BIM building.
  function makeBuildingImpactSymbol(depth) {
    const c = depthSeverity(depth).color;
    return {
      type: "point-3d",
      symbolLayers: [
        orbLayer(c, BUILDING_ORB_SIZE),
        {
          type: "icon",
          resource: { href: RISK_GLYPHS.building },
          material: { color: [255, 255, 255, 0.9] },
          size: 9
        }
      ],
      verticalOffset: { screenLength: 44, maxWorldLength: 130, minWorldLength: 30 },
      callout: { type: "line", size: 0.75, color: [255, 255, 255, 0.4] }
    };
  }

  // Scene-level bloom applies only to emissive surfaces, including the orbs
  // and optional Godzilla plates; reality capture and terrain are untouched.
  const SCENE_GLOW = 0.85; // webscene Glow intensity, 0..1
  function enableSceneGlow() {
    const lighting = view.environment && view.environment.lighting;
    if (lighting) lighting.glow = new Glow({ intensity: SCENE_GLOW });
  }

  /**
   * Find a layer anywhere in the scene (top-level or nested in group layers)
   * by matching its title.
   */
  function findLayerByTitle(title) {
    return scene.allLayers.find(function (layer) {
      return layer.title === title;
    });
  }

  /** Build the layer visibility toggle switches. */
  function buildLayerToggles() {
    const container = document.getElementById("layerToggles");

    DATA_LAYERS.forEach(function (cfg) {
      const layer = findLayerByTitle(cfg.title);

      const row = document.createElement("div");
      row.className = "toggle-row" + (layer ? "" : " missing");

      const label = document.createElement("span");
      label.className = "toggle-label";
      label.textContent = layer ? cfg.label : cfg.label + " (unavailable)";

      const switchWrap = document.createElement("label");
      switchWrap.className = "switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = layer ? layer.visible : false;
      input.disabled = !layer;

      const slider = document.createElement("span");
      slider.className = "slider";

      input.addEventListener("change", function () {
        if (layer) {
          layer.visible = input.checked;
        }
      });

      switchWrap.appendChild(input);
      switchWrap.appendChild(slider);
      row.appendChild(label);
      row.appendChild(switchWrap);
      container.appendChild(row);
    });
  }

  /**
   * Dynamic Weather Simulation: match the scene's weather + lighting to the
   * severity of the selected tidal / storm-surge scenario. Called from the
   * scenario activate() below, so it updates immediately on every switch.
   *
   * Rain precipitation is opt-in via the console "Rain" toggle (rainEnabled) —
   * the particle sim is GPU-heavy, so by default the storm reads through heavy
   * cloud cover + darker lighting alone (no lag).
   */
  function applyScenarioWeather(value) {
    const env = view.environment;

    // The Rain toggle only makes sense for the wetter scenarios — show it for
    // +2m / +3m, hide it for Normal (0m) and +1m where rain never applies.
    const rainApplicable = value === "+2m" || value === "+3m";
    const rainInput = document.getElementById("rainToggle");
    const rainWrap = rainInput && rainInput.closest(".console-rain");
    if (rainWrap) rainWrap.hidden = !rainApplicable;

    if (!env) return;

    switch (value) {
      case "+1m": // moody, overcast late afternoon
        env.weather = { type: "cloudy", cloudCover: 0.8 };
        if (env.lighting) env.lighting.date = new Date("March 15, 2024 16:00:00");
        break;
      case "+2m": // heavy cloud, darker afternoon; rain only if toggled on
        env.weather = rainEnabled
          ? { type: "rainy", cloudCover: 0.9, precipitation: 0.5 }
          : { type: "cloudy", cloudCover: 0.9 };
        if (env.lighting) env.lighting.date = new Date("March 15, 2024 16:00:00");
        break;
      case "+3m": // cloud + sunlight matched to +2m; heavier rain when toggled on
        env.weather = rainEnabled
          ? { type: "rainy", cloudCover: 0.9, precipitation: 1.0 }
          : { type: "cloudy", cloudCover: 0.9 };
        if (env.lighting) env.lighting.date = new Date("March 15, 2024 16:00:00");
        break;
      default: // "0m" — bright, calm, sunny mid-day
        env.weather = { type: "sunny", cloudCover: 0.2 };
        if (env.lighting) env.lighting.date = new Date("March 15, 2024 12:00:00");
        break;
    }
  }

  /** Wire the console "Rain" toggle: opt into precipitation, re-apply weather. */
  function setupRainToggle() {
    const toggle = document.getElementById("rainToggle");
    if (!toggle) return;
    toggle.checked = rainEnabled;
    toggle.addEventListener("change", function () {
      rainEnabled = toggle.checked;
      applyScenarioWeather(activeScenarioValue);
    });
  }

  /** Build the mutually-exclusive storm-surge segmented control. */
  function buildSurgeControl() {
    const container = document.getElementById("surgeControl");
    const readout = document.getElementById("surgeReadout");
    const readoutNote = document.getElementById("surgeNote");

    // Resolve each surge scenario to its actual layer (may be null if absent).
    const resolved = SURGE_LAYERS.map(function (cfg) {
      return { cfg: cfg, layer: findLayerByTitle(cfg.title) };
    });

    /** Turn on exactly one scenario, turn every other off. */
    function activate(activeCfg) {
      resolved.forEach(function (item) {
        if (item.layer) {
          item.layer.visible = item.cfg.title === activeCfg.title;
        }
      });

      // Update button states.
      container.querySelectorAll(".segment").forEach(function (btn) {
        const isActive = btn.dataset.title === activeCfg.title;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", String(isActive));
      });

      readout.textContent = activeCfg.title;

      // Track the active scenario so the click inspector can report flood
      // status at any point the user clicks.
      activeScenarioTitle = activeCfg.title;
      activeScenarioValue = activeCfg.value;

      const isReference = !isSurgeScenario(activeCfg.title);
      if (readoutNote) {
        readoutNote.textContent = isReference
          ? "Reference view \u2014 exposure not assessed"
          : "Sky & rain effects illustrative";
      }

      // Dynamic Weather Simulation — sync environment to scenario severity.
      applyScenarioWeather(activeCfg.value);

      // Run (or clear) the what-if exposure analysis for this scenario.
      runSurgeImpact(activeCfg.title);

      // Keep an open location / asset card in step with the new scenario.
      refreshInspector();
      godzilla?.onScenarioChange();
    }

    // Comparison rows reuse this exact activation flow.
    activateScenario = function (title) {
      const item = resolved.find(function (r) {
        return r.cfg.title === title;
      });
      if (item && item.layer) activate(item.cfg);
    };

    resolved.forEach(function (item, index) {
      const btn = document.createElement("button");
      btn.className = "segment";
      btn.type = "button";
      btn.dataset.title = item.cfg.title;
      btn.setAttribute("aria-pressed", "false");
      if (!item.layer) {
        btn.disabled = true;
        btn.title = item.cfg.title + " is not available in this scene";
      }

      const value = document.createElement("span");
      value.className = "seg-value";
      value.textContent = item.cfg.value;

      const label = document.createElement("span");
      label.className = "seg-label";
      label.textContent = item.cfg.label;

      btn.appendChild(value);
      btn.appendChild(label);
      btn.addEventListener("click", function () {
        if (item.layer) activate(item.cfg);
      });

      container.appendChild(btn);

      // Default the very first scenario (Normal Conditions) as active.
      if (index === 0) {
        activate(item.cfg);
      }
    });
  }

  /** Format an attribute value for display (handles epoch-millisecond dates). */
  function formatValue(value, type) {
    if (value === null || value === undefined || value === "") return "\u2014";
    if (type === "date" && !isNaN(Number(value))) {
      return new Date(Number(value)).toLocaleDateString();
    }
    return String(value);
  }

  // The scenario currently selected in the surge control. The click inspector
  // uses it to report flood status at the clicked location.
  let activeScenarioTitle = "Normal Conditions";
  // The active scenario's short value ("0m" / "+1m" / …) plus whether the user
  // has opted into rain. Rain is off by default — the precipitation particle
  // sim is GPU-heavy; cloud cover alone conveys the storm without the lag.
  let activeScenarioValue = "0m";
  let rainEnabled = false;

  // Hooks wired up once their controls exist (buildSurgeControl /
  // setupAssetInspector); harmless no-ops until then.
  let activateScenario = function () {};
  let refreshInspector = function () {};
  let closeInspector = function () {};
  let godzilla = null;
  let flight = null;
  let smoothZoom = null;

  /** True for the what-if scenarios that have an analysis water surface. */
  function isSurgeScenario(title) {
    return typeof SURGE_FLOOD_HEIGHTS[title] === "number";
  }

  function scenarioValue(title) {
    const cfg = SURGE_LAYERS.find(function (s) {
      return s.title === title;
    });
    return cfg ? cfg.value : title;
  }

  function formatMetres(z) {
    return z.toFixed(1) + " m";
  }

  function log(message, detail) {
    console.warn("[Badouzi Digital Twin] " + message, detail === undefined ? "" : detail);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHidden(id, hidden) {
    const el = document.getElementById(id);
    if (el) el.hidden = hidden;
  }

  // ======================================================================
  // What-if exposure analysis
  // ----------------------------------------------------------------------
  // A static comparison of sampled terrain elevation with a flat scenario
  // water surface — not a hydrodynamic model. The inventory (asset
  // locations, their sampled ground elevations and the land-sample grid) is
  // loaded once, shared by every scenario and evaluated in memory, so the
  // comparison table needs no extra requests. Only successful loads are
  // cached: a failed input is requested again on the next run or via Retry,
  // and is never reported as zero exposure.
  // ======================================================================

  const inventoryCache = new Map(); // input id -> Promise<input>
  let inventoryItems = new Map(); // item key -> assessed asset (marker inspector)
  let lastInventory = null;
  let surgeRunId = 0;

  function cachedInput(id, loader, fallback) {
    if (!inventoryCache.has(id)) {
      const pending = loader()
        .catch(function (err) {
          log("analysis input failed: " + id, err);
          return Object.assign({ id: id, status: "failed" }, fallback);
        })
        .then(function (input) {
          // Cache only clean successes. No-data samples can come from a
          // transient elevation outage, so those inputs are re-requested.
          const cacheable =
            input.status === "ok" &&
            !input.retryable &&
            !(input.items || []).some(function (item) {
              return item.retryable;
            });
          if (!cacheable && inventoryCache.get(id) === pending) inventoryCache.delete(id);
          return input;
        });
      inventoryCache.set(id, pending);
    }
    return inventoryCache.get(id);
  }

  /**
   * Sample terrain elevation for a Point or Multipoint. Returns one z per
   * coordinate, or null where the SDK reports no data (sampleInfo
   * demResolution of -1) — never a substituted zero.
   */
  async function sampleGround(geometry) {
    const result = await view.map.ground.queryElevation(geometry, { returnSampleInfo: true });
    const zs =
      geometry.type === "multipoint"
        ? result.geometry.points.map(function (p) {
            return p[2];
          })
        : [result.geometry.z];
    return zs.map(function (z, i) {
      const info = result.sampleInfo && result.sampleInfo[i];
      if (info && info.demResolution === -1) return null;
      return isValidElevation(z) ? z : null;
    });
  }

  function assetName(cfg, attrs, oidField) {
    const value = attrs[cfg.nameField];
    if (value !== null && value !== undefined && value !== "") return (cfg.namePrefix || "") + value;
    const oid = attrs[oidField];
    return oid !== null && oid !== undefined ? "Object ID " + oid : "";
  }

  /** Load one waterfront point-asset layer and sample its ground elevations. */
  async function loadPointAssets(cfg) {
    const input = { id: cfg.id, label: cfg.label, singular: cfg.singular };
    const layer = findLayerByTitle(cfg.title);
    if (!layer || typeof layer.queryFeatures !== "function") {
      log("expected analysis layer not found: " + cfg.title);
      return Object.assign(input, { status: "missing", reason: cfg.singular + " layer not found" });
    }

    let featureSet;
    try {
      await layer.load();
      const query = layer.createQuery();
      query.where = "1=1";
      query.returnGeometry = true;
      query.outFields = ["*"];
      featureSet = await layer.queryFeatures(query);
    } catch (err) {
      log("asset query failed: " + cfg.title, err);
      return Object.assign(input, { status: "failed", reason: cfg.singular + " data unavailable" });
    }
    if (featureSet.exceededTransferLimit) {
      log("asset query truncated by the service record limit: " + cfg.title);
      return Object.assign(input, { status: "failed", reason: cfg.singular + " data incomplete" });
    }

    const oidField = layer.objectIdField;
    const items = featureSet.features.map(function (f, i) {
      const g = f.geometry;
      const attrs = f.attributes || {};
      const oid = attrs[oidField];
      const item = {
        key: cfg.id + ":" + (oid !== null && oid !== undefined ? oid : "row" + i),
        category: cfg.category,
        typeLabel: cfg.typeLabel,
        layerTitle: cfg.title,
        sourceLabel: cfg.title,
        name: assetName(cfg, attrs, oidField),
        attributes: attrs,
        groundZ: null
      };
      if (g && isValidElevation(g.x) && isValidElevation(g.y)) {
        item.x = g.x;
        item.y = g.y;
        item.sr = g.spatialReference;
      } else {
        item.issue = "no mapped location";
      }
      return item;
    });

    const located = items.filter(function (item) {
      return !item.issue;
    });
    if (located.length) {
      try {
        const zs = await sampleGround(
          new Multipoint({
            points: located.map(function (item) {
              return [item.x, item.y];
            }),
            spatialReference: located[0].sr
          })
        );
        located.forEach(function (item, i) {
          item.groundZ = zs[i];
          if (zs[i] === null) {
            item.issue = "no ground elevation data";
            item.retryable = true;
          }
        });
      } catch (err) {
        log("ground elevation sampling failed: " + cfg.title, err);
        return Object.assign(input, {
          status: "failed",
          reason: cfg.singular + " ground elevations unavailable"
        });
      }
    }
    return Object.assign(input, { status: "ok", items: items });
  }

  /**
   * BIM building models: each model is tested at ONE representative point —
   * the centre of its layer extent — not a footprint or finished-floor level.
   * Models are assessed whether or not the BIM layer is currently visible.
   * (The Gaussian splat is visual-only: buildings that exist only there are
   * not discrete inventory records and are not assessed.)
   */
  async function loadBimModels() {
    const input = { id: "bim", label: "BIM building models", singular: "BIM building model" };
    const found = scene.allLayers
      .filter(function (l) {
        return l.type === "building-scene";
      })
      .toArray();
    const titles = EXPECTED_BIM_MODELS.slice();
    found.forEach(function (l) {
      if (titles.indexOf(l.title) === -1) titles.push(l.title);
    });
    if (!titles.length) {
      return Object.assign(input, { status: "missing", reason: "no BIM building models found" });
    }

    const items = await Promise.all(
      titles.map(async function (title) {
        const layer = found.find(function (l) {
          return l.title === title;
        });
        const item = {
          key: "bim:" + title,
          category: "building",
          typeLabel: "BIM building model",
          layerTitle: title,
          sourceLabel: title + " (BIM Data)",
          name: title,
          groundZ: null,
          representativePoint: true
        };
        if (!layer) {
          log("expected BIM model not found: " + title);
          item.issue = "model not found in the scene";
          return item;
        }
        try {
          await layer.load();
          const center = layer.fullExtent && layer.fullExtent.center;
          if (!center) {
            item.issue = "model extent unavailable";
            return item;
          }
          item.x = center.x;
          item.y = center.y;
          item.sr = center.spatialReference;
          const zs = await sampleGround(
            new Point({ x: center.x, y: center.y, spatialReference: center.spatialReference })
          );
          item.groundZ = zs[0];
          if (item.groundZ === null) {
            item.issue = "no ground elevation data";
            item.retryable = true;
          }
        } catch (err) {
          log("BIM model assessment failed: " + title, err);
          item.groundZ = null;
          item.issue = "model or ground elevation unavailable";
          item.retryable = true;
        }
        return item;
      })
    );
    return Object.assign(input, { status: "ok", items: items });
  }

  /**
   * Land-sample grid: COVERAGE_GRID x COVERAGE_GRID terrain samples over the
   * reality mesh's (fixed) extent. A sampling estimate, not a flood boundary.
   */
  async function loadLandSample() {
    const mesh = findLayerByTitle(REALITY_MESH_TITLE);
    if (!mesh) {
      log("land-sample extent layer not found: " + REALITY_MESH_TITLE);
      return { id: "coverage", status: "missing", reason: "analysis extent unavailable" };
    }
    try {
      await mesh.load();
      const extent = mesh.fullExtent;
      if (!extent) return { id: "coverage", status: "missing", reason: "analysis extent unavailable" };

      const cols = COVERAGE_GRID;
      const rows = COVERAGE_GRID;
      const dx = extent.width / (cols - 1);
      const dy = extent.height / (rows - 1);
      const pts = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          pts.push([extent.xmin + c * dx, extent.ymin + r * dy]);
        }
      }
      const samples = await sampleGround(
        new Multipoint({ points: pts, spatialReference: extent.spatialReference })
      );
      return {
        id: "coverage",
        status: "ok",
        samples: samples,
        retryable: samples.some(function (z) {
          return z === null;
        })
      };
    } catch (err) {
      log("land-sample elevation query failed", err);
      return { id: "coverage", status: "failed", reason: "elevation sampling failed" };
    }
  }

  /** Shared inventory for every scenario; concurrent runs share requests. */
  async function loadInventory() {
    const assets = Promise.all(
      ASSET_LAYERS.map(function (cfg) {
        return cachedInput(
          cfg.id,
          function () {
            return loadPointAssets(cfg);
          },
          { label: cfg.label, singular: cfg.singular, reason: cfg.singular + " data unavailable" }
        );
      }).concat(
        cachedInput("bim", loadBimModels, {
          label: "BIM building models",
          singular: "BIM building model",
          reason: "BIM building models unavailable"
        })
      )
    );
    const coverage = cachedInput("coverage", loadLandSample, { reason: "elevation sampling failed" });
    return { assets: await assets, coverage: await coverage };
  }

  /** Evaluate every what-if scenario against the same inventory. */
  function evaluateScenarios(inventory) {
    const results = {};
    SURGE_LAYERS.forEach(function (cfg) {
      if (!isSurgeScenario(cfg.title)) return;
      const waterZ = SURGE_FLOOD_HEIGHTS[cfg.title];
      const cov = inventory.coverage;
      results[cfg.title] = {
        exposure: evaluateScenario(inventory.assets, waterZ, ASSUMED_UNIT_VALUES_USD),
        coverage:
          cov.status === "ok"
            ? Object.assign(
                { status: "ok" },
                summarizeCoverage(cov.samples, BASELINE_WATER_HEIGHT, waterZ)
              )
            : { status: cov.status, reason: cov.reason }
      };
    });
    return results;
  }

  /**
   * Run (or clear) the exposure analysis for a scenario. Every call bumps the
   * run generation; an older run still awaiting data exits without touching
   * the markers or panel, so rapid switching (e.g. +3m → +1m → Normal) can
   * never restore a stale result.
   */
  async function runSurgeImpact(scenarioTitle) {
    const runId = ++surgeRunId;
    impactLayer.removeAll();

    if (!isSurgeScenario(scenarioTitle)) {
      renderReferenceState();
      return;
    }

    renderLoadingState(scenarioTitle);
    let inventory;
    try {
      inventory = await loadInventory();
    } catch (err) {
      log("exposure analysis failed", err);
      inventory = {
        assets: [
          { id: "assets", label: "mapped assets", status: "failed", reason: "analysis inputs could not be loaded" }
        ],
        coverage: { id: "coverage", status: "failed", reason: "elevation sampling failed" }
      };
    }
    if (runId !== surgeRunId) return; // superseded by a newer selection

    lastInventory = inventory;
    inventoryItems = new Map();
    inventory.assets.forEach(function (input) {
      (input.items || []).forEach(function (item) {
        inventoryItems.set(item.key, item);
      });
    });

    const results = evaluateScenarios(inventory);
    const current = results[scenarioTitle];
    drawImpactMarkers(current.exposure);
    renderExposure(current);
    renderComparison(scenarioTitle, results);
    // Measure after the drawer's open transition has settled.
    setTimeout(updateMoreHint, 500);
  }

  /** Glowing markers for exposed assets, coloured by modelled water depth. */
  function drawImpactMarkers(exposure) {
    impactLayer.removeAll();
    const graphics = [];
    exposure.exposed.forEach(function (e) {
      const item = e.item;
      if (!isValidElevation(item.x) || !isValidElevation(item.y)) return;
      graphics.push(
        new Graphic({
          geometry: new Point({ x: item.x, y: item.y, z: item.groundZ, spatialReference: item.sr }),
          symbol:
            item.category === "building"
              ? makeBuildingImpactSymbol(e.depth)
              : makeImpactSymbol(e.depth, item.layerTitle),
          attributes: { exposureKey: item.key }
        })
      );
    });
    impactLayer.addMany(graphics);
  }

  // -------- Exposure panel rendering -------------------------------------

  // A fully assessed result is badged "Simulation" — it is a what-if, not a
  // forecast. Partial / unavailable results keep their warning labels.
  const STATUS_CHIP_TEXT = {
    loading: "Analyzing\u2026",
    complete: "Simulation",
    partial: "Partial",
    unavailable: "Unavailable",
    reference: ""
  };

  function setStatusChip(status) {
    const chip = document.getElementById("analysisChip");
    if (!chip) return;
    chip.textContent = STATUS_CHIP_TEXT[status] || "";
    chip.className = "status-chip status-" + status;
    chip.title = status === "complete" ? "What-if simulation \u2014 all analysis inputs assessed" : "";
  }

  function setStatusMessage(text) {
    setHidden("analysisStatus", !text);
    setText("analysisStatusText", text || "");
  }

  /** Open / close the right-hand exposure panel; other panels make room. */
  function setExposureOpen(open) {
    const panel = document.getElementById("surgeImpact");
    if (panel) {
      panel.classList.toggle("visible", open);
      panel.setAttribute("aria-hidden", String(!open));
    }
    document.body.classList.toggle("exposure-open", open);
  }

  function setCount(num, label, tone) {
    const numEl = document.getElementById("impactCountNum");
    if (numEl) {
      numEl.textContent = num;
      numEl.className = "exp-count-num" + (tone ? " is-" + tone : "");
    }
    setText("impactCountLabel", label);
  }

  function renderReferenceState() {
    setExposureOpen(false);
    const panel = document.getElementById("surgeImpact");
    if (panel) panel.removeAttribute("aria-busy");
    setStatusChip("reference");
    setStatusMessage("");
    setText("exposureScenario", "");
    setCount("\u2014", "Reference view \u2014 exposure not assessed");
    renderTiles(null);
    setHidden("impactNote", true);
    setText("valueAtRisk", "\u2014");
    setHidden("valueSubtotal", true);
    setHidden("moreHint", true);
  }

  /** Clear the previous scenario's figures while a new result is loading. */
  function renderLoadingState(scenarioTitle) {
    setExposureOpen(true);
    const panel = document.getElementById("surgeImpact");
    if (panel) panel.setAttribute("aria-busy", "true");
    setStatusChip("loading");
    setStatusMessage("");
    setText("exposureScenario", scenarioValue(scenarioTitle) + " what-if \u00b7 " + scenarioTitle);
    setCount("\u2014", "Analyzing " + scenarioValue(scenarioTitle) + " exposure\u2026");
    renderTiles(null);
    setHidden("impactNote", true);
    setText("valueAtRisk", "\u2014");
    setHidden("valueSubtotal", true);
    setHidden("moreHint", true);
    renderComparison(scenarioTitle, null);
  }

  // Short tile labels; the assumptions panel and inspector carry full names.
  const TILE_LABELS = {
    bollards: ["Bollard", "Bollards"],
    streetlights: ["Streetlight", "Streetlights"],
    bim: ["BIM model", "BIM models"]
  };

  /** One large-number tile per assessed input (null = clear the tiles). */
  function renderTiles(ex) {
    const box = document.getElementById("impactTiles");
    if (!box) return;
    box.textContent = "";
    if (!ex || ex.status === "unavailable") return;
    ex.perInput.forEach(function (p) {
      const names = TILE_LABELS[p.id] || [p.singular || p.label, p.label];
      const tile = document.createElement("div");
      tile.className =
        "exp-tile is-" + p.id + (p.exposed === null || p.notAssessed ? " is-warn" : "");
      const num = document.createElement("strong");
      num.textContent = p.exposed === null ? "\u2014" : String(p.exposed);
      const label = document.createElement("span");
      label.textContent = p.exposed === 1 ? names[0] : names[1];
      tile.appendChild(num);
      tile.appendChild(label);
      if (p.exposed === null || p.notAssessed) {
        const note = document.createElement("small");
        note.textContent = p.exposed === null ? "unavailable" : p.notAssessed + " not assessed";
        tile.appendChild(note);
      }
      if (p.id === "bim" && p.exposed) {
        tile.title = ex.exposed
          .filter(function (e) {
            return e.item.category === "building";
          })
          .map(function (e) {
            return e.item.name;
          })
          .join(", ");
      }
      box.appendChild(tile);
    });
  }

  /** Average condition score of the exposed bollards that have one. */
  function conditionNote(ex) {
    const scores = ex.exposed
      .map(function (e) {
        return e.item.attributes && e.item.attributes.Condition_Score;
      })
      .filter(function (s) {
        return typeof s === "number" && !isNaN(s);
      });
    if (!scores.length) return "";
    const avg = scores.reduce(function (a, b) {
      return a + b;
    }, 0) / scores.length;
    return "Avg. condition score of exposed bollards: " + Math.round(avg);
  }

  /** Show the "More" cue while the panel has content below its fold. */
  function updateMoreHint() {
    const panel = document.getElementById("surgeImpact");
    const hint = document.getElementById("moreHint");
    if (!panel || !hint) return;
    const more =
      panel.classList.contains("visible") &&
      panel.scrollHeight - panel.scrollTop - panel.clientHeight > 12;
    hint.hidden = !more;
  }

  function renderExposure(result) {
    const ex = result.exposure;
    const cov = result.coverage;
    setExposureOpen(true);
    const panel = document.getElementById("surgeImpact");
    if (panel) panel.removeAttribute("aria-busy");
    setStatusChip(ex.status);

    const problems = ex.problems.join("; ");
    const coverageNote = cov.status === "ok" ? "" : "Land-sample estimate unavailable (" + cov.reason + ").";
    if (ex.status === "partial") {
      setStatusMessage(
        "Partial analysis \u2014 " + problems + ". The total is not complete." +
          (coverageNote ? " " + coverageNote : "")
      );
    } else if (ex.status === "unavailable") {
      setStatusMessage(
        "Analysis unavailable \u2014 " + problems + ". Exposure was not assessed." +
          (coverageNote ? " " + coverageNote : "")
      );
    } else {
      setStatusMessage(coverageNote ? coverageNote + " Asset exposure is complete." : "");
    }

    if (ex.status === "unavailable") {
      setCount("\u2014", "Exposure not assessed", "warn");
    } else if (!ex.countComplete) {
      setCount(String(ex.exposedCount), "exposed among assessed assets \u2014 incomplete", "warn");
    } else if (ex.exposedCount === 0) {
      setCount("0", "No assessed assets at or below this water level");
    } else {
      setCount(String(ex.exposedCount), ex.exposedCount === 1 ? "exposed mapped asset" : "exposed mapped assets");
    }
    renderTiles(ex);
    const note = conditionNote(ex);
    setText("impactNote", note);
    setHidden("impactNote", !note);

    // The headline total is shown only for a complete result.
    setText("valueAtRisk", ex.value === null ? "\u2014" : formatUSD(ex.value));
    const showSubtotal = ex.status === "partial" && ex.subtotal !== null;
    setHidden("valueSubtotal", !showSubtotal);
    if (showSubtotal) {
      setText(
        "valueSubtotal",
        "Subtotal for successfully assessed assets \u2014 incomplete: " + formatUSD(ex.subtotal)
      );
    }

  }

  // -------- Scenario comparison chart -------------------------------------
  // Bars: illustrative exposed value per scenario, stacked by asset type and
  // drawn from zero on one shared scale. Rings: share of sampled dry land at
  // or below each water level. Only complete results get a bar, so partial or
  // unavailable totals are never visually compared with complete ones.

  const TYPE_ORDER = ["bollards", "streetlights", "bim"];
  const TYPE_NAMES = { bollards: "Bollards", streetlights: "Streetlights", bim: "BIM models" };
  const CATEGORY_TYPE = { building: "bim" };
  ASSET_LAYERS.forEach(function (cfg) {
    CATEGORY_TYPE[cfg.category] = cfg.id;
  });

  const RING_R = 26;
  const RING_C = 2 * Math.PI * RING_R;
  const compareUI = new Map(); // scenario title -> chart elements

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Build the bar rows and rings once; renders then update them in place. */
  function ensureCompareUI() {
    if (compareUI.size) return true;
    const bars = document.getElementById("compareBars");
    const land = document.getElementById("compareLand");
    if (!bars || !land) return false;
    SURGE_LAYERS.forEach(function (cfg) {
      if (!isSurgeScenario(cfg.title)) return;

      const row = el("button", "cmp-row");
      row.type = "button";
      const track = el("span", "cmp-track");
      const segs = {};
      TYPE_ORDER.forEach(function (type) {
        segs[type] = el("span", "cmp-seg is-" + type);
        track.appendChild(segs[type]);
      });
      const msg = el("span", "cmp-msg");
      track.appendChild(msg);
      const val = el("span", "cmp-val");
      const amount = el("strong");
      const count = el("small");
      val.appendChild(amount);
      val.appendChild(count);
      row.appendChild(el("span", "cmp-level", cfg.value));
      row.appendChild(track);
      row.appendChild(val);
      row.addEventListener("click", function () {
        activateScenario(cfg.title);
      });
      bars.appendChild(row);

      const ring = el("button", "cmp-ring");
      ring.type = "button";
      const gauge = el("span", "cmp-gauge");
      gauge.innerHTML =
        '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
        '<circle class="cmp-gauge-bg" cx="32" cy="32" r="' + RING_R + '"></circle>' +
        '<circle class="cmp-gauge-bar" cx="32" cy="32" r="' + RING_R + '"></circle></svg>';
      const pct = el("span", "cmp-gauge-pct");
      gauge.appendChild(pct);
      ring.appendChild(gauge);
      ring.appendChild(el("span", "cmp-ring-label", cfg.value));
      ring.addEventListener("click", function () {
        activateScenario(cfg.title);
      });
      land.appendChild(ring);

      compareUI.set(cfg.title, {
        row: row,
        segs: segs,
        msg: msg,
        amount: amount,
        count: count,
        ring: ring,
        bar: gauge.querySelector(".cmp-gauge-bar"),
        pct: pct
      });
    });
    return true;
  }

  /** Exposed count and illustrative value per asset type. */
  function typeTotals(ex) {
    const totals = {};
    TYPE_ORDER.forEach(function (type) {
      totals[type] = { count: 0, value: 0 };
    });
    ex.exposed.forEach(function (e) {
      const t = totals[CATEGORY_TYPE[e.item.category]];
      if (!t) return;
      t.count++;
      if (e.unitValue !== null) t.value += e.unitValue;
    });
    return totals;
  }

  function setBarMessage(ui, text, tone) {
    TYPE_ORDER.forEach(function (type) {
      ui.segs[type].style.width = "0%";
      ui.segs[type].title = "";
    });
    ui.msg.textContent = text;
    ui.msg.className = "cmp-msg" + (tone ? " is-" + tone : "");
    ui.amount.textContent = "\u2014";
    ui.count.textContent = "";
  }

  function setRing(ui, pct) {
    const ok = typeof pct === "number" && isFinite(pct);
    const share = ok ? Math.max(0, Math.min(100, pct)) : 0;
    ui.bar.style.strokeDasharray = ((share / 100) * RING_C).toFixed(2) + " " + RING_C.toFixed(2);
    ui.bar.style.visibility = share > 0 ? "visible" : "hidden";
    ui.pct.textContent = ok ? pct.toFixed(1) + "%" : "\u2014";
    ui.ring.classList.toggle("is-off", !ok);
  }

  /**
   * Scenario comparison. `results` null = still calculating. All scenarios
   * share one inventory, so complete bars are directly comparable.
   */
  function renderComparison(activeTitle, results) {
    if (!ensureCompareUI()) return;

    // One zero-based scale: the largest complete total spans the full track.
    let scale = 0;
    if (results) {
      compareUI.forEach(function (ui, title) {
        const ex = results[title].exposure;
        if (ex.status === "complete") scale = Math.max(scale, ex.value);
      });
    }

    let landNote = "";
    compareUI.forEach(function (ui, title) {
      const active = title === activeTitle;
      [ui.row, ui.ring].forEach(function (node) {
        node.classList.toggle("active", active);
        if (active) node.setAttribute("aria-current", "true");
        else node.removeAttribute("aria-current");
      });
      const level = scenarioValue(title);

      if (!results) {
        setBarMessage(ui, "Calculating\u2026", "muted");
        setRing(ui, null);
        ui.pct.textContent = "\u2026";
        ui.row.setAttribute("aria-label", level + ": calculating. Show this scenario.");
        ui.ring.setAttribute("aria-label", level + ": calculating. Show this scenario.");
        return;
      }

      const r = results[title];
      const ex = r.exposure;
      if (ex.status === "complete") {
        const totals = typeTotals(ex);
        ui.msg.textContent = "";
        ui.msg.className = "cmp-msg";
        TYPE_ORDER.forEach(function (type) {
          const t = totals[type];
          ui.segs[type].style.width = scale > 0 ? ((t.value / scale) * 100).toFixed(3) + "%" : "0%";
          ui.segs[type].title = TYPE_NAMES[type] + ": " + formatUSD(t.value) + " (" + t.count + ")";
        });
        ui.amount.textContent = formatUSD(ex.value);
        ui.count.textContent = ex.exposedCount + (ex.exposedCount === 1 ? " asset" : " assets");
        ui.row.setAttribute(
          "aria-label",
          level + ": " + formatUSD(ex.value) + " illustrative exposed value, " + ex.exposedCount +
            " exposed assets. Show this scenario."
        );
      } else {
        setBarMessage(
          ui,
          ex.status === "partial" ? "Incomplete \u2014 total withheld" : "Unavailable",
          "warn"
        );
        ui.row.setAttribute("aria-label", level + ": " + ex.status + " result. Show this scenario.");
      }

      const cov = r.coverage;
      const pct = cov.status === "ok" ? cov.pct : null;
      setRing(ui, pct);
      ui.ring.setAttribute(
        "aria-label",
        level + ": " + (pct === null ? "land estimate unavailable" : pct.toFixed(1) + "% of sampled dry land at or below the water level") +
          ". Show this scenario."
      );
      if (cov.status !== "ok") {
        landNote = "Land-sample estimate unavailable (" + cov.reason + ").";
      } else if (cov.pct === null) {
        landNote = "Land-sample estimate unavailable (" + (cov.valid === 0 ? "no elevation data" : "no dry-land samples") + ").";
      } else if (cov.invalid > 0 && !landNote) {
        landNote = cov.invalid + " no-data samples excluded from the grid estimate.";
      }
    });

    const note = document.getElementById("compareLandNote");
    if (note) {
      note.textContent = landNote;
      note.hidden = !landNote;
      note.classList.toggle("is-warn", /unavailable/.test(landNote));
    }
  }

  /** Assumptions panel: inventory and unit values come straight from config. */
  function renderAssumptions() {
    const counts = {};
    let bimNames = EXPECTED_BIM_MODELS.slice();
    if (lastInventory) {
      lastInventory.assets.forEach(function (input) {
        if (input.status === "ok" && input.items) counts[input.id] = input.items.length;
        if (input.id === "bim" && input.items) {
          bimNames = input.items.map(function (item) {
            return item.name;
          });
        }
      });
    }
    const n = function (id) {
      return counts[id] !== undefined ? " (" + counts[id] + ")" : "";
    };
    setText(
      "assumeInventory",
      "Mapped mooring bollards" + n("bollards") + ", streetlights" + n("streetlights") +
        ", and the included BIM building models: " + bimNames.join(", ") +
        ". BIM models are assessed even when the BIM Data layer is hidden."
    );

    const list = document.getElementById("assumeValues");
    if (list) {
      list.textContent = "";
      Object.keys(UNIT_VALUE_LABELS).forEach(function (key) {
        const value = ASSUMED_UNIT_VALUES_USD[key];
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = UNIT_VALUE_LABELS[key];
        const amount = document.createElement("strong");
        amount.textContent = isValidUnitValue(value) ? formatUSD(value) + " each" : "valuation unknown";
        li.appendChild(name);
        li.appendChild(amount);
        list.appendChild(li);
      });
    }
  }

  /** Retry, legend and assumptions-panel wiring for the exposure drawer. */
  function setupExposurePanel() {
    // Legend and method text follow the configured constants.
    setText("depthShallowLabel", "< " + DEPTH_SPLIT_M + " m");
    setText("depthDeepLabel", "\u2265 " + DEPTH_SPLIT_M + " m");
    document.querySelectorAll(".assume-depth").forEach(function (el) {
      el.textContent = DEPTH_SPLIT_M + " m";
    });
    setText("assumeGrid", COVERAGE_GRID + " \u00d7 " + COVERAGE_GRID);

    const retry = document.getElementById("analysisRetry");
    if (retry) {
      retry.addEventListener("click", function () {
        runSurgeImpact(activeScenarioTitle);
      });
    }

    const drawer = document.getElementById("surgeImpact");
    const hint = document.getElementById("moreHint");
    if (drawer && hint) {
      drawer.addEventListener("scroll", updateMoreHint, { passive: true });
      window.addEventListener("resize", updateMoreHint);
      hint.addEventListener("click", function () {
        drawer.scrollBy({ top: drawer.clientHeight * 0.7, behavior: "smooth" });
      });
    }

    const btn = document.getElementById("assumptionsBtn");
    const panel = document.getElementById("assumptionsPanel");
    const close = document.getElementById("assumptionsClose");
    if (!btn || !panel) return;

    function setOpen(open, returnFocus) {
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) {
        renderAssumptions();
        panel.focus();
      } else if (returnFocus) {
        btn.focus();
      }
    }
    btn.addEventListener("click", function () {
      setOpen(panel.hidden, false);
    });
    if (close) {
      close.addEventListener("click", function () {
        setOpen(false, true);
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !e.defaultPrevented && !panel.hidden) {
        e.preventDefault();
        setOpen(false, true);
      }
    });
  }

  /**
   * Inspector: click an exposure marker to explain that assessed asset, click
   * a mapped asset / BIM component to see its attributes, or click anywhere
   * else for a point "Location Flood Check". Clicks that belong to an active
   * measurement or slice placement are left to that tool.
   */
  function setupAssetInspector(tools) {
    const card = document.getElementById("inspectorCard");
    const titleEl = document.getElementById("inspectorTitle");
    const bodyEl = document.getElementById("inspectorBody");
    const closeBtn = document.getElementById("inspectorClose");

    // Layer types that are visual-only surfaces with no queryable
    // per-object attributes (reality captures, terrain).
    const NON_QUERYABLE = [
      "gaussian-splat",
      "integrated-mesh",
      "point-cloud",
      "elevation",
      "imagery",
      "imagery-tile"
    ];
    // Surge water layers are analysis surfaces, not inspectable assets.
    const SURGE_TITLES = SURGE_LAYERS.map(function (s) {
      return s.title;
    });

    // What the card shows: { kind: "exposure", item } |
    // { kind: "location", pending, groundZ, reason } | { kind: "attributes" }.
    let inspected = null;
    let probeSeq = 0; // the newest location check wins

    // The card lives in the top-left panel and takes the weather section's
    // place while open (body.inspecting), keeping the 3D scene unobstructed.
    function setCardOpen(open) {
      card.classList.toggle("visible", open);
      document.body.classList.toggle("inspecting", open);
    }

    function closeCard() {
      setCardOpen(false);
      probeLayer.removeAll();
      probeSeq++;
      inspected = null;
    }

    if (closeBtn) closeBtn.addEventListener("click", closeCard);
    closeInspector = closeCard;

    /** Render a titled list of {label, value, note} rows into the card. */
    function renderRows(title, rows, action) {
      titleEl.textContent = title;
      bodyEl.innerHTML = "";
      rows.forEach(function (r) {
        const row = document.createElement("div");
        row.className = "inspector-row" + (r.note ? " inspector-row--note" : "");
        if (!r.note) {
          const label = document.createElement("span");
          label.className = "inspector-label";
          label.textContent = r.label;
          row.appendChild(label);
        }
        const value = document.createElement("span");
        value.className = "inspector-value";
        value.textContent = r.value;
        row.appendChild(value);
        bodyEl.appendChild(row);
      });
      if (action) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "inspector-action";
        btn.textContent = action.label;
        btn.addEventListener("click", action.onClick);
        bodyEl.appendChild(btn);
      }
      setCardOpen(true);
    }

    /** Rows for an assessed asset, always evaluated for the ACTIVE scenario. */
    function exposureRows(item) {
      const waterZ = SURGE_FLOOD_HEIGHTS[activeScenarioTitle];
      const unit = ASSUMED_UNIT_VALUES_USD[item.category];
      const rows = [
        { label: "Asset", value: item.name || "\u2014" },
        { label: "Source layer", value: item.sourceLabel },
        { label: "Scenario", value: activeScenarioTitle },
        {
          label: "Sampled ground elevation",
          value: isValidElevation(item.groundZ) ? formatMetres(item.groundZ) : "Unavailable"
        }
      ];
      if (!isSurgeScenario(activeScenarioTitle)) {
        rows.push({ label: "Status", value: "Reference view \u2014 not assessed" });
      } else {
        rows.push({ label: "Model water surface", value: formatMetres(waterZ) });
        if (!isValidElevation(item.groundZ)) {
          rows.push({ label: "Status", value: "Not assessed" });
        } else if (isAtOrBelowWater(item.groundZ, waterZ)) {
          rows.push({ label: "Modeled water depth", value: formatMetres(waterZ - item.groundZ) });
        } else {
          rows.push({
            label: "Status",
            value: "Above water surface by " + formatMetres(item.groundZ - waterZ)
          });
        }
      }
      rows.push({
        label: "Assumed unit value",
        value: isValidUnitValue(unit) ? formatUSD(unit) : "Unknown \u2014 not valued"
      });
      if (item.representativePoint) {
        rows.push({
          note: true,
          value:
            "Tested at one representative point (center of the model's extent) \u2014 not a footprint or floor-level assessment."
        });
      }
      rows.push({
        note: true,
        value: "Illustrative exposure using an assumed replacement value \u2014 not predicted damage."
      });
      return rows;
    }

    /** Rows for a clicked location, evaluated for the ACTIVE scenario. */
    function locationRows(state) {
      if (state.pending) {
        return [
          { label: "Sampled ground elevation", value: "Sampling\u2026" },
          { label: "Scenario", value: activeScenarioTitle }
        ];
      }
      const waterZ = SURGE_FLOOD_HEIGHTS[activeScenarioTitle];
      const hasGround = isValidElevation(state.groundZ);
      const rows = [
        {
          label: "Sampled ground elevation",
          value: hasGround ? formatMetres(state.groundZ) : "Ground elevation unavailable"
        },
        { label: "Scenario", value: activeScenarioTitle }
      ];
      if (!isSurgeScenario(activeScenarioTitle)) {
        rows.push({ label: "Status", value: "Reference view \u2014 not assessed" });
        rows.push({
          note: true,
          value: "Select +1m, +2m or +3m to check this spot against a what-if water level."
        });
        return rows;
      }
      rows.push({ label: "Model water surface", value: formatMetres(waterZ) });
      if (!hasGround) {
        rows.push({ label: "Status", value: "Cannot assess" });
        rows.push({
          note: true,
          value:
            "No terrain elevation here" + (state.reason ? " (" + state.reason + ")" : "") +
            ". Roof or water-surface heights are not substituted."
        });
        return rows;
      }
      if (isAtOrBelowWater(state.groundZ, waterZ)) {
        rows.push({ label: "Status", value: "\u26a0 At or below water surface" });
        rows.push({ label: "Modeled water depth", value: formatMetres(waterZ - state.groundZ) });
      } else {
        rows.push({ label: "Status", value: "Above water surface" });
        rows.push({ label: "Height above water", value: formatMetres(state.groundZ - waterZ) });
      }
      rows.push({
        note: true,
        value: "Terrain sample vs. a static what-if water surface \u2014 illustrative, not a flood forecast."
      });
      return rows;
    }

    function zoomTo(item) {
      if (!isValidElevation(item.x) || !isValidElevation(item.y)) return;
      const target = new Point({
        x: item.x,
        y: item.y,
        z: isValidElevation(item.groundZ) ? item.groundZ : undefined,
        spatialReference: item.sr
      });
      // Recenter on the asset, closing in if needed but never zooming out.
      const scale = Math.min(view.scale || Infinity, item.representativePoint ? 600 : 350);
      flight?.exit();
      godzilla?.takeOverCamera();
      view.goTo({ target: target, scale: scale }, { duration: 1400 }).catch(function (err) {
        if (!err || err.name !== "AbortError") log("zoom to asset failed", err);
      });
    }

    function render() {
      if (!inspected) return;
      if (inspected.kind === "exposure") {
        const item = inspected.item;
        renderRows(item.typeLabel, exposureRows(item), {
          label: "Zoom to asset",
          onClick: function () {
            zoomTo(item);
          }
        });
      } else if (inspected.kind === "location") {
        renderRows("Location Flood Check", locationRows(inspected));
      }
    }

    // Scenario switches re-evaluate an open asset / location card.
    refreshInspector = function () {
      if (inspected && inspected.kind !== "attributes") render();
    };

    /** Report terrain elevation + exposure at a clicked location. */
    async function analyzePoint(mapPoint) {
      const seq = ++probeSeq;

      // Drop the holographic reticle at the probed location. probeLayer is
      // relative-to-ground, so z = 0 sits the base pad right on the surface.
      probeLayer.removeAll();
      probeLayer.add(
        new Graphic({
          geometry: {
            type: "point",
            x: mapPoint.x,
            y: mapPoint.y,
            z: 0,
            spatialReference: mapPoint.spatialReference
          },
          symbol: RETICLE_SYMBOL
        })
      );
      inspected = { kind: "location", pending: true };
      render();

      // Terrain only: the clicked surface (splat, roof, water) is never used
      // as a stand-in when the ground query fails.
      let groundZ = null;
      let reason = null;
      try {
        groundZ = (
          await sampleGround(
            new Point({ x: mapPoint.x, y: mapPoint.y, spatialReference: mapPoint.spatialReference })
          )
        )[0];
        if (groundZ === null) reason = "no elevation data";
      } catch (err) {
        log("location ground elevation query failed", err);
        reason = "elevation query failed";
      }
      if (seq !== probeSeq) return; // a newer click (or closing the card) wins
      inspected = { kind: "location", groundZ: groundZ, reason: reason };
      render();
    }

    view.on("click", async function (event) {
      if (tools.capturesClicks() || flight?.capturesClicks()) return;

      let response;
      try {
        response = await view.hitTest(event, {
          exclude: view.map.allLayers.filter(layer => layer.id === "godzilla-wake-study").toArray()
        });
      } catch (e) {
        response = { results: [] };
      }

      // Keep only graphic hits from markers and real, inspectable asset layers.
      const hits = response.results.filter(function (r) {
        const layer = r.graphic && r.graphic.layer;
        if (!layer || layer === probeLayer) return false;
        if (NON_QUERYABLE.indexOf(layer.type) !== -1) return false;
        if (SURGE_TITLES.indexOf(layer.title) !== -1) return false;
        return true;
      });
      const hit = hits[0];

      // An exposure marker — explain the assessed asset behind it.
      if (hit && hit.graphic.layer === impactLayer) {
        const key = hit.graphic.attributes && hit.graphic.attributes.exposureKey;
        const item = key ? inventoryItems.get(key) : null;
        if (item) {
          probeLayer.removeAll();
          probeSeq++;
          inspected = { kind: "exposure", item: item };
          render();
        }
        return;
      }

      if (hit) {
        // A real asset was clicked — clear any lingering flood-probe marker.
        probeLayer.removeAll();
        probeSeq++;
        inspected = { kind: "attributes" };
        const graphic = hit.graphic;
        const layer = graphic.layer;
        const layerTitle = (layer && layer.title) || "Feature";
        const attrs = graphic.attributes || {};

        const configured = INSPECTOR_FIELDS[layerTitle];
        let rows = [];

        if (configured) {
          rows = configured
            .filter(function (f) {
              return attrs[f.name] !== undefined;
            })
            .map(function (f) {
              return { label: f.label, value: formatValue(attrs[f.name], f.type) };
            });
        }

        // Fallback: show up to 8 populated, non-system attributes.
        if (!rows.length) {
          rows = Object.keys(attrs)
            .filter(function (k) {
              const v = attrs[k];
              return (
                v !== null &&
                v !== "" &&
                !/^(objectid|shape|globalid)/i.test(k) &&
                !/__/.test(k)
              );
            })
            .slice(0, 8)
            .map(function (k) {
              return { label: k.replace(/_/g, " "), value: formatValue(attrs[k]) };
            });
        }

        if (!rows.length) {
          rows = [
            {
              note: true,
              value: layerTitle + " has no descriptive attributes for this component."
            }
          ];
        }

        renderRows(layerTitle, rows);
        return;
      }

      // Nothing inspectable was hit — run a point flood check where they
      // clicked (anywhere on the splat / terrain), unless a tool is active.
      if (tools.isActive()) return;
      if (event.mapPoint) {
        analyzePoint(event.mapPoint);
      } else {
        closeCard();
      }
    });
  }

  /** Fade out the cinematic intro overlay. */
  function dismissOverlay() {
    const overlay = document.getElementById("loadingOverlay");
    overlay.classList.add("hidden");
    // Remove from DOM after the fade completes.
    setTimeout(function () {
      overlay.remove();
    }, 1100);
  }

  // Watchdog: if nothing resolves within 30s, tell the user instead of
  // spinning forever (usually a private/unshared item or a network stall).
  let settled = false;
  const watchdog = setTimeout(function () {
    if (!settled) {
      showOverlayError(
        "Still loading after 30s. The Web Scene may be private (requires sign-in) " +
          "or unavailable. Confirm the item is shared publicly."
      );
    }
  }, 30000);

  // Surface the actual load status of the scene item itself.
  scene.load().catch(function (error) {
    settled = true;
    clearTimeout(watchdog);
    showOverlayError(
      "Web Scene could not be loaded: " +
        (error.message || error) +
        ". Verify the item ID and that it is shared with Everyone (public)."
    );
  });

  /**
   * Wire up the Slice and Distance tools. Only one is active at a time; both
   * render widgets into the top-right host. (Volume measurement is not
   * offered: the SDK does not support it on Gaussian splat layers, this
   * scene's primary surface.) Returns predicates the inspector uses to stay
   * out of the tools' way.
   */
  function setupAnalysisTools() {
    const host = document.getElementById("toolContainer");

    const sliceBtn = document.getElementById("toolSlice");
    const lineBtn = document.getElementById("toolLine");
    const clearBtn = document.getElementById("toolClear");

    // Slice widget renders into its own node; Measurement into another.
    const sliceNode = document.createElement("div");
    const measureNode = document.createElement("div");

    const slice = new Slice({ view: view, container: sliceNode });
    const measurement = new Measurement({ view: view, container: measureNode });

    let active = null; // "slice" | "measure" | null

    function setPressed(btn, pressed) {
      btn.classList.toggle("active", pressed);
      btn.setAttribute("aria-pressed", String(pressed));
    }

    function clearAll() {
      // Reset the slice plane and any active measurement.
      if (slice.viewModel) slice.viewModel.clear();
      measurement.clear();
      if (sliceNode.parentNode) host.removeChild(sliceNode);
      if (measureNode.parentNode) host.removeChild(measureNode);
      active = null;
      setPressed(sliceBtn, false);
      setPressed(lineBtn, false);
    }

    function showSlice() {
      clearAll();
      closeInspector();
      host.appendChild(sliceNode);
      active = "slice";
      setPressed(sliceBtn, true);
    }

    function showMeasurement(tool, btn) {
      clearAll();
      closeInspector();
      host.appendChild(measureNode);
      measurement.activeTool = tool; // "direct-line" distance measurement
      active = "measure";
      setPressed(btn, true);
    }

    sliceBtn.addEventListener("click", function () {
      flight?.exit();
      active === "slice" ? clearAll() : showSlice();
    });
    lineBtn.addEventListener("click", function () {
      flight?.exit();
      active === "measure" && measurement.activeTool === "direct-line"
        ? clearAll()
        : showMeasurement("direct-line", lineBtn);
    });
    clearBtn.addEventListener("click", function () {
      flight?.exit();
      clearAll();
    });

    return {
      clear: clearAll,
      isActive: function () {
        return active !== null;
      },
      // Clicks belong to the tool while measuring or while placing a slice.
      capturesClicks: function () {
        if (active === "measure") return true;
        return active === "slice" && !!slice.viewModel && slice.viewModel.state === "slicing";
      }
    };
  }

  /**
   * Home view: return the camera to the scene's initial harbor viewpoint.
   * Camera only — the scenario, analysis results and layer visibility are
   * left exactly as they are.
   */
  function setupHomeButton() {
    const btn = document.getElementById("homeBtn");
    if (!btn) return;
    const initial = scene.initialViewProperties && scene.initialViewProperties.viewpoint;
    const home = (initial || view.viewpoint).clone();
    btn.addEventListener("click", function () {
      flight?.exit();
      godzilla?.stop(false);
      view.goTo(home, { duration: 1800 }).catch(function (err) {
        // A user drag interrupting the flight is expected, not an error.
        if (!err || err.name !== "AbortError") log("home view navigation failed", err);
      });
    });
  }

  function setupHiddenScene(tools) {
    const trigger = document.getElementById("godzillaUnlock");
    let unlocking = false;
    let notice;
    trigger.hidden = false;
    trigger.addEventListener("click", async function () {
      if (godzilla) {
        godzilla.showControls();
        return;
      }
      if (unlocking) return;
      unlocking = true;
      trigger.disabled = true;
      try {
        const { setupGodzilla } = await import("./prototypes/godzilla/preview.js");
        godzilla = setupGodzilla({
          view, getScenario: () => activeScenarioValue, closeInspector, tools,
          isManualNavigationActive: () => flight.isActive(),
          onClose() {
            godzilla.dispose();
            godzilla = null;
          }
        });
        notice?.remove();
        godzilla.showControls();
      } catch (error) {
        log("Hidden scene controls failed to initialize", error);
        notice ??= document.createElement("p");
        notice.className = "dock-section";
        notice.setAttribute("role", "alert");
        notice.textContent = "The hidden scene controls could not load. Click the top-right corner to retry.";
        document.querySelector(".dock-panel").append(notice);
      } finally {
        unlocking = false;
        trigger.disabled = false;
      }
    });
  }

  // Wait for the scene view to be fully ready, then wire up the UI.
  view
    .when(function () {
      settled = true;
      clearTimeout(watchdog);
      enableSceneGlow();
      buildLayerToggles();
      setupHomeButton();
      setupExposurePanel();
      buildSurgeControl();
      setupRainToggle();
      const tools = setupAnalysisTools();
      flight = setupFlight({
        view,
        onEnter() {
          smoothZoom?.cancel();
          godzilla?.takeOverCamera();
          tools.clear();
          closeInspector();
        }
      });
      smoothZoom = setupSmoothZoom({
        view,
        isEnabled: () => !flight.isActive(),
        onStart: () => godzilla?.takeOverCamera(),
        onError(error) {
          log("Smooth wheel zoom failed; standard zoom restored", error);
          setText("flightStatus", "Smooth zoom unavailable; standard wheel zoom restored. See the browser console.");
          setHidden("flightStatus", false);
        }
      });
      setupAssetInspector(tools);
      setupHiddenScene(tools);
      dismissOverlay();
      // App is up — from here on, stray async errors are non-fatal.
      appReady = true;
    })
    .catch(function (error) {
      settled = true;
      clearTimeout(watchdog);
      showOverlayError(
        error.message || "Please check the Web Scene ID and your connection."
      );
    });
}

initApp();
