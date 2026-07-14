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

  // Red marker (with leader line) for an inundated point asset. The billboard
  // icon + callout keeps it visible above the reality-capture surface.
  const IMPACT_SYMBOL = {
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
        resource: { primitive: "circle" },
        material: { color: [255, 64, 84] },
        size: 11,
        outline: { color: [255, 255, 255, 0.9], size: 1.5 }
      }
    ],
    verticalOffset: { screenLength: 26, maxWorldLength: 60, minWorldLength: 12 },
    callout: { type: "line", size: 1.5, color: [255, 64, 84] }
  };

  // Larger marker for an at-risk BIM building.
  const BUILDING_IMPACT_SYMBOL = {
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
        resource: { primitive: "square" },
        material: { color: [255, 93, 115] },
        size: 16,
        outline: { color: [255, 255, 255, 0.95], size: 2 }
      }
    ],
    verticalOffset: { screenLength: 44, maxWorldLength: 130, minWorldLength: 30 },
    callout: { type: "line", size: 2, color: [255, 93, 115] }
  };

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

    const floodHeight = SURGE_FLOOD_HEIGHTS[scenarioTitle];

    // Baseline / normal conditions: nothing to analyse.
    if (floodHeight === null || floodHeight === undefined) {
      if (summaryEl) summaryEl.classList.remove("visible", "alert");
      const areaEl = document.getElementById("impactArea");
      if (areaEl) areaEl.classList.remove("visible");
      return;
    }

    if (summaryEl) summaryEl.classList.add("visible");
    if (countEl) countEl.textContent = "Analysing\u2026";
    if (detailEl) detailEl.textContent = "";

    let totalInundated = 0;
    let conditionSum = 0;
    let conditionCount = 0;
    const perLayer = [];

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

            impactLayer.add(
              new Graphic({
                geometry: {
                  type: "point",
                  x: pts[i][0],
                  y: pts[i][1],
                  z: groundZ,
                  spatialReference: multipoint.spatialReference
                },
                symbol: IMPACT_SYMBOL
              })
            );
          }
        });

        if (layerCount > 0) perLayer.push(layerCount + " \u00d7 " + layerTitle);
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
          impactLayer.add(
            new Graphic({
              geometry: {
                type: "point",
                x: ext.center.x,
                y: ext.center.y,
                z: groundZ,
                spatialReference: ext.center.spatialReference
              },
              symbol: BUILDING_IMPACT_SYMBOL
            })
          );
        }
      } catch (err) {
        console.warn("Surge analysis failed for building", bLayer.title, err);
      }
    }

    if (runId !== surgeRunId) return;

    const totalAtRisk = totalInundated + buildingsAtRisk.length;

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
        if (!layer || layer === impactLayer) return false;
        if (NON_QUERYABLE.indexOf(layer.type) !== -1) return false;
        if (SURGE_TITLES.indexOf(layer.title) !== -1) return false;
        return true;
      });

      if (results.length) {
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
   * Wire up the Slice and Measurement (area/volume + distance) analysis tools.
   * Only one tool is active at a time; each renders into the top-right host.
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

    let active = null; // "slice" | "measure" | null

    function clearAll() {
      // Reset the slice plane and any active measurement.
      if (slice.viewModel) slice.viewModel.clear();
      measurement.clear();
      if (sliceNode.parentNode) host.removeChild(sliceNode);
      if (measureNode.parentNode) host.removeChild(measureNode);
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
      measurement.activeTool = tool; // "area" (3D area/volume) or "direct-line"
      active = "measure";
      btn.classList.add("active");
    }

    sliceBtn.addEventListener("click", function () {
      active === "slice" ? clearAll() : showSlice();
    });
    volumeBtn.addEventListener("click", function () {
      active === "measure" && measurement.activeTool === "area"
        ? clearAll()
        : showMeasurement("area", volumeBtn);
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
