import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import { fromRenderCamera, toRenderCamera, toRenderCoordinates } from "@arcgis/core/views/3d/webgl.js";
import { addWheelZoom, createZoomMotion, stepZoomMotion, wheelDeltaPixels } from "./zoom-motion.js";

export function setupSmoothZoom({ view, isEnabled, onStart, onError }) {
  const container = view.container;
  const actionMap = view.navigation.actionMap;
  const previousWheelAction = actionMap.mouseWheel;
  actionMap.mouseWheel = "none";
  let motion;
  let frame = 0;
  let lastTime = 0;
  let failed = false;

  function blocked() {
    return !isEnabled() || document.hidden || !document.hasFocus() ||
      !document.getElementById("assumptionsPanel").hidden ||
      !!document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])');
  }
  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
    motion?.camera.destroy();
    motion = null;
  }
  function fail(error) {
    cancel();
    failed = true;
    actionMap.mouseWheel = previousWheelAction;
    onError(error);
  }
  function tick() {
    frame = 0;
    if (!motion) return;
    if (blocked() || view.interacting) {
      cancel();
      return;
    }
    try {
      const now = performance.now();
      const step = stepZoomMotion(motion.state, (now - lastTime) / 1000);
      lastTime = now;
      const eye = motion.anchor.map((value, i) => value + motion.direction[i] * step.distance);
      motion.camera.eye = eye;
      motion.camera.center = eye.map((value, i) => value + motion.look[i]);
      const camera = fromRenderCamera(view, motion.camera);
      camera.fov = motion.fov;
      const { min, max } = view.constraints.altitude;
      const altitude = camera.position.z;
      camera.position.z = Math.max(min, Math.min(max, altitude));
      view.camera = camera;
      if (step.done || altitude !== camera.position.z) cancel();
      else frame = requestAnimationFrame(tick);
    } catch (error) {
      fail(error);
    }
  }
  function wheel(event) {
    if (failed || blocked() || event.defaultPrevented || event.ctrlKey || event.metaKey ||
      !(event.target instanceof Element) ||
      event.target.closest(".esri-ui,button,a,input,textarea,select") || !event.deltaY) return;
    event.preventDefault();
    try {
      const pixels = wheelDeltaPixels(event.deltaY, event.deltaMode, container.clientHeight);
      if (motion && Math.hypot(event.clientX - motion.pointer.x, event.clientY - motion.pointer.y) > 4) cancel();
      if (!motion) {
        onStart();
        view.animation?.stop();
        const bounds = container.getBoundingClientRect();
        const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        const target = view.toMap(screen, { include: [view.map.ground, ...view.map.allLayers] }) ||
          view.toMap({ x: view.width / 2, y: view.height / 2 }) || view.center;
        if (!target) throw new Error("No zoom target is available in this view");
        const anchor = [0, 0, 0];
        if (!toRenderCoordinates(view, [target.x, target.y, target.z ?? 0], 0,
          target.spatialReference, anchor, 0, 1)) throw new Error("The zoom target could not be projected");
        const camera = toRenderCamera(view, view.camera);
        const direction = camera.eye.map((value, i) => value - anchor[i]);
        const distance = Math.hypot(...direction);
        const state = createZoomMotion(distance);
        motion = {
          camera, anchor, state, fov: view.camera.fov,
          direction: direction.map(value => value / distance),
          look: camera.center.map((value, i) => value - camera.eye[i]),
          pointer: { x: event.clientX, y: event.clientY }
        };
        lastTime = performance.now();
      }
      addWheelZoom(motion.state, pixels);
      if (!frame) frame = requestAnimationFrame(tick);
    } catch (error) {
      fail(error);
    }
  }
  const navigation = reactiveUtils.watch(() => [view.animation, view.interacting], ([animation, interacting]) => {
    if (animation || interacting) cancel();
  }, { sync: true });
  const visibility = () => { if (document.hidden) cancel(); };
  const listeners = [
    [container, "wheel", wheel, { passive: false }],
    [container, "pointerdown", cancel, true],
    [window, "blur", cancel],
    [document, "visibilitychange", visibility]
  ];
  listeners.forEach(([target, type, listener, options]) => target.addEventListener(type, listener, options));
  return {
    cancel,
    dispose() {
      cancel();
      actionMap.mouseWheel = previousWheelAction;
      navigation.remove();
      listeners.forEach(([target, type, listener, options]) => target.removeEventListener(type, listener, options));
    }
  };
}
