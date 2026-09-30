import { icon } from "./icons.js";

export function toast(message, kind = "ok") {
  let host = document.querySelector(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${icon(kind === "error" ? "x" : "check")}<span></span>`;
  el.querySelector("span").textContent = message;
  host.append(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  }, kind === "error" ? 5200 : 2600);
}

/** The red seal that gets stamped on screen after a save. */
export function stamp(glyph = "功") {
  const el = document.createElement("div");
  el.className = "stamp";
  el.innerHTML = `<div class="stamp-seal"><span>${glyph}</span></div>`;
  document.body.append(el);
  if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.(18);
  setTimeout(() => el.remove(), 1250);
}

export function openSheet(html, onMount) {
  closeSheet(true);
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-handle"></div><div class="sheet-body">${html}</div></div>`;
  document.body.append(wrap);
  document.body.classList.add("sheet-open");
  wrap.querySelector(".sheet-backdrop").addEventListener("click", () => closeSheet());

  // drag the sheet down to close it
  const sheet = wrap.querySelector(".sheet");
  let startY = null, dy = 0;
  sheet.addEventListener("touchstart", e => {
    if (sheet.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  sheet.addEventListener("touchmove", e => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener("touchend", () => {
    if (startY === null) return;
    startY = null;
    if (dy > 90) closeSheet();
    else sheet.style.transform = "";
  });

  const body = wrap.querySelector(".sheet-body");
  onMount?.(body);
  return body;
}

export function closeSheet(immediate = false) {
  const wrap = document.querySelector(".sheet-wrap");
  if (!wrap) return;
  document.body.classList.remove("sheet-open");
  if (immediate) return wrap.remove();
  wrap.classList.add("closing");
  setTimeout(() => wrap.remove(), 260);
}

export const sheetBody = () => document.querySelector(".sheet-wrap:not(.closing) .sheet-body");

/** First tap arms the button, a second tap within 3 s confirms. */
export function armConfirm(button, confirmLabel, onConfirm) {
  if (button.classList.contains("armed")) {
    onConfirm();
    return;
  }
  const original = button.innerHTML;
  button.classList.add("armed");
  button.innerHTML = `${icon("check")} ${confirmLabel}`;
  setTimeout(() => {
    if (!button.isConnected) return;
    button.classList.remove("armed");
    button.innerHTML = original;
  }, 3000);
}
