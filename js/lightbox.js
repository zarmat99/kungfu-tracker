// A photo on the whole screen, with the others of its gallery. Swipe or the arrows to move, a tap on the
// photo to zoom in (then drag to look around), a swipe down, Esc or the phone's back button to close.
import { icon } from "./icons.js";

const ZOOM = 2.4;
let box = null; // { el, items, i, urlOf, opener, zoom }

/** `items` are { alt, ... }; `urlOf(item)` gives a promise of the photo's address. */
export function openLightbox(items, start, urlOf, opener) {
  closeLightbox(true);
  const el = document.createElement("div");
  el.className = "lightbox loading";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Foto");
  const many = items.length > 1;
  el.innerHTML = `
    <div class="lb-stage"><img class="lb-img" alt="" draggable="false"></div>
    <span class="spinner lb-spin" aria-hidden="true"></span>
    <button class="icon-btn lb-close" type="button" aria-label="Chiudi">${icon("x")}</button>
    ${many ? `<button class="lb-nav prev" type="button" aria-label="Foto precedente">${icon("left")}</button>
    <button class="lb-nav next" type="button" aria-label="Foto successiva">${icon("right")}</button>` : ""}
    <div class="lb-foot"><div class="lb-text"><p class="lb-cap"></p><a class="lb-place" hidden></a></div>${many ? `<span class="lb-count" aria-live="polite"></span>` : ""}</div>`;
  document.body.append(el);
  document.body.classList.add("lb-open");
  box = { el, items, i: start, urlOf, opener, zoom: false };
  // the back button closes the photo instead of leaving the note
  history.pushState({ lightbox: true }, "", location.href);
  wire(el);
  show(start);
  el.querySelector(".lb-close").focus({ preventScroll: true });
}

/** Closes the photo; `fromHistory` when the back step already happened (or must not happen). */
export function closeLightbox(fromHistory = false) {
  if (!box) return;
  const { el, opener } = box;
  box = null;
  document.body.classList.remove("lb-open");
  document.removeEventListener("keydown", onKey);
  removeEventListener("popstate", onPop);
  el.classList.add("closing");
  setTimeout(() => el.remove(), 200);
  if (!fromHistory && history.state?.lightbox) history.back();
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}

function show(i) {
  if (!box) return;
  const { el, items, urlOf } = box;
  box.i = Math.max(0, Math.min(items.length - 1, i));
  const item = items[box.i];
  const img = el.querySelector(".lb-img");
  setZoom(false);
  el.classList.add("loading");
  img.removeAttribute("src");
  img.alt = item.alt || "";
  el.querySelector(".lb-cap").textContent = item.alt || "";
  // opened from elsewhere (the glossary): the way to the note where the photo is
  const place = el.querySelector(".lb-place");
  place.hidden = !item.href;
  if (item.href) {
    place.href = item.href;
    place.innerHTML = `Apri in ${item.place ? "" : "nota"}<b></b>${icon("right")}`;
    place.querySelector("b").textContent = item.place || "";
  }
  const count = el.querySelector(".lb-count");
  if (count) count.textContent = `${box.i + 1} / ${items.length}`;
  const prev = el.querySelector(".lb-nav.prev"), next = el.querySelector(".lb-nav.next");
  if (prev) prev.disabled = box.i === 0;
  if (next) next.disabled = box.i === items.length - 1;
  const wanted = box.i;
  urlOf(item).then(url => {
    if (!box || box.i !== wanted) return;
    img.src = url;
    return img.decode().catch(() => {});
  }).catch(() => {
    if (box?.i === wanted) el.querySelector(".lb-cap").textContent = `${item.alt ? `${item.alt} · ` : ""}non riesco a scaricare la foto`;
  }).finally(() => {
    if (box?.i === wanted) el.classList.remove("loading");
  });
  // the neighbours start downloading now, so the next swipe is instant
  for (const k of [box.i + 1, box.i - 1]) if (items[k]) urlOf(items[k]).catch(() => {});
}

