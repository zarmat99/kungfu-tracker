// App state: the tracker data, its GitHub sha, and the connection settings.
import * as github from "./github.js";
import { byDate } from "./stats.js";

const CONFIG_KEY = "kft.config";
const CACHE_KEY = "kft.cache";
const DEV_KEY = "kft.dev";

export const DEFAULTS = { token: "", repo: "zarmat99/kungfu-space", path: "dati/tracker.json", branch: "main" };

/** Local development: `?dev` on localhost reads dev-data.json and keeps writes in this browser. */
export const DEV = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("dev");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const devTransport = {
  async readFile() {
    await sleep(300);
    const saved = localStorage.getItem(DEV_KEY);
    const text = saved ?? await (await fetch("dev-data.json", { cache: "no-store" })).text();
    return { text, sha: "dev" };
  },
  async writeFile(cfg, text) {
    await sleep(600);
    localStorage.setItem(DEV_KEY, text);
    return { sha: "dev" };
  },
};
const transport = DEV ? devTransport : github;

let state = { data: null, sha: null, status: "idle", error: null, syncedAt: null };
const listeners = new Set();

export const getState = () => state;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn(state));
}

export function getConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
export function setConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}
export const isConnected = () => DEV || Boolean(getConfig().token);

export function disconnect() {
  try { [CONFIG_KEY, CACHE_KEY, DEV_KEY].forEach(k => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
  set({ data: null, sha: null, status: "idle", error: null, syncedAt: null });
}

function normalize(data) {
  return { version: 1, ...data, sessions: data.sessions || [], competitions: data.competitions || [], weights: data.weights || [] };
}

function sortData(data) {
  data.sessions.sort(byDate);
  data.competitions.sort(byDate);
  data.weights.sort(byDate);
}

function writeCache() {
  if (DEV) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: state.data, sha: state.sha, syncedAt: state.syncedAt })); }
  catch { /* cache is optional */ }
}

/** Shows the last data seen on this device right away, before the network answers. */
export function loadCached() {
  if (DEV || !getConfig().token) return false;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached?.data) {
      set({ data: normalize(cached.data), sha: cached.sha, syncedAt: cached.syncedAt });
      return true;
    }
  } catch { /* ignore a broken cache */ }
  return false;
}

export async function load() {
  set({ status: "loading", error: null });
  try {
    const { text, sha } = await transport.readFile(getConfig());
    set({ data: normalize(JSON.parse(text)), sha, status: "ready", syncedAt: Date.now() });
    writeCache();
  } catch (error) {
    set({ status: "error", error });
    throw error;
  }
}

/**
 * Applies `mutate` to a copy of the data and saves it as one commit.
 * If someone else saved in the meantime (sha conflict), reloads and applies the change again.
 */
export async function commit(mutate, message) {
  if (!state.data) await load();
  set({ status: "saving", error: null });
  try {
    for (let attempt = 0; ; attempt++) {
      const next = structuredClone(state.data);
      mutate(next);
      sortData(next);
      try {
        const { sha } = await transport.writeFile(getConfig(), JSON.stringify(next, null, 2) + "\n", state.sha, message);
        set({ data: next, sha, status: "ready", syncedAt: Date.now() });
        writeCache();
        return next;
      } catch (error) {
        if (attempt > 0 || (error.status !== 409 && error.status !== 422)) throw error;
        const fresh = await transport.readFile(getConfig());
        state = { ...state, data: normalize(JSON.parse(fresh.text)), sha: fresh.sha };
      }
    }
  } catch (error) {
    set({ status: "error", error });
    throw error;
  }
}

export function errorMessage(error) {
  if (!navigator.onLine || error instanceof TypeError) return "Sei offline: riprova quando c'è rete";
  switch (error?.status) {
    case 401: return "Token non valido o scaduto";
    case 403: return "Il token non ha il permesso di scrivere (Contents: Read and write)";
    case 404: return "Non trovo il file: controlla che il token veda il repository";
    case 409: case 422: return "Qualcun altro ha salvato nello stesso momento: riprova";
    default: return error?.message || "Qualcosa è andato storto";
  }
}
