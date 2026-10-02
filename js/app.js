import { loadCached, load, isConnected, subscribe, getState, errorMessage } from "./store.js";
import { parseRoute, navigate } from "./router.js";
import { renderCalendar } from "./views/calendar.js";
import { renderLog } from "./views/log.js";
import { renderCompetitions } from "./views/competitions.js";
import { renderCompetitionForm } from "./views/competition-form.js";
import { renderProgress } from "./views/progress.js";
import { renderGoalForm } from "./views/goal-form.js";
import { renderSettings } from "./views/settings.js";
import { renderKnowledge } from "./views/knowledge.js";
import { loadCachedNotes, loadNotes } from "./notes.js";
import { icon } from "./icons.js";
import { toast, closeSheet, hideTip } from "./ui.js";
import { weekStreak } from "./stats.js";

const VIEWS = {
  calendar: renderCalendar,
  log: renderLog,
  competitions: renderCompetitions,
  "competition-edit": renderCompetitionForm,
  progress: renderProgress,
  "goal-edit": renderGoalForm,
  knowledge: renderKnowledge,
  settings: renderSettings,
};
/** The dock tab that stays lit on pages without their own tab. */
const TAB_OF = { "competition-edit": "competitions", "goal-edit": "progress" };
const SYNC_LABELS = {
  idle: "Non collegato",
  loading: "Sincronizzo…",
  saving: "Salvo su GitHub…",
  ready: "Sincronizzato",
  error: "Errore di sincronizzazione",
  offline: "Offline",
};

const main = document.getElementById("main");
const dock = document.querySelector(".dock");
let cleanup = null;

/** Icon and name of each dock tab; a tab missing from a page cached before it existed is just skipped. */
const DOCK = {
  calendar: ["calendar", "Calendario"],
  progress: ["chart", "Grafici"],
  log: ["plus", "Registra"],
  competitions: ["trophy", "Gare"],
  knowledge: ["book", "Conoscenza"],
};

document.querySelector("[data-settings]").innerHTML = icon("sliders");
for (const [tab, [glyph, label]] of Object.entries(DOCK)) {
  const link = dock.querySelector(`[data-tab="${tab}"]`);
  if (link) link.innerHTML = `${icon(glyph)}<span>${label}</span>`;
}

function render() {
  const { name, params } = parseRoute();
  if (!isConnected() && name !== "settings") return navigate("#/settings", { replace: true });
  cleanup?.();
  closeSheet(true);
  hideTip();
  // a fresh container per view, so listeners never pile up across navigations
  const container = document.createElement("div");
  main.replaceChildren(container);
  window.scrollTo(0, 0);
  cleanup = (VIEWS[name] || VIEWS.calendar)(container, params) || null;
  dock.hidden = !isConnected();
  const tab = TAB_OF[name] || name;
  dock.querySelectorAll("[data-tab]").forEach(a => {
    a.classList.toggle("active", a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  updateChrome(getState());
  const { data, status } = getState();
  if (isConnected() && !data && status === "idle") load().catch(err => toast(errorMessage(err), "error"));
}

function updateChrome(state) {
  const status = navigator.onLine ? state.status : "offline";
  const sync = document.querySelector(".sync");
  sync.dataset.status = status;
  sync.title = SYNC_LABELS[status];
  sync.setAttribute("aria-label", SYNC_LABELS[status]);
  sync.hidden = !isConnected();

  const streak = document.querySelector(".streak");
  const weeks = state.data ? weekStreak(state.data.sessions) : 0;
  streak.hidden = !isConnected() || weeks < 2;
  streak.innerHTML = `${icon("flame")}${weeks}`;
  streak.title = `${weeks} settimane di fila con almeno un allenamento`;
}

subscribe(updateChrome);
window.addEventListener("online", () => updateChrome(getState()));
window.addEventListener("offline", () => updateChrome(getState()));
window.addEventListener("hashchange", render);

// back on the app after a while: fetch what changed elsewhere
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (isConnected() && Date.now() - hiddenAt > 5 * 60 * 1000 && getState().status !== "saving") {
    load().catch(() => {});
    loadNotes().catch(() => {});
  }
});

loadCached();
loadCachedNotes();
// the notes come after the data, so the calendar is never kept waiting
if (isConnected()) load().catch(err => toast(errorMessage(err), "error")).finally(() => loadNotes().catch(() => {}));
render();
