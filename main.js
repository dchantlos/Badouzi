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
import VolumeMeasurementAnalysis from "@arcgis/core/analysis/VolumeMeasurementAnalysis.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Multipoint from "@arcgis/core/geometry/Multipoint.js";

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

// Waterfront point-asset layers analysed for inundation. Each asset's ground
// elevation is compared against the active flood surface height.
const VULNERABLE_ASSET_LAYERS = ["Mooring Bollards", "Street Lights"];

// Estimated replacement / damage cost (USD) per affected feature, used by the
// Financial Impact Calculator in the Features-at-Risk panel. Buildings use the
// `building` key (BIM BuildingSceneLayers have no per-footprint valuation).
const FEATURE_COSTS = {
  "Mooring Bollards": 1500,
  "Street Lights": 3200,
  building: 150000
};

// The reality mesh defines the analysis footprint. It stays hidden (we only
// show the Gaussian Splat) but its extent + the ground elevation service let
// us estimate how much of the site is inundated in each scenario.
const REALITY_MESH_TITLE = "ArcGIS Reality Mesh - 2024";

// Baseline (normal) water-surface height in metres. Land above this is "dry"
// today; the surge coverage stat reports how much of that dry land floods.
const BASELINE_WATER_HEIGHT = 2.2;

// Grid resolution (per axis) used to sample the site for coverage stats.
// 60 x 60 = 3600 elevation samples in a single query — plenty of detail.
const COVERAGE_GRID = 60;

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

  // Graphics layer used to flag inundated waterfront assets (red markers).
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

  // -------- Depth / severity symbology -----------------------------------
  // Depth colouring is SCENARIO-RELATIVE: `threshold` is derived per surge run
  // from that scenario's own min/max flood depth (see runSurgeImpact), so every
  // scenario shows a shallow(orange)/deep(red) mix instead of going all-red at
  // the higher surges. Falls back to a 1 m absolute split if unset.
  function depthSeverity(depth, threshold) {
    const t = typeof threshold === "number" && threshold > 0 ? threshold : 1;
    if (depth >= t) return { color: [255, 0, 0], level: "severe" }; // #FF0000
    return { color: [255, 165, 0], level: "minor" }; // #FFA500
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

  // Glassy "holographic HUD" marker: a translucent severity-tinted disc with a
  // bright glowing outline ring + a small type glyph, hung on a near-invisible
  // hairline callout so it never blocks the reality mesh. ~25% smaller heads.
  function makeImpactSymbol(depth, layerTitle, threshold) {
    const c = depthSeverity(depth, threshold).color;
    const layers = [
      {
        type: "icon",
        resource: { primitive: "circle" },
        material: { color: [c[0], c[1], c[2], 0.15] }, // ghosted glass fill
        size: 8,
        outline: { color: c, size: 1.5 } // bright severity ring
      }
    ];
    const glyph = RISK_GLYPHS[layerTitle];
    if (glyph) {
      layers.push({
        type: "icon",
        resource: { href: glyph },
        material: { color: [255, 255, 255, 0.85] },
        size: 5
      });
    }
    return {
      type: "point-3d",
      symbolLayers: layers,
      verticalOffset: { screenLength: 26, maxWorldLength: 60, minWorldLength: 12 },
      callout: { type: "line", size: 0.75, color: [255, 255, 255, 0.4] }
    };
  }

  // Larger square HUD marker for an at-risk BIM building.
  function makeBuildingImpactSymbol(depth, threshold) {
    const c = depthSeverity(depth, threshold).color;
    return {
      type: "point-3d",
      symbolLayers: [
        {
          type: "icon",
          resource: { primitive: "square" },
          material: { color: [c[0], c[1], c[2], 0.15] },
          size: 12,
          outline: { color: c, size: 1.5 }
        },
        {
          type: "icon",
          resource: { href: RISK_GLYPHS.building },
          material: { color: [255, 255, 255, 0.85] },
          size: 8
        }
      ],
      verticalOffset: { screenLength: 44, maxWorldLength: 130, minWorldLength: 30 },
      callout: { type: "line", size: 0.75, color: [255, 255, 255, 0.4] }
    };
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
        btn.classList.toggle("active", btn.dataset.title === activeCfg.title);
      });

      readout.textContent = activeCfg.title;

      // Track the active scenario so the click inspector can report flood
      // status at any point the user clicks.
      activeScenarioTitle = activeCfg.title;
      activeScenarioValue = activeCfg.value;

      // Dynamic Weather Simulation — sync environment to scenario severity.
      applyScenarioWeather(activeCfg.value);

      // Run (or clear) the inundation impact analysis for this scenario.
      runSurgeImpact(activeCfg.title);
    }

    resolved.forEach(function (item, index) {
      const btn = document.createElement("button");
      btn.className = "segment";
      btn.type = "button";
      btn.dataset.title = item.cfg.title;
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

  /**
   * Storm-surge impact analysis: compares each waterfront asset's ground
   * elevation to the active flood surface height, flags inundated assets with
   * red markers, and reports a summary (count + average condition score).
   */
  let surgeRunId = 0;
  async function runSurgeImpact(scenarioTitle) {
    const runId = ++surgeRunId; // guards against overlapping async runs
    impactLayer.removeAll();

    const summaryEl = document.getElementById("surgeImpact");
    const countEl = document.getElementById("impactCount");
    const detailEl = document.getElementById("impactDetail");
    const valueEl = document.getElementById("valueAtRisk");

    const floodHeight = SURGE_FLOOD_HEIGHTS[scenarioTitle];

    // Baseline / normal conditions: nothing to analyse.
    if (floodHeight === null || floodHeight === undefined) {
      if (summaryEl) summaryEl.classList.remove("visible", "alert");
      const areaEl = document.getElementById("impactArea");
      if (areaEl) areaEl.classList.remove("visible");
      if (valueEl) valueEl.textContent = "$0";
      return;
    }

    if (summaryEl) summaryEl.classList.add("visible");
    if (countEl) countEl.textContent = "Analysing\u2026";
    if (detailEl) detailEl.textContent = "";
    if (valueEl) valueEl.textContent = "\u2026";

    let totalInundated = 0;
    let conditionSum = 0;
    let conditionCount = 0;
    let valueAtRisk = 0;
    const perLayer = [];
    // Collect inundated features first, then colour them by a scenario-relative
    // depth threshold computed from this run's own min/max depth (below).
    const impactPoints = []; // { x, y, z, sr, depth, layerTitle }
    const impactBuildings = []; // { x, y, z, sr, depth }

    for (const layerTitle of VULNERABLE_ASSET_LAYERS) {
      const layer = findLayerByTitle(layerTitle);
      if (!layer || typeof layer.queryFeatures !== "function") continue;

      try {
        await layer.load();
        const query = layer.createQuery();
        query.where = "1=1";
        query.returnGeometry = true;
        query.outFields = ["*"];
        const { features } = await layer.queryFeatures(query);
        if (runId !== surgeRunId) return; // superseded by a newer run
        if (!features.length) continue;

        // Collect valid point geometries and query the ground elevation once.
        const pts = [];
        const validFeatures = [];
        features.forEach(function (f) {
          const g = f.geometry;
          if (g && typeof g.x === "number" && typeof g.y === "number") {
            pts.push([g.x, g.y]);
            validFeatures.push(f);
          }
        });
        if (!pts.length) continue;

        const multipoint = new Multipoint({
          points: pts,
          spatialReference: validFeatures[0].geometry.spatialReference
        });

        const sampled = await view.map.ground.queryElevation(multipoint);
        if (runId !== surgeRunId) return;

        let layerCount = 0;
        validFeatures.forEach(function (f, i) {
          const groundZ = sampled.geometry.points[i][2];
          if (groundZ <= floodHeight) {
            layerCount++;
            totalInundated++;

            const score = f.attributes && f.attributes.Condition_Score;
            if (typeof score === "number" && !isNaN(score)) {
              conditionSum += score;
              conditionCount++;
            }

            const depth = floodHeight - groundZ; // water depth at this asset
            impactPoints.push({
              x: pts[i][0],
              y: pts[i][1],
              z: groundZ,
              sr: multipoint.spatialReference,
              depth: depth,
              layerTitle: layerTitle
            });
          }
        });

        if (layerCount > 0) perLayer.push(layerCount + " \u00d7 " + layerTitle);
        valueAtRisk += layerCount * (FEATURE_COSTS[layerTitle] || 0);
      } catch (err) {
        console.warn("Surge analysis failed for", layerTitle, err);
      }
    }

    // --- BIM buildings: the only modelled structures in the scene ---------
    // (The Gaussian Splat is a visual-only reality capture with no discrete
    //  buildings to analyse, so we assess the BIM BuildingSceneLayers.)
    const buildingLayers = scene.allLayers
      .filter(function (l) {
        return l.type === "building-scene";
      })
      .toArray();
    const buildingsAtRisk = [];

    for (const bLayer of buildingLayers) {
      try {
        await bLayer.load();
        const ext = bLayer.fullExtent;
        if (!ext) continue;

        const sampled = await view.map.ground.queryElevation(ext.center);
        if (runId !== surgeRunId) return;

        const groundZ = sampled.geometry.z;
        if (typeof groundZ === "number" && groundZ <= floodHeight) {
          buildingsAtRisk.push(bLayer.title);
          const depth = floodHeight - groundZ;
          impactBuildings.push({
            x: ext.center.x,
            y: ext.center.y,
            z: groundZ,
            sr: ext.center.spatialReference,
            depth: depth
          });
        }
      } catch (err) {
        console.warn("Surge analysis failed for building", bLayer.title, err);
      }
    }

    if (runId !== surgeRunId) return;

    // Fixed depth split: features flooded by < 1.5 m read orange, ≥ 1.5 m red.
    const severityThreshold = 1.5;

    impactPoints.forEach(function (p) {
      impactLayer.add(
        new Graphic({
          geometry: { type: "point", x: p.x, y: p.y, z: p.z, spatialReference: p.sr },
          symbol: makeImpactSymbol(p.depth, p.layerTitle, severityThreshold)
        })
      );
    });
    impactBuildings.forEach(function (b) {
      impactLayer.add(
        new Graphic({
          geometry: { type: "point", x: b.x, y: b.y, z: b.z, spatialReference: b.sr },
          symbol: makeBuildingImpactSymbol(b.depth, severityThreshold)
        })
      );
    });

    const totalAtRisk = totalInundated + buildingsAtRisk.length;
    valueAtRisk += buildingsAtRisk.length * (FEATURE_COSTS.building || 0);

    // --- Site-wide inundation coverage (uses the reality mesh footprint) --
    const coverage = await computeCoverage(floodHeight, runId);
    if (runId !== surgeRunId) return;

    if (countEl) {
      countEl.textContent =
        totalAtRisk + (totalAtRisk === 1 ? " feature at risk" : " features at risk");
    }
    if (detailEl) {
      const parts = perLayer.slice();
      if (buildingsAtRisk.length) {
        parts.push(
          buildingsAtRisk.length +
            " \u00d7 BIM Buildings (" +
            buildingsAtRisk.join(", ") +
            ")"
        );
      }
      let detail = parts.length ? parts.join("  \u00b7  ") : "No mapped assets inundated.";
      if (conditionCount > 0) {
        detail += "  \u00b7  Avg. bollard condition " + Math.round(conditionSum / conditionCount);
      }
      detailEl.textContent = detail;
    }

    // Financial Impact Calculator — total estimated value at risk.
    if (valueEl) valueEl.textContent = "$" + valueAtRisk.toLocaleString();

    // Render the coverage bar + stats.
    const areaEl = document.getElementById("impactArea");
    if (areaEl) {
      if (coverage) {
        const pct = coverage.landFloodedPct;
        let text = pct.toFixed(1) + "% of dry land newly inundated";
        if (coverage.hectares != null) {
          text += "  \u00b7  ~" + coverage.hectares.toFixed(1) + " ha";
        }
        areaEl.querySelector(".coverage-text").textContent = text;
        areaEl.querySelector(".coverage-fill").style.width =
          Math.min(100, pct).toFixed(1) + "%";
        areaEl.classList.add("visible");
      } else {
        areaEl.classList.remove("visible");
      }
    }

    if (summaryEl) summaryEl.classList.toggle("alert", totalAtRisk > 0);
  }

  /**
   * Estimate site inundation coverage by sampling the ground elevation across
   * a grid over the reality-mesh footprint, then comparing each sample to the
   * baseline water level and the active flood height.
   *
   * Returns { landFloodedPct, hectares } or null if the extent is unavailable.
   */
  async function computeCoverage(floodHeight, runId) {
    try {
      const mesh = findLayerByTitle(REALITY_MESH_TITLE);
      let extent = null;

      if (mesh) {
        await mesh.load();
        extent = mesh.fullExtent;
      }
      // Fall back to the scene's clipping extent or current view extent.
      if (!extent) extent = scene.clippingArea || view.extent;
      if (!extent) return null;

      const sr = extent.spatialReference;
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

      const grid = new Multipoint({ points: pts, spatialReference: sr });
      const sampled = await view.map.ground.queryElevation(grid);
      if (runId !== surgeRunId) return null;

      let baselineWet = 0;
      let scenarioWet = 0;
      sampled.geometry.points.forEach(function (p) {
        const z = p[2];
        if (typeof z !== "number") return;
        if (z <= BASELINE_WATER_HEIGHT) baselineWet++;
        if (z <= floodHeight) scenarioWet++;
      });

      const total = pts.length;
      const dryLand = total - baselineWet;
      const newlyFlooded = Math.max(0, scenarioWet - baselineWet);
      const landFloodedPct = dryLand > 0 ? (newlyFlooded / dryLand) * 100 : 0;

      // Convert affected fraction to a hectare figure when the footprint is in
      // a projected (metre) coordinate system.
      let hectares = null;
      if (!sr.isGeographic) {
        const cellArea = dx * dy; // m² per sample cell
        hectares = (newlyFlooded * cellArea) / 10000;
      }

      return { landFloodedPct: landFloodedPct, hectares: hectares };
    } catch (err) {
      console.warn("Coverage estimate failed", err);
      return null;
    }
  }

  /**
   * Asset inspector: click anything in the scene to reveal its attributes in
   * a floating glass card. Works with BIM components and feature-layer assets.
   */
  function setupAssetInspector() {
    const card = document.getElementById("inspectorCard");
    const titleEl = document.getElementById("inspectorTitle");
    const bodyEl = document.getElementById("inspectorBody");
    const closeBtn = document.getElementById("inspectorClose");

    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        card.classList.remove("visible");
        probeLayer.removeAll();
      });
    }

    view.on("click", async function (event) {
      // Layer types that are visual-only surfaces with no queryable
      // per-object attributes (reality captures, terrain, our markers).
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

      /** Render a titled list of {label, value, note} rows into the card. */
      function renderRows(title, rows) {
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
        card.classList.add("visible");
      }

      /** Report ground elevation + flood status at the clicked location. */
      async function analyzePoint(mapPoint) {
        let groundZ = null;
        try {
          const sampled = await view.map.ground.queryElevation(mapPoint);
          groundZ = sampled.geometry.z;
        } catch (e) {
          groundZ = typeof mapPoint.z === "number" ? mapPoint.z : null;
        }

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

        const floodHeight = SURGE_FLOOD_HEIGHTS[activeScenarioTitle];
        const rows = [];
        rows.push({
          label: "Ground elevation",
          value: groundZ != null ? groundZ.toFixed(1) + " m" : "\u2014"
        });
        rows.push({ label: "Scenario", value: activeScenarioTitle });

        if (floodHeight === null || floodHeight === undefined) {
          rows.push({ label: "Status", value: "Normal conditions" });
          rows.push({
            note: true,
            value:
              "Select a surge scenario (+1m / +2m / +3m) to check whether this spot would be flooded."
          });
        } else if (groundZ != null && groundZ <= floodHeight) {
          rows.push({ label: "Status", value: "\u26a0 Inundated" });
          rows.push({
            label: "Water depth",
            value: "~" + (floodHeight - groundZ).toFixed(1) + " m"
          });
        } else {
          rows.push({ label: "Status", value: "Dry" });
          if (groundZ != null) {
            rows.push({
              label: "Above waterline",
              value: "~" + (groundZ - floodHeight).toFixed(1) + " m"
            });
          }
        }
        renderRows("Location Flood Check", rows);
      }

      let response;
      try {
        response = await view.hitTest(event);
      } catch (e) {
        response = { results: [] };
      }

      // Keep only graphic hits from real, inspectable asset layers.
      const results = response.results.filter(function (r) {
        const layer = r.graphic && r.graphic.layer;
        if (!layer || layer === impactLayer || layer === probeLayer) return false;
        if (NON_QUERYABLE.indexOf(layer.type) !== -1) return false;
        if (SURGE_TITLES.indexOf(layer.title) !== -1) return false;
        return true;
      });

      if (results.length) {
        // A real asset was clicked — clear any lingering flood-probe marker.
        probeLayer.removeAll();
        const graphic = results[0].graphic;
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
      // clicked (works anywhere on the splat / terrain).
      if (event.mapPoint) {
        analyzePoint(event.mapPoint);
      } else {
        card.classList.remove("visible");
        probeLayer.removeAll();
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
   * Wire up the Slice, Volume and Distance analysis tools.
   * Only one tool is active at a time. Slice + Distance render widgets into the
   * top-right host; Volume is a VolumeMeasurementAnalysis drawn on the scene.
   */
  function setupAnalysisTools() {
    const host = document.getElementById("toolContainer");

    const sliceBtn = document.getElementById("toolSlice");
    const volumeBtn = document.getElementById("toolVolume");
    const lineBtn = document.getElementById("toolLine");
    const clearBtn = document.getElementById("toolClear");

    // Slice widget renders into its own node; Measurement into another.
    const sliceNode = document.createElement("div");
    const measureNode = document.createElement("div");

    const slice = new Slice({ view: view, container: sliceNode });
    const measurement = new Measurement({ view: view, container: measureNode });

    // Volume is an analysis (not a widget): it is added to view.analyses and
    // its polygon is drawn interactively on the scene surface.
    let volumeAnalysis = null;
    let volumePlacement = null; // AbortController for the in-progress placement

    let active = null; // "slice" | "measure" | "volume" | null

    function clearAll() {
      // Reset the slice plane and any active measurement.
      if (slice.viewModel) slice.viewModel.clear();
      measurement.clear();
      if (sliceNode.parentNode) host.removeChild(sliceNode);
      if (measureNode.parentNode) host.removeChild(measureNode);
      // Cancel any in-progress volume placement and drop the analysis.
      if (volumePlacement) {
        volumePlacement.abort();
        volumePlacement = null;
      }
      if (volumeAnalysis) {
        view.analyses.remove(volumeAnalysis);
        volumeAnalysis = null;
      }
      active = null;
      [sliceBtn, volumeBtn, lineBtn].forEach(function (b) {
        b.classList.remove("active");
      });
    }

    function showSlice() {
      clearAll();
      host.appendChild(sliceNode);
      active = "slice";
      sliceBtn.classList.add("active");
    }

    function showMeasurement(tool, btn) {
      clearAll();
      host.appendChild(measureNode);
      measurement.activeTool = tool; // "direct-line" distance measurement
      active = "measure";
      btn.classList.add("active");
    }

    async function showVolume() {
      clearAll();
      active = "volume";
      volumeBtn.classList.add("active");

      // Cut-fill volume relative to a flat surface under the drawn polygon.
      const analysis = new VolumeMeasurementAnalysis({ measureType: "cut-fill" });
      volumeAnalysis = analysis;
      view.analyses.add(analysis);

      // Let the user draw the measurement polygon on the scene.
      const abortController = new AbortController();
      volumePlacement = abortController;
      try {
        const analysisView = await view.whenAnalysisView(analysis);
        await analysisView.place({ signal: abortController.signal });
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Volume measurement placement failed:", error);
        }
      } finally {
        if (volumePlacement === abortController) volumePlacement = null;
      }
    }

    sliceBtn.addEventListener("click", function () {
      active === "slice" ? clearAll() : showSlice();
    });
    volumeBtn.addEventListener("click", function () {
      active === "volume" ? clearAll() : showVolume();
    });
    lineBtn.addEventListener("click", function () {
      active === "measure" && measurement.activeTool === "direct-line"
        ? clearAll()
        : showMeasurement("direct-line", lineBtn);
    });
    clearBtn.addEventListener("click", clearAll);
  }

  // Wait for the scene view to be fully ready, then wire up the UI.
  view
    .when(function () {
      settled = true;
      clearTimeout(watchdog);
      buildLayerToggles();
      buildSurgeControl();
      setupRainToggle();
      setupAnalysisTools();
      setupAssetInspector();
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
