import { getState as getData, subscribe as subscribeData, errorMessage } from "../store.js";
import {
  getNotes, subscribeNotes, loadNotes, searchNotes, termsIn, hitRanges, resolvePath, isFolder, isHidden,
  noteHref, dirHref, fileHref, githubUrl, fileKind, fileUrl,
} from "../notes.js";
import { render } from "../markdown.js";
import { icon } from "../icons.js";
import { esc, fmtNum, plural } from "../format.js";
import { toast } from "../ui.js";
import { navigate } from "../router.js";

/** A brush glyph for each top folder of the notes. */
const GLYPHS = { scuola: "校", pratica: "练", conoscenza: "知", gare: "赛" };
const KINDS = {
  video: { label: "Video", icon: "play", action: "Guarda il video" },
  page: { label: "Pagina", icon: "box", action: "Apri la pagina" },
  image: { label: "Immagine", icon: "file", action: "Mostra l'immagine" },
  other: { label: "File", icon: "file", action: "" },
};

const topFolder = path => (path.includes("/") ? path.split("/")[0] : "");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
/** "Conoscenza · Forme" for conoscenza/forme/taiji-chen-1.md */
const crumbs = path => path.split("/").slice(0, -1).filter(Boolean).map(cap).join(" · ");
const fmtSize = bytes => (bytes >= 1e6 ? `${fmtNum(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

// back goes back in history only after a move inside the app; a page opened from outside goes to the index
let movedInApp = false;
addEventListener("hashchange", () => { movedInApp = true; });

/** The days with a lesson or a competition, by data object. */
const trainingDays = new WeakMap();
function hasTraining(data, iso) {
  if (!data) return false;
  if (!trainingDays.has(data)) trainingDays.set(data, new Set([...data.sessions, ...data.competitions].map(x => x.date)));
  return trainingDays.get(data).has(iso);
}

export function renderKnowledge(root, params) {
  const route = { path: params.get("p"), slug: params.get("h") || "", query: params.get("q") || "", dir: params.get("dir"), file: params.get("file") };
  const mode = route.path ? "note" : route.dir ? "dir" : route.file ? "file" : "home";
  let shown = null; // the notes (and data, for a note) drawn last
  let animate = true;
  let blobUrl = null;
  let searchTimer = 0;

  function draw() {
    const { notes, status, error } = getNotes();
    const data = getData().data;
    if (!notes) {
      shown = null;
      root.innerHTML = status === "error" ? errorView(error) : skeleton();
      return;
    }
    if (shown && shown.notes === notes && (mode !== "note" || shown.data === data)) return;
    const first = !shown;
    shown = { notes, data };
    if (mode === "home") drawHome();
    else if (mode === "note") drawNote(first);
    else if (mode === "dir") drawDir();
    else drawFile();
    animate = false;
  }

  const viewClass = extra => `${animate ? "view " : ""}${extra}`;

  /** The back button, the folders above the page, and the brush glyph of its top folder. */
  function head(path, glyph = GLYPHS[topFolder(path)]) {
    return `<div class="note-head">
      <a class="icon-btn" href="#/knowledge" data-back aria-label="Indietro">${icon("left")}</a>
      <p class="eyebrow">${esc(crumbs(path) || "Conoscenza")}</p>
      ${glyph ? `<span class="cn" aria-hidden="true">${glyph}</span>` : ""}
    </div>`;
  }

  // ---------- index and search ----------

  function drawHome() {
    if (!root.querySelector(".k-home")) {
      root.innerHTML = `
        <section class="${viewClass("k-home")}">
          <div class="view-title">
            <span class="cn" aria-hidden="true">知</span>
            <p class="eyebrow">Note e appunti</p>
            <h1>Conoscenza</h1>
          </div>
          <label class="search">
            ${icon("search")}
            <span class="sr-only">Cerca nelle note</span>
            <input class="input" type="search" placeholder="Cerca nelle note" autocomplete="off" spellcheck="false" enterkeyhint="search" value="${esc(route.query)}">
            <button class="icon-btn small" type="button" data-clear aria-label="Cancella la ricerca"${route.query ? "" : " hidden"}>${icon("x")}</button>
          </label>
          <div class="k-body"></div>
        </section>`;
    }
    fillHome();
  }

  function fillHome() {
    const q = route.query.trim();
    root.querySelector(".k-body").innerHTML = q ? results(q) : indexList();
  }

  const noteRow = (title, path, description = "") => `<li><a class="note-row" href="${noteHref(path)}">
      <span class="nr-main"><b>${esc(title)}</b>${description ? `<small>${esc(description)}</small>` : ""}</span>
      ${icon("right", "g-chev")}
    </a></li>`;

  function indexList() {
    const { index } = getNotes();
    if (!index.length) return `<div class="card empty"><span class="cn" aria-hidden="true">空</span>Ancora nessuna nota</div>`;
    return index.map(group => {
      const count = group.items.reduce((n, it) => n + it.notes.length, 0);
      const glyph = GLYPHS[topFolder(group.items[0].notes[0].path)];
      const rows = group.items.map(item => item.label
        ? `<li class="note-set"><p class="field-label">${esc(item.label)}</p><ul>${item.notes.map(n => noteRow(n.title, n.path)).join("")}</ul></li>`
        : noteRow(item.notes[0].title, item.notes[0].path, item.description)).join("");
      return `
        <div class="section-title"><h2>${esc(group.name)}</h2><span>${plural(count, "nota", "note")}</span></div>
        <div class="card note-card">
          ${glyph ? `<span class="watermark" aria-hidden="true">${glyph}</span>` : ""}
          <ul class="note-list">${rows}</ul>
        </div>`;
    }).join("");
  }

  function marked(text, terms, from = 0, to = text.length) {
    let out = "", at = from;
    for (const [a, b] of hitRanges(text, terms)) {
      if (a < from || b > to) continue;
      out += `${esc(text.slice(at, a))}<mark>${esc(text.slice(a, b))}</mark>`;
      at = b;
    }
    return out + esc(text.slice(at, to));
  }

  /** The line around the first match, cut at a word. */
  function snippet(text, terms) {
    if (text.length <= 170) return marked(text, terms);
    const hit = hitRanges(text, terms)[0] || [0, 0];
    let from = Math.max(0, hit[0] - 50);
    if (from > 0) {
      const space = text.indexOf(" ", from);
      if (space !== -1 && space < hit[0]) from = space + 1;
    }
    const to = Math.min(text.length, from + 170);
    return `${from > 0 ? "…" : ""}${marked(text, terms, from, to)}${to < text.length ? "…" : ""}`;
  }

  function results(q) {
    const found = searchNotes(q);
    if (!found) return `<p class="k-hint">Scrivi almeno due lettere.</p>`;
    if (!found.results.length) return `<div class="card empty"><span class="cn" aria-hidden="true">空</span>Nessuna nota parla di “${esc(q)}”</div>`;
    const { terms } = found;
    return `
      <div class="section-title"><h2>Risultati</h2><span>${plural(found.results.length, "nota", "note")}</span></div>
      <ul class="hits">${found.results.map(({ note, hits: all }) => {
        // a heading that matches says nothing more than the matching lines under it
        const hits = all.filter(h => !h.isHeading || !all.some(o => !o.isHeading && o.slug === h.slug));
        return `
        <li class="card hit">
          <a class="hit-title" href="${noteHref(note.path, "", q)}">
            <b>${marked(note.short || note.title, terms)}</b>
            <small>${esc(crumbs(note.path))}</small>
          </a>
          ${hits.slice(0, 3).map(h => `<a class="hit-line" href="${noteHref(note.path, h.slug, q)}">
            ${h.heading && !h.isHeading ? `<small>${esc(h.heading)}</small>` : ""}
            <span>${snippet(h.text, terms)}</span>
          </a>`).join("")}
          ${hits.length > 3 ? `<a class="hit-more" href="${noteHref(note.path, "", q)}">E ${plural(hits.length - 3, "altro punto", "altri punti")} nella nota ${icon("right")}</a>` : ""}
        </li>`;
      }).join("")}
      </ul>`;
  }

  // ---------- a note ----------

  /**
   * Links between notes stay in the app; videos and pages open in the file view; the rest goes to the web.
   * A link into a hidden folder (practice, competitions) stays as plain text.
   */
  function linkFor(from, href) {
    if (/^(https?:|mailto:)/i.test(href)) return { href, external: true };
    const { path, hash } = resolvePath(from, href);
    if (isHidden(path)) return null;
    if (/\.md$/i.test(path)) return { href: noteHref(path, hash) };
    if (isFolder(path)) return { href: dirHref(path.endsWith("/") ? path : `${path}/`), cls: "md-dir", before: icon("folder", "md-ico") };
    const kind = fileKind(path);
    return { href: fileHref(path), cls: "md-file", before: icon(KINDS[kind].icon, "md-ico") };
  }

  /** A date links to the calendar when there was a lesson or a competition that day. */
  const dateHref = iso => (hasTraining(getData().data, iso) ? `#/calendar?d=${iso}&open=1` : null);

  function drawNote(first) {
    const note = getNotes().notes.get(route.path);
    if (!note) {
      root.innerHTML = missing(route.path, "Non trovo questa nota: forse è stata spostata o rinominata.");
      return;
    }
    const firstH1 = note.blocks.findIndex(b => b.type === "heading" && b.level === 1);
    const blocks = note.blocks.filter((b, i) => i !== firstH1);
    const sections = blocks.filter(b => b.type === "heading" && b.level === 2);
    const y = window.scrollY;
    root.innerHTML = `
      <section class="${viewClass("note")}">
        ${head(note.path)}
        <h1 class="note-title">${esc(note.title)}</h1>
        ${sections.length >= 3 ? `<nav class="toc" aria-label="Sezioni della nota">${sections.map(h => `<a href="${noteHref(note.path, h.slug)}">${esc(h.text)}</a>`).join("")}</nav>` : ""}
        <article class="md">${render(blocks, { link: href => linkFor(note.path, href), dateHref })}</article>
        ${legend(note.text)}
        <p class="note-foot"><span>${esc(note.path)}</span><a href="${githubUrl(note.path)}" target="_blank" rel="noopener">${icon("external")} Apri su GitHub</a></p>
      </section>`;
    const terms = route.query ? termsIn(note, route.query) : [];
    if (terms.length) highlight(root.querySelector(".md"), terms);
    if (first) jump();
    else window.scrollTo(0, y);
  }

  function legend(text) {
    const warn = text.includes("⚠"), general = text.includes("📖");
    if (!warn && !general) return "";
    return `<div class="note-legend">
      ${warn ? "<span>⚠️ da verificare</span>" : ""}
      ${general ? "<span>📖 conoscenza generale, non dalla scuola: da confermare con il maestro</span>" : ""}
    </div>`;
  }

  /** Marks the search terms in the note, inside each piece of text. */
  function highlight(el, terms) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      const ranges = hitRanges(text, terms);
      if (!ranges.length) continue;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (const [a, b] of ranges) {
        const mark = document.createElement("mark");
        mark.textContent = text.slice(a, b);
        frag.append(text.slice(at, a), mark);
        at = b;
      }
      frag.append(text.slice(at));
      node.replaceWith(frag);
    }
  }

  /** Scrolls to the section asked for, or to the first match of the search in it. */
  function jump(smooth = false) {
    let target = route.slug ? document.getElementById(route.slug) : null;
    const marks = [...root.querySelectorAll(".md mark")];
    if (marks.length) {
      const next = target ? marks.find(m => target.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) : marks[0];
      if (next) target = next;
    }
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: target.tagName === "MARK" ? "center" : "start", behavior: smooth ? "smooth" : "auto" });
      target.classList.remove("flash");
      void target.offsetWidth;
      target.classList.add("flash");
    });
  }

  // ---------- a folder ----------

  function drawDir() {
    const { notes, files } = getNotes();
    const prefix = route.dir.endsWith("/") ? route.dir : `${route.dir}/`;
    const inside = [...notes.values()].filter(n => n.path.startsWith(prefix)).sort((a, b) => (a.short || a.title).localeCompare(b.short || b.title, "it"));
    const other = files.filter(f => f.path.startsWith(prefix) && !/\.md$/i.test(f.path));
    const name = cap(prefix.split("/").filter(Boolean).pop() || "Note");
    root.innerHTML = `
      <section class="${viewClass("note")}">
        ${head(prefix.slice(0, -1))}
        <h1 class="note-title">${esc(name)}</h1>
        ${inside.length ? `<div class="card note-card"><ul class="note-list">${inside.map(n => noteRow(n.short || n.title, n.path)).join("")}</ul></div>` : ""}
        ${other.length ? `
          <div class="section-title"><h2>File</h2><span>${plural(other.length, "file", "file")}</span></div>
          <div class="card note-card"><ul class="note-list">${other.map(f => `<li><a class="note-row" href="${fileHref(f.path)}">
            <span class="nr-main"><b>${esc(f.path.slice(prefix.length))}</b><small>${KINDS[fileKind(f.path)].label} · ${fmtSize(f.size)}</small></span>
            ${icon("right", "g-chev")}
          </a></li>`).join("")}</ul></div>` : ""}
        ${inside.length || other.length ? "" : `<div class="card empty"><span class="cn" aria-hidden="true">空</span>Questa cartella è vuota</div>`}
      </section>`;
  }

  // ---------- a video or a page ----------

  function drawFile() {
    if (root.querySelector(".k-file")) return; // a later sync must not drop a video already loaded
    const file = getNotes().files.find(f => f.path === route.file);
    const kind = KINDS[fileKind(route.file)];
    root.innerHTML = `
      <section class="${viewClass("note k-file")}">
        ${head(route.file)}
        <h1 class="note-title">${esc(route.file.split("/").pop())}</h1>
        ${!file ? `<div class="notice">Non trovo questo file nel repository.</div>`
          : !kind.action ? `<p class="k-hint">Questo file non si apre qui: puoi vederlo su GitHub.</p>`
          : `<div class="card media-card">
              <p class="media-meta">${icon(kind.icon)} ${kind.label} · ${fmtSize(file.size)}</p>
              <button class="btn btn-ghost" data-load>${icon(kind.icon)} ${kind.action}</button>
              <div class="media"></div>
            </div>`}
        <p class="note-foot"><span>${esc(route.file)}</span><a href="${githubUrl(route.file)}" target="_blank" rel="noopener">${icon("external")} Apri su GitHub</a></p>
      </section>`;
  }

  async function loadMedia(button) {
    const file = getNotes().files.find(f => f.path === route.file);
    if (!file) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> Scarico ${fmtSize(file.size)}…`;
    try {
      const url = await fileUrl(file);
      if (url.startsWith("blob:")) blobUrl = url;
      const kind = fileKind(file.path);
      const name = esc(file.path.split("/").pop());
      root.querySelector(".media").innerHTML = kind === "video"
        ? `<video controls playsinline preload="metadata" src="${esc(url)}"></video>`
        : kind === "image"
          ? `<img src="${esc(url)}" alt="${name}">`
          : `<iframe sandbox="allow-scripts" src="${esc(url)}" title="${name}"></iframe>`;
      button.remove();
    } catch (err) {
      toast(errorMessage(err), "error");
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  // ---------- states ----------

  function missing(path, message) {
    return `<section class="view note">${head(path)}<div class="notice">${esc(message)}</div></section>`;
  }

  function errorView(error) {
    return `<section class="view"><div class="notice">Non riesco a leggere le note. ${esc(errorMessage(error))}<button class="btn btn-ghost" data-retry>${icon("refresh")} Riprova</button></div></section>`;
  }

  function skeleton() {
    return `<section class="view">
      <div class="skeleton" style="height:64px;margin:10px 0 22px"></div>
      <div class="skeleton" style="height:54px;margin-bottom:30px"></div>
      ${'<div class="skeleton" style="height:210px;margin-bottom:16px"></div>'.repeat(2)}
    </section>`;
  }

  // ---------- events ----------

  root.addEventListener("input", e => {
    if (!e.target.matches(".search input")) return;
    route.query = e.target.value;
    root.querySelector("[data-clear]").hidden = !route.query;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = route.query.trim();
      history.replaceState(null, "", q ? `#/knowledge?q=${encodeURIComponent(q)}` : "#/knowledge");
      fillHome();
    }, 120);
  });

  root.addEventListener("click", e => {
    if (e.target.closest("[data-retry]")) {
      loadNotes().catch(err => toast(errorMessage(err), "error"));
      return;
    }
    if (e.target.closest("[data-clear]")) {
      const input = root.querySelector(".search input");
      input.value = route.query = "";
      e.target.closest("[data-clear]").hidden = true;
      history.replaceState(null, "", "#/knowledge");
      fillHome();
      input.focus();
      return;
    }
    const load = e.target.closest("[data-load]");
    if (load) return loadMedia(load);
    const link = e.target.closest("a");
    if (!link) return;
    if (link.hasAttribute("data-back")) {
      e.preventDefault();
      if (movedInApp && history.length > 1) history.back();
      else navigate("#/knowledge");
      return;
    }
    // a section of the note already open: scroll there instead of opening it again
    const href = link.getAttribute("href") || "";
    if (mode === "note" && href.startsWith("#/knowledge?")) {
      const p = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      if (p.get("p") === route.path && !p.get("q")) {
        e.preventDefault();
        route.slug = p.get("h") || "";
        history.replaceState(null, "", noteHref(route.path, route.slug, route.query));
        if (route.slug) jump(true);
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  });

  const offNotes = subscribeNotes(draw);
  const offData = subscribeData(() => { if (mode === "note") draw(); });
  draw();
  // the notes on this device show at once; then the tree is checked again, at most once a minute
  const { status, syncedAt } = getNotes();
  if (status !== "loading" && (!syncedAt || Date.now() - syncedAt > 60000)) loadNotes().catch(() => {});

  return () => {
    offNotes();
    offData();
    clearTimeout(searchTimer);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  };
}
