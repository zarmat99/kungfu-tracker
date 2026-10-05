// The notes in the private repository: every Markdown file, listed from the git tree and kept in this
// browser by blob sha, so that only the notes that changed are downloaded again.
import * as github from "./github.js";
import { getConfig, DEV } from "./store.js";
import { parse, blockTexts, findDates, plain, isSourcesHeading } from "./markdown.js";

const CACHE_KEY = "kft.notes";
/** Dev mode reads dev-notes.json; videos and pages come from a second static server on the notes repository. */
const DEV_FILES = "http://127.0.0.1:8766/";

let devNotes = null;
const readDevNotes = () => devNotes || (devNotes = fetch("dev-notes.json", { cache: "no-store" }).then(r => {
  if (!r.ok) throw new Error("Manca dev-notes.json");
  return r.json();
}));
const devTransport = {
  async readTree() { return (await readDevNotes()).tree; },
  async readBlob(cfg, sha) { return (await readDevNotes()).blobs[sha]; },
  async fileUrl(cfg, file) { return DEV_FILES + file.path.split("/").map(encodeURIComponent).join("/"); },
};
const githubTransport = {
  readTree: cfg => github.readTree(cfg),
  readBlob: (cfg, sha) => github.readBlob(cfg, sha),
  async fileUrl(cfg, file) { return URL.createObjectURL(await github.readBlobRaw(cfg, file.sha, mimeType(file.path))); },
};
const transport = DEV ? devTransport : githubTransport;

/** Folders this section leaves out: practice and competitions have their own sections of the site. */
const HIDDEN = ["pratica/", "gare/"];
export const isHidden = path => HIDDEN.some(dir => path.startsWith(dir));

let state = { notes: null, files: [], index: [], order: null, dates: null, status: "idle", error: null, syncedAt: null };
const listeners = new Set();

export const getNotes = () => state;
export function subscribeNotes(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn(state));
}

// ---------- paths and links ----------

/** A link in a note, resolved against the note's folder: { path, hash }. Folders keep their final slash. */
export function resolvePath(from, href) {
  const cut = href.indexOf("#");
  let path = cut === -1 ? href : href.slice(0, cut);
  let hash = cut === -1 ? "" : href.slice(cut + 1);
  try { path = decodeURI(path); } catch { /* keep it as written */ }
  try { hash = decodeURIComponent(hash); } catch { /* keep it as written */ }
  if (!path) return { path: from, hash };
  const parts = path.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const seg of path.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return { path: parts.join("/") + (path.endsWith("/") && parts.length ? "/" : ""), hash };
}

const enc = s => encodeURIComponent(s).replace(/%2F/g, "/");

export const noteHref = (path, slug = "", query = "") =>
  `#/knowledge?p=${enc(path)}${slug ? `&h=${enc(slug)}` : ""}${query ? `&q=${enc(query)}` : ""}`;
export const dirHref = path => `#/knowledge?dir=${enc(path)}`;
export const fileHref = path => `#/knowledge?file=${enc(path)}`;

