import Point from "@arcgis/core/geometry/Point.js";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import {
  FLIGHT_KEYS, createFlightMotion, changeFlightSpeed, haltFlight, lookFlight, stepFlight
} from "./flight-motion.js";
import "./flight.css";

export function setupFlight({ view, onEnter }) {
  const container = view.container;
  const button = document.getElementById("flightBtn");
  const notice = document.getElementById("flightStatus");
  const help = document.createElement("div");
  help.id = "flightHelp";
  help.className = "flight-help";
  help.hidden = true;
  help.setAttribute("aria-label", "Drone mode controls");
  help.innerHTML = `
    <div class="flight-keys">
      <span><kbd>W A S D</kbd> move</span>
      <span><kbd>Q E</kbd> / <kbd>&larr; &rarr;</kbd> turn</span>
      <span><kbd>I K</kbd> / <kbd>&uarr; &darr;</kbd> climb / descend</span>
      <span>Wheel: speed</span>
    </div>
    <p class="flight-hint" role="status"></p>`;
  button.closest(".dock-section").append(help);
  const hint = help.querySelector(".flight-hint");
  const keys = new Set();
  let active = false;
  let locked = false;
  let cursorFree = false;
  let dragging = false;
  let dragDistance = 0;
  let suppressClickUntil = 0;
  let releasedAt = -Infinity;
  let lockErrorShown = false;
  let state;
  let cameraTemplate;
  let frame = 0;
  let lastTime = 0;
  let handles = [];

  function typing(target) {
    return target instanceof HTMLElement &&
      (target.isContentEditable || !!target.closest("input,textarea,select"));
  }
  function dialogOpen() {
    return !document.getElementById("assumptionsPanel").hidden ||
      !!document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])');
  }
  function sceneTarget(target) {
    return target instanceof Element && container.contains(target) &&
      !target.closest(".esri-ui,button,a,input,textarea,select");
  }
  function pause() {
    keys.clear();
    dragging = false;
    if (state) haltFlight(state);
  }
  function updateHint() {
    if (locked) hint.textContent = "Mouse: look around. X or Esc frees the cursor. V exits.";
    else if (cursorFree) hint.textContent = "Cursor free: click to inspect; drag to look. X captures the mouse. Esc exits.";
    else hint.textContent = "Click the scene to capture the mouse, or X for drag-to-look. V exits.";
  }
  function reportLockError(error) {
    if (!active || locked || lockErrorShown) return;
    lockErrorShown = true;
    cursorFree = true;
    console.warn("[Badouzi Digital Twin] Drone mouse capture:", error);
    hint.textContent = "Mouse capture unavailable. Hold left/right mouse to look; keyboard flight still works. X retries.";
  }
  function requestLock() {
    if (!active) return;
    lockErrorShown = false;
    try {
      if (!container.requestPointerLock) throw new Error("Pointer lock is not supported by this browser");
      const request = container.requestPointerLock();
      if (request?.catch) request.catch(reportLockError);
    } catch (error) {
      reportLockError(error);
    }
  }
  function releasePointer() {
    if (document.pointerLockElement !== container) return;
    locked = false;
    cursorFree = true;
    releasedAt = performance.now();
    pause();
    document.exitPointerLock();
    if (active) updateHint();
  }
  function fail(error) {
    console.warn("[Badouzi Digital Twin] Drone flight:", error);
    exit();
    notice.hidden = false;
    notice.textContent = `Drone mode unavailable: ${error.message}`;
  }
  function tick(now) {
    if (!active) return;
    try {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (document.hidden || !document.hasFocus() || typing(document.activeElement) || dialogOpen()) pause();
      else if (stepFlight(state, keys, dt)) {
        const camera = cameraTemplate.clone();
        camera.position = new Point({
          x: state.x, y: state.y, z: state.z, spatialReference: { wkid: 102100 }
        });
        camera.heading = state.heading;
        camera.tilt = state.tilt;
        view.camera = camera;
      }
      frame = requestAnimationFrame(tick);
    } catch (error) {
      fail(error);
    }
  }
  function enter() {
    if (active || dialogOpen()) return;
    try {
      if (!view.ready || view.fatalError) throw new Error("Wait for the scene to be ready before flying");
      onEnter();
      view.animation?.stop();
      cameraTemplate = view.camera.clone();
      const position = cameraTemplate.position;
      if (!position.spatialReference.isWebMercator && !position.spatialReference.isGeographic) {
        throw new Error("This scene does not use a supported drone coordinate system");
      }
      const point = position.spatialReference.isGeographic
        ? webMercatorUtils.geographicToWebMercator(position) : position;
      state = createFlightMotion({
        x: point.x, y: point.y, z: position.z,
        heading: cameraTemplate.heading, tilt: cameraTemplate.tilt
      });
      active = true;
      cursorFree = false;
      dragging = false;
      suppressClickUntil = 0;
      releasedAt = -Infinity;
      keys.clear();
      notice.hidden = true;
      help.hidden = false;
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      document.body.classList.add("flight-active");
      const stop = event => event.stopPropagation();
      handles = [
        view.on("drag", stop),
        view.on("mouse-wheel", stop),
        view.on("double-click", stop),
        view.on("key-down", stop),
        view.on("key-up", stop),
        view.on("click", event => {
          if (capturesClicks()) event.stopPropagation();
          if (!locked && !cursorFree) requestLock();
        })
      ];
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
      updateHint();
      requestLock();
    } catch (error) {
      fail(error);
    }
  }
  function exit() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(frame);
    pause();
    handles.forEach(handle => handle.remove());
    handles = [];
    releasePointer();
    locked = false;
    help.hidden = true;
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
    document.body.classList.remove("flight-active");
  }
  function toggle() {
    if (active) exit();
    else enter();
  }
  function keydown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
      typing(event.target) || dialogOpen()) return;
    const key = event.key.toLowerCase();
    if (key === "v") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggle();
    } else if (active && key === "escape") {
      event.preventDefault();
      event.stopPropagation();
      if (locked || performance.now() - releasedAt < 250) releasePointer();
      else exit();
    } else if (active && key === "x") {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      pause();
      cursorFree = !cursorFree;
      updateHint();
      if (cursorFree) releasePointer();
      else requestLock();
    } else if (active && FLIGHT_KEYS.has(key)) {
      event.preventDefault();
      event.stopPropagation();
      keys.add(key);
    }
  }
  function keyup(event) {
    keys.delete(event.key.toLowerCase());
  }
  function wheel(event) {
    if (!active || !sceneTarget(event.target) || dialogOpen()) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
    changeFlightSpeed(state, event.deltaY * scale);
  }
  function mousedown(event) {
    if (!active || locked || !cursorFree || !sceneTarget(event.target) || dialogOpen()) return;
    if (event.button !== 0 && event.button !== 2) return;
    dragging = true;
    dragDistance = 0;
  }
  function mousemove(event) {
    if (!active || (!locked && !dragging) || dialogOpen()) return;
    if (dragging) {
      dragDistance += Math.hypot(event.movementX, event.movementY);
      if (dragDistance <= 3) return;
      suppressClickUntil = performance.now() + 350;
    }
    lookFlight(state, event.movementX, event.movementY);
  }
  function mouseup() {
    if (dragging && dragDistance > 3) suppressClickUntil = performance.now() + 350;
    dragging = false;
  }
  function contextmenu(event) {
    if (active && sceneTarget(event.target)) event.preventDefault();
  }
  function lockchange() {
    const wasLocked = locked;
    locked = document.pointerLockElement === container;
    if (!active) {
      releasePointer();
      return;
    }
    if (wasLocked && !locked) {
      releasedAt = performance.now();
      cursorFree = true;
      pause();
    }
    if (locked) cursorFree = false;
    updateHint();
  }
  const lockerror = () => reportLockError(new Error("The browser denied mouse capture"));
  function visibility() {
    if (document.hidden) {
      pause();
      releasePointer();
    }
  }
  function capturesClicks() {
    return active && (locked || !cursorFree || dragging || performance.now() < suppressClickUntil);
  }
  const navigation = reactiveUtils.watch(() => view.animation, animation => {
    // Home, the native zoom buttons, and asset zooms must not fight the pilot.
    if (active && animation) exit();
  }, { sync: true });
  const listeners = [
    [document, "keydown", keydown, true],
    [document, "keyup", keyup],
    [container, "wheel", wheel, { passive: false }],
    [container, "mousedown", mousedown],
    [document, "mousemove", mousemove],
    [document, "mouseup", mouseup],
    [container, "contextmenu", contextmenu],
    [document, "pointerlockchange", lockchange],
    [document, "pointerlockerror", lockerror],
    [document, "visibilitychange", visibility],
    [window, "blur", pause],
    [button, "click", toggle]
  ];
  listeners.forEach(([target, type, listener, options]) => target.addEventListener(type, listener, options));
  return {
    exit,
    isActive: () => active,
    capturesClicks,
    dispose() {
      exit();
      navigation.remove();
      listeners.forEach(([target, type, listener, options]) => target.removeEventListener(type, listener, options));
      help.remove();
    }
  };
}
