export function setupInspectorPresentation(card, button) {
  const header = card.querySelector(".inspector-header");
  const placeholder = document.createComment("asset inspector dock position");
  let expanded = false;
  let drag = null;
  const edge = 16;

  function limits() {
    const consoleTop = document.querySelector(".surge-console").getBoundingClientRect().top;
    const bottom = Math.max(220, Math.min(innerHeight - edge, consoleTop - edge));
    card.style.maxHeight = `${bottom - edge}px`;
    const box = card.getBoundingClientRect();
    return { box, right: Math.max(edge, innerWidth - box.width - edge),
      bottom: Math.max(edge, bottom - box.height) };
  }
  function position(x, y) {
    const bounds = limits();
    card.style.left = `${Math.max(edge, Math.min(bounds.right, x))}px`;
    card.style.top = `${Math.max(edge, Math.min(bounds.bottom, y))}px`;
  }
  function stopDrag() {
    if (!drag) return;
    const id = drag.pointerId;
    drag = null;
    card.classList.remove("is-dragging");
    if (header.hasPointerCapture(id)) header.releasePointerCapture(id);
  }
  function collapse(returnFocus = false) {
    if (!expanded) return;
    stopDrag();
    expanded = false;
    card.classList.remove("is-expanded");
    card.removeAttribute("role");
    card.removeAttribute("aria-modal");
    card.style.left = card.style.top = card.style.maxHeight = "";
    header.removeAttribute("tabindex");
    header.removeAttribute("title");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Expand asset details for presentation");
    button.title = "Expand for presentation";
    placeholder.replaceWith(card);
    if (returnFocus) {
      card.scrollIntoView({ block: "nearest" });
      button.focus({ preventScroll: true });
    }
  }
  function expand() {
    if (expanded) return;
    expanded = true;
    card.before(placeholder);
    document.body.append(card);
    card.classList.add("is-expanded");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    header.tabIndex = 0;
    header.title = "Drag to move, or focus this header and use the arrow keys";
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "Restore asset details to the side panel");
    button.title = "Restore to side panel";
    const bounds = limits();
    position((innerWidth - bounds.box.width) / 2, bounds.bottom / 2);
    button.focus({ preventScroll: true });
  }
  function refresh() {
    if (!expanded) return;
    const box = card.getBoundingClientRect();
    position(box.left, box.top);
  }
  button.addEventListener("click", () => expanded ? collapse(true) : expand());
  header.addEventListener("pointerdown", event => {
    if (!expanded || event.button !== 0 || event.target.closest("button, a, input, select, textarea")) return;
    const box = card.getBoundingClientRect();
    drag = { dx: event.clientX - box.left, dy: event.clientY - box.top, pointerId: event.pointerId };
    header.setPointerCapture(event.pointerId);
    card.classList.add("is-dragging");
    event.preventDefault();
  });
  header.addEventListener("pointermove", event => {
    if (drag) position(event.clientX - drag.dx, event.clientY - drag.dy);
  });
  header.addEventListener("pointerup", stopDrag);
  header.addEventListener("pointercancel", stopDrag);
  header.addEventListener("lostpointercapture", stopDrag);
  window.addEventListener("keydown", event => {
    if (!expanded || event.defaultPrevented ||
      !document.getElementById("assumptionsPanel").hidden ||
      document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      collapse(true);
    } else if (event.target === header) {
      const moves = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      event.stopPropagation();
      const box = card.getBoundingClientRect();
      position(box.left + move[0], box.top + move[1]);
    }
  }, true);
  window.addEventListener("resize", refresh);
  return { collapse, refresh, get expanded() { return expanded; } };
}