export function githubUrl(path) {
  const cfg = getConfig();
  const folder = path.endsWith("/");
  return `https://github.com/${cfg.repo}/${folder ? "tree" : "blob"}/${enc(cfg.branch)}/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
}

/** "video", "page", "image" or "other": how a file of the repository can be shown here. */
export function fileKind(path) {
  if (/\.(mp4|m4v|webm|mov)$/i.test(path)) return "video";
  if (/\.html?$/i.test(path)) return "page";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return "image";
  return "other";
}

// pages say UTF-8 here: a page made as a fragment has no charset of its own
const MIME = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", html: "text/html;charset=utf-8", htm: "text/html;charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
export const mimeType = path => MIME[path.split(".").pop().toLowerCase()] || "application/octet-stream";

/** A playable address for a file of the repository (a blob URL: revoke it when done). */
export const fileUrl = file => transport.fileUrl(getConfig(), file);

export const isFolder = path => path.endsWith("/") || state.files.some(f => f.path.startsWith(path + "/"));

// ---------- the index of README.md ----------

/**
 * The "Contenuto" section of README.md: **Group** lines, then "- [Title](path): description"
 * or "- Label: [A](a) · [B](b)" items. Data files and tools are not notes, so they are left out.
 */
function parseIndex(readme, notes) {
  const groups = [];
  let inside = false, group = null;
  const isNote = href => /\.md(#.*)?$/i.test(href) && notes.has(resolvePath(readme.path, href).path);
  for (const line of readme.text.split("\n")) {
    if (/^##\s/.test(line)) { inside = /^##\s+Contenuto\s*$/i.test(line); continue; }
    if (!inside) continue;
    const g = /^\*\*(.+?)\*\*\s*$/.exec(line.trim());
    if (g) {
      group = { name: g[1], items: [] };
      groups.push(group);
      continue;
    }
    if (!group || !/^\s*-\s/.test(line)) continue;
    const body = line.replace(/^\s*-\s+/, "");
    const links = [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)];
    if (!links.length) continue;
    if (body.startsWith("[")) {
      const [whole, title, href] = links[0];
      if (!isNote(href)) continue;
      group.items.push({ notes: [{ title, path: resolvePath(readme.path, href).path }], description: plain(body.slice(whole.length).replace(/^\s*:\s*/, "")) });
    } else {
      const set = links.filter(l => isNote(l[2])).map(([, title, href]) => ({ title, path: resolvePath(readme.path, href).path }));
      if (set.length) group.items.push({ label: body.slice(0, body.indexOf(":")).trim(), notes: set });
    }
  }
  return groups.filter(g => g.items.length);
}

/** Where each date appears: ISO date -> [{ path, slug, heading }], one entry per note section. */
function dateIndex(notes) {
  const index = new Map();
  for (const note of notes.values()) {
    if (note.path === "README.md") continue;
    let section = "", heading = null;
    for (const b of note.blocks) {
      if (b.type === "heading") {
        if (b.level <= 2) section = b.text;
        if (b.level >= 2) heading = b;
        continue;
      }
      if (b.type === "code" || isSourcesHeading(section)) continue;
      for (const src of blockTexts(b)) {
        for (const d of findDates(src)) {
          const list = index.get(d.iso) || [];
          const slug = heading?.slug || "";
          if (!list.some(x => x.path === note.path && x.slug === slug)) list.push({ path: note.path, slug, heading: heading?.text || "" });
          index.set(d.iso, list);
        }
      }
    }
  }
  return index;
}

function build(tree, texts) {
  tree = tree.filter(f => !isHidden(f.path)); // also for a cache saved before a folder was hidden
  const notes = new Map();
  for (const f of tree) {
    if (!/\.md$/i.test(f.path) || typeof texts[f.sha] !== "string") continue;
    const blocks = parse(texts[f.sha]);
    const h1 = blocks.find(b => b.type === "heading" && b.level === 1);
    notes.set(f.path, { path: f.path, sha: f.sha, text: texts[f.sha], blocks, title: h1 ? h1.text : f.path.split("/").pop().replace(/\.md$/i, ""), short: "" });
  }
  const readme = notes.get("README.md");
  const index = readme ? parseIndex(readme, notes) : [];
  for (const group of index) {
    for (const item of group.items) {
      for (const n of item.notes) {
        const note = notes.get(n.path);
        if (!note.short) note.short = n.title;
      }
    }
  }
  const listed = new Set(index.flatMap(g => g.items.flatMap(it => it.notes.map(n => n.path))));
  const others = [...notes.values()].filter(n => n.path !== "README.md" && !listed.has(n.path));
  if (others.length) index.push({ name: "Altre note", items: others.map(n => ({ notes: [{ title: n.title, path: n.path }] })) });
  const order = new Map();
  for (const group of index) for (const item of group.items) for (const n of item.notes) if (!order.has(n.path)) order.set(n.path, order.size);
  return { notes, files: tree, index, order, dates: dateIndex(notes) };
}

/** The notes that mention a day, in the order of the index: [{ path, slug, heading }]. */
export function notesOn(iso) {
  const refs = state.dates?.get(iso) || [];
  const at = path => state.order?.get(path) ?? Infinity;
  return [...refs].sort((a, b) => at(a.path) - at(b.path));
}

// ---------- loading ----------

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; }
  catch { return null; }
}

function writeCache(tree, texts) {
  if (DEV) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ tree, texts, syncedAt: Date.now() })); }
  catch { /* the cache is optional */ }
}

let inflight = null;
/** The tree last built, to skip rebuilding (and redrawing) when nothing changed. */
let treeKey = "";
const keyOf = tree => tree.map(f => `${f.path}:${f.sha}`).join("|");

/** Shows the notes last seen on this device right away, before the network answers. */
export function loadCachedNotes() {
  if (DEV || !getConfig().token) return false;
  const cached = readCache();
  if (!cached?.tree || !cached.texts) return false;
  try {
    set({ ...build(cached.tree, cached.texts), status: "ready", syncedAt: cached.syncedAt });
    treeKey = keyOf(cached.tree);
    return true;
  } catch {
    return false; // a broken cache: the network will fill in
  }
}

async function eachLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Reads the tree and downloads only the notes whose sha is not here yet. */
export function loadNotes() {
  if (inflight) return inflight;
  inflight = (async () => {
    set({ status: "loading", error: null });
    try {
      const cfg = getConfig();
      const tree = (await transport.readTree(cfg)).map(({ path, sha, size }) => ({ path, sha, size })).filter(f => !isHidden(f.path));
      const key = keyOf(tree);
      if (key === treeKey && state.notes) {
        set({ status: "ready", syncedAt: Date.now() });
        return state;
      }
      const cached = readCache()?.texts || {};
      const texts = {};
      await eachLimit(tree.filter(f => /\.md$/i.test(f.path)), 6, async f => {
        texts[f.sha] = typeof cached[f.sha] === "string" ? cached[f.sha] : await transport.readBlob(cfg, f.sha);
      });
      treeKey = key;
      set({ ...build(tree, texts), status: "ready", syncedAt: Date.now() });
      writeCache(tree, texts);
      return state;
    } catch (error) {
      set({ status: "error", error });
      throw error;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forgets the notes on this device (when the token is removed). */
export function forgetNotes() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ }
  treeKey = "";
  set({ notes: null, files: [], index: [], order: null, dates: null, status: "idle", error: null, syncedAt: null });
}

// ---------- search ----------

/** Lower case and without accents, with the place of each character in the original text. */
function fold(text) {
  let norm = "";
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const n = text[i].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < n.length; k++) {
      norm += n[k];
      map.push(i);
    }
  }
  map.push(text.length);
  return { norm, map };
}

/** The words to look for: two letters at least, or a Chinese character. */
export const searchTerms = query => fold(query).norm.split(/\s+/).filter(t => t.length >= 2 || /\p{Script=Han}/u.test(t));

/** Where the terms are in `text`, as merged [from, to) ranges of the original text. */
export function hitRanges(text, terms) {
  const { norm, map } = fold(text);
  const ranges = [];
  for (const t of terms) {
    for (let at = norm.indexOf(t); at !== -1; at = norm.indexOf(t, at + t.length)) ranges.push([map[at], map[at + t.length - 1] + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  return merged;
}

const rowText = src => src.split("|").map(cell => plain(cell).trim()).filter(Boolean).join(" · ");

/** The searchable pieces of a note: headings, paragraphs, list items, table rows, each with its section. */
function units(note) {
  if (note.units) return note.units;
  const out = [];
  let heading = null;
  for (const b of note.blocks) {
    if (b.type === "heading") {
      if (b.level === 1) continue;
      heading = b;
      out.push({ text: b.text, slug: b.slug, heading: b.text, isHeading: true });
      continue;
    }
    for (const src of blockTexts(b)) {
      const text = (b.type === "table" ? rowText(src) : b.type === "code" ? src : plain(src)).replace(/\s+/g, " ").trim();
      if (text) out.push({ text, slug: heading?.slug || "", heading: heading?.text || "" });
    }
  }
  for (const u of out) u.norm = fold(u.text).norm;
  note.units = out;
  return out;
}

function findAll(terms) {
  const results = [];
  for (const note of state.notes.values()) {
    if (note.path === "README.md") continue;
    const hits = units(note).filter(u => terms.every(t => u.norm.includes(t)));
    const title = fold(`${note.title} ${note.short}`).norm;
    const inTitle = terms.every(t => title.includes(t));
    if (hits.length || inTitle) results.push({ note, hits, score: (inTitle ? 1000 : 0) + hits.length });
  }
  return results.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title, "it"));
}

/**
 * Notes with the words of the query, title matches first: { terms, results: [{ note, hits }] },
 * or null for a too short query. Words written together ("pi quan") are looked for together first,
 * so that "quan" doesn't also find every "quando".
 */
export function searchNotes(query) {
  const words = searchTerms(query);
  if (!words.length || !state.notes) return null;
  if (words.length > 1) {
    const phrase = [words.join(" ")];
    const results = findAll(phrase);
    if (results.length) return { terms: phrase, results };
  }
  return { terms: words, results: findAll(words) };
}

/** What to mark in a note opened from a search: the phrase if the note has it, else each word. */
export function termsIn(note, query) {
  const words = searchTerms(query);
  const phrase = words.join(" ");
  return words.length > 1 && units(note).some(u => u.norm.includes(phrase)) ? [phrase] : words;
}
