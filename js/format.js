export const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
export const WEEKDAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
export const WEEKDAY_INITIALS = ["L", "M", "M", "G", "V", "S", "D"];
export const CN_MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

export const pad = n => String(n).padStart(2, "0");
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** The same day `n` years later (or earlier); 29 February becomes the 28th. */
export function addYears(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y + n, m - 1, d);
  if (date.getMonth() !== m - 1) date.setDate(0);
  return iso(date);
}

/** Whole days from one ISO date to another: positive when `to` comes later. */
export const daysBetween = (from, to) => Math.round((parseISO(to) - parseISO(from)) / 86400000);

/** "Oggi", "Ieri", "3 giorni fa", "Domani", "Tra 5 giorni" */
export function relativeDay(date) {
  const days = daysBetween(today(), date);
  if (days === 0) return "Oggi";
  if (days === -1) return "Ieri";
  if (days < -1) return `${-days} giorni fa`;
  return days === 1 ? "Domani" : `Tra ${days} giorni`;
}

/** Monday of the week containing the given ISO date. */
export function weekStart(s) {
  const d = parseISO(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}

export const fmtNum = (n, digits = 1) => n.toLocaleString("it-IT", { maximumFractionDigits: digits });

/** "1 gara", "4 gare" */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Lunedì 28 settembre" */
export function fmtLongDate(s) {
  const d = parseISO(s);
  return `${cap(WEEKDAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "16 mag 2026", or "16 mag" without the year; never split across lines */
export function fmtShortDate(s, withYear = true) {
  const d = parseISO(s);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
}

/** "8 gen–4 lug 2026", or "3 set 2025–4 lug 2026" across two years; never split across lines */
export function fmtSpan(from, to) {
  if (from === to) return fmtShortDate(to);
  const a = parseISO(from), b = parseISO(to);
  const start = a.getFullYear() !== b.getFullYear() ? fmtShortDate(from) : a.getMonth() !== b.getMonth() ? fmtShortDate(from, false) : a.getDate();
  // the word joiner keeps the line from breaking after the dash
  return `${start}–⁠${fmtShortDate(to)}`;
}

/** "12–18 gen 2026", "29 set–5 ott 2025": the week starting on `monday` */
export const fmtWeek = monday => fmtSpan(monday, addDays(monday, 6));

/** "Sabato 15 maggio 2027", or "Maggio 2027" when the day is still to be confirmed. */
export function whenLabel(item) {
  const d = parseISO(item.date);
  return item.dateTbc ? `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}` : `${fmtLongDate(item.date)} ${d.getFullYear()}`;
}

export function fmtRelative(ts) {
  if (!ts) return "mai";
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h fa`;
  return new Date(ts).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
