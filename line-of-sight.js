import LineOfSightAnalysis from "@arcgis/core/analysis/LineOfSightAnalysis.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import { isAbortError } from "@arcgis/core/core/promiseUtils.js";

export function summarizeSightResults(targets, results, updating) {
  const counts = { visible: 0, blocked: 0, pending: 0, unavailable: 0 };
  for (const target of targets) {
    const result = results.find(candidate => candidate?.target === target);
    if (updating) counts.pending++;
    else if (result?.visible === true) counts.visible++;
    else if (result?.visible === false) counts.blocked++;
    else counts.unavailable++;
  }
  return counts;
}

export function createLineOfSightTool({ view, onClose, onError }) {
  const analysis = new LineOfSightAnalysis({ id: "badouzi-line-of-sight" });
  const element = document.createElement("section");
  element.id = "lineOfSightPanel";
  element.className = "line-of-sight-panel";
  element.setAttribute("aria-labelledby", "lineOfSightTitle");
  element.innerHTML = `
    <header class="sight-header">
      <h2 id="lineOfSightTitle">Line of sight</h2>
      <button class="sight-close" type="button" aria-label="Close and clear line of sight">&times;</button>
    </header>
    <div class="sight-body">
      <p class="sight-status" role="status"></p>
      <p class="sight-summary" role="status" hidden></p>
      <div class="sight-legend" aria-label="Sight-line colours">
        <span class="sight-visible">Green: visible</span>
        <span class="sight-blocked">Red: blocked</span>
        <span>Gray: unavailable</span>
      </div>
      <div class="tool-grid">
        <button class="tool-btn" id="sightPlace" type="button">Place observer</button>
        <button class="tool-btn" id="sightRestart" type="button">Start over</button>
      </div>
      <p class="sight-note">Results use the currently loaded 3D detail and can change with zoom.
        Keep the observer and targets in view.</p>
    </div>`;
  const status = element.querySelector(".sight-status");
  const summary = element.querySelector(".sight-summary");
  const placeButton = element.querySelector("#sightPlace");
  const restartButton = element.querySelector("#sightRestart");
  let analysisView;
  let watch;
  let placement;
  let operation;
  let initializing = false;
  let restarting = false;
  let disposed = false;
  let failure = null;

  function refresh() {
    if (disposed) return;
    element.dataset.state = failure ? "error" : initializing ? "loading" : placement ? "placing" : "ready";
    status.setAttribute("role", failure ? "alert" : "status");
    const message = failure
      ? `Line of sight unavailable: ${failure.message}. Try again or Clear.`
      : initializing ? "Preparing line of sight..."
        : placement ? analysis.valid
          ? "Click to add targets. Finish placing or press Esc when done."
          : "Click the scene to place the observer."
          : !analysis.valid ? "Place an observer, then add targets."
            : !analysis.targets.length ? "Observer placed. Add targets to check visibility."
              : "Drag points to refine the analysis. Right-click a target to remove it.";
    if (status.textContent !== message) status.textContent = message;
    placeButton.disabled = initializing || restarting;
    placeButton.textContent = failure ? "Try again" : placement ? "Finish placing"
      : analysis.valid ? "Add targets" : "Place observer";
    restartButton.disabled = initializing || restarting || !analysisView ||
      (!analysis.valid && !analysis.targets.length);
    const counts = summarizeSightResults(analysis.targets, analysisView?.results.toArray() ?? [], view.updating);
    const text = Object.entries(counts).filter(([, count]) => count > 0)
      .map(([name, count]) => `${count} ${name === "pending" ? "calculating" : name}`).join(" \u00b7 ");
    summary.hidden = !analysis.targets.length || !!failure;
    if (summary.textContent !== text) summary.textContent = text;
  }
  function report(error) {
    failure = error instanceof Error ? error : new Error(String(error));
    onError(failure);
    refresh();
  }
  async function place() {
    if (disposed || initializing || restarting || placement || !analysisView) return;
    failure = null;
    const controller = new AbortController();
    placement = controller;
    refresh();
    try {
      await analysisView.place({ signal: controller.signal });
    } catch (error) {
      if (!disposed && !isAbortError(error)) report(error);
    } finally {
      if (placement === controller) placement = null;
      refresh();
    }
  }
  async function initialize() {
    if (disposed || initializing) return;
    initializing = true;
    failure = null;
    refresh();
    try {
      const readyView = await view.whenAnalysisView(analysis);
      if (disposed) return;
      analysisView = readyView;
      analysisView.interactive = true;
      watch?.remove();
      watch = reactiveUtils.watch(() => {
        const results = analysisView.results.toArray();
        return [view.updating, analysis.valid, ...analysis.targets.map(target =>
          results.find(result => result?.target === target)?.visible)];
      }, refresh, { initial: true });
    } catch (error) {
      if (!disposed) report(error);
    } finally {
      initializing = false;
      refresh();
    }
    if (!disposed && analysisView && !failure) operation = place();
  }
  async function restart() {
    if (disposed || initializing || restarting || !analysisView) return;
    restarting = true;
    placement?.abort();
    refresh();
    await operation;
    if (disposed) return;
    analysis.clear();
    restarting = false;
    operation = place();
  }
  function keydown(event) {
    if (event.key !== "Escape" || !placement || event.defaultPrevented ||
      !document.getElementById("assumptionsPanel").hidden ||
      document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')) return;
    event.preventDefault();
    event.stopPropagation();
    placement.abort();
  }
  placeButton.addEventListener("click", () => {
    if (placement) placement.abort();
    else if (!analysisView) initialize();
    else operation = place();
  });
  restartButton.addEventListener("click", restart);
  element.querySelector(".sight-close").addEventListener("click", onClose);
  document.addEventListener("keydown", keydown, true);
  view.analyses.add(analysis);
  initialize();
  return {
    element,
    dispose() {
      if (disposed) return;
      disposed = true;
      placement?.abort();
      watch?.remove();
      if (analysisView) analysisView.interactive = false;
      document.removeEventListener("keydown", keydown, true);
      view.analyses.remove(analysis);
      analysis.destroy();
      element.remove();
    }
  };
}