/** Zooms in around the point tapped (in viewport coordinates), or back to the whole photo. */
function setZoom(on, x, y) {
  if (!box) return;
  const stage = box.el.querySelector(".lb-stage"), img = box.el.querySelector(".lb-img");
  if (on === box.zoom) return;
  if (on) {
    const r = img.getBoundingClientRect();
    if (!r.width) return;
    const fx = x === undefined ? 0.5 : (x - r.left) / r.width, fy = y === undefined ? 0.5 : (y - r.top) / r.height;
    img.style.width = `${r.width * ZOOM}px`;
    img.style.height = `${r.height * ZOOM}px`;
    stage.classList.add("zoomed");
    stage.scrollLeft = Math.max(0, fx * r.width * ZOOM - stage.clientWidth / 2);
    stage.scrollTop = Math.max(0, fy * r.height * ZOOM - stage.clientHeight / 2);
  } else {
    stage.classList.remove("zoomed");
    img.style.width = img.style.height = "";
  }
  box.zoom = on;
  box.el.classList.toggle("is-zoomed", on);
}

function onKey(e) {
  if (!box) return;
  if (e.key === "Escape") { e.preventDefault(); closeLightbox(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); show(box.i - 1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); show(box.i + 1); }
}

function onPop() {
  if (box) closeLightbox(true);
}

function wire(el) {
  document.addEventListener("keydown", onKey);
  addEventListener("popstate", onPop);
  const stage = el.querySelector(".lb-stage"), img = el.querySelector(".lb-img");
  let start = null, moved = false;

  /** A tap on the photo zooms in or out; beside it, it closes (unless zoomed in). */
  const tap = (target, x, y) => {
    if (target === img) setZoom(!box.zoom, x, y);
    else if (!box.zoom) closeLightbox();
  };

  el.addEventListener("click", e => {
    if (e.target.closest(".lb-close")) return closeLightbox();
    const place = e.target.closest(".lb-place");
    if (place) {
      // the step added for the photo becomes the note, so back returns to where the photo was opened
      e.preventDefault();
      const href = place.getAttribute("href");
      closeLightbox(true);
      history.replaceState(null, "", href);
      dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    if (e.target.closest(".lb-nav.prev")) return show(box.i - 1);
    if (e.target.closest(".lb-nav.next")) return show(box.i + 1);
    // the mouse; a finger is handled on touchend
    if (moved) { moved = false; return; }
    if (e.target.closest(".lb-stage")) tap(e.target, e.clientX, e.clientY);
  });

  stage.addEventListener("touchstart", e => {
    if (e.touches.length > 1) { start = null; return; }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, zoomed: box?.zoom };
    moved = false;
    if (!start.zoomed) img.style.transition = "none";
  }, { passive: true });
  stage.addEventListener("touchmove", e => {
    if (!start) return;
    const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
    // zoomed in, the finger moves around the photo; otherwise the photo follows it: sideways to move on, down to close
    if (start.zoomed) return;
    img.style.transform = Math.abs(dx) > Math.abs(dy) ? `translateX(${dx}px)` : `translateY(${Math.max(0, dy)}px) scale(${1 - Math.min(0.15, Math.max(0, dy) / 1500)})`;
  }, { passive: true });
  stage.addEventListener("touchend", e => {
    if (!start || !box) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    const { zoomed } = start;
    start = null;
    img.style.transition = "";
    img.style.transform = "";
    if (!moved) {
      // a tap: handled here, so no click (or a late one) acts on it twice
      e.preventDefault();
      tap(e.target, t.clientX, t.clientY);
      return;
    }
    if (zoomed) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) show(box.i + (dx < 0 ? 1 : -1));
    else if (dy > 90 && dy > Math.abs(dx) * 1.3) closeLightbox();
  });
}
