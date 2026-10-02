// A small Markdown renderer for the notes: the subset they use (headings, paragraphs, nested lists,
// tables, code blocks, quotes, links, bold, italics, inline code). Everything else is shown as text.
import { esc, pad } from "./format.js";

/** GitHub's heading ids: lower case, punctuation and symbols dropped, spaces to dashes; repeats get -1, -2. */
export function slugify(text, seen) {
  let slug = text.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
  if (seen) {
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    if (n) slug += `-${n}`;
  }
  return slug;
}

/** Inline Markdown as plain text: links keep their text, formatting marks go. */
export function plain(src) {
  return src
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\s][^*]*)\*/g, "$1");
}

/**
 * Dates written as 13/11/2025, or as 13/11 when the year is in the same text: the next full date
 * ("il 18/09 e il 13/11/2025"), else the last one before, else a season ("2025/26": September to
 * December in 2025, the rest in 2026), else a year written out ("luglio 2025").
 * Returns where each date is in `src` and its ISO form.
 */
export function findDates(src) {
  const found = [];
  const re = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src[m.index - 1] || "", after = src[m.index + m[0].length] || "";
    if (/[\d/]/.test(before) || /[\d/]/.test(after)) continue; // 2025/26, 3/4/5 and the like
    found.push({ index: m.index, length: m[0].length, d: Number(m[1]), m: Number(m[2]), y: m[3] ? Number(m[3]) : 0, full: Boolean(m[3]) });
  }
  if (!found.length) return found;
  const full = found.filter(f => f.full);
  const season = /(?:^|[^\d/])((?:19|20)\d\d)\/\d\d(?![\d/])/.exec(src);
  const written = /(?:^|[^\d/])((?:19|20)\d\d)(?![\d/])/.exec(src);
  for (const f of found) {
    if (f.full) continue;
    let year = full.find(x => x.index > f.index)?.y;
    if (!year) for (const x of full) if (x.index < f.index) year = x.y;
    if (!year && season) year = Number(season[1]) + (f.m >= 9 ? 0 : 1);
    f.y = year || (written ? Number(written[1]) : 0);
  }
  return found.flatMap(f => {
    const date = new Date(f.y, f.m - 1, f.d);
    if (!f.y || date.getMonth() !== f.m - 1 || date.getDate() !== f.d) return [];
    return [{ index: f.index, length: f.length, iso: `${f.y}-${pad(f.m)}-${pad(f.d)}` }];
  });
}

// ---------- blocks ----------

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;

const isTable = (lines, i) => lines[i].trimStart().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]);
const startsBlock = (lines, i) =>
  FENCE.test(lines[i]) || HEADING.test(lines[i]) || HR.test(lines[i]) || LIST_ITEM.test(lines[i]) || lines[i].startsWith(">") || isTable(lines, i);

/** A table row with the place of each cell in it, so that a date in one cell can take the year from another. */
function splitRow(line) {
  const cells = [];
  let start = line.indexOf("|") + 1;
  for (let j = start; j <= line.length; j++) {
    if (j < line.length && line[j] !== "|") continue;
    if (j === line.length && !line.slice(start).trim()) break; // the closing pipe
    let a = start, b = j;
    while (a < b && line[a] === " ") a++;
    while (b > a && line[b - 1] === " ") b--;
    cells.push([a, b]);
    start = j + 1;
  }
  return { src: line, cells };
}

function parseList(lines, i) {
  const first = LIST_ITEM.exec(lines[i]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const list = { type: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // a blank line ends the list, unless the next item belongs to it
      const next = i + 1 < lines.length ? LIST_ITEM.exec(lines[i + 1]) : null;
      if (next && next[1].length >= indent) { i++; continue; }
      break;
    }
    const m = LIST_ITEM.exec(line);
    const depth = line.length - line.trimStart().length;
    if (m && m[1].length === indent) {
      list.items.push({ src: m[3], children: [] });
      i++;
    } else if (m && m[1].length > indent && list.items.length) {
      const [child, next] = parseList(lines, i);
      list.items[list.items.length - 1].children.push(child);
      i = next;
    } else if (!m && depth > indent && list.items.length) {
      list.items[list.items.length - 1].src += "\n" + line.trim();
      i++;
    } else break;
  }
  return [list, i];
}

/** Markdown to blocks. Headings get their GitHub id, numbered in document order. */
export function parse(md, seen = new Map()) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (FENCE.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const text = plain(h[2]);
      blocks.push({ type: "heading", level: h[1].length, src: h[2], text, slug: slugify(text, seen) });
      i++;
      continue;
    }
    if (HR.test(line)) { blocks.push({ type: "hr" }); i++; continue; }
    if (isTable(lines, i)) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(splitRow(lines[i++]));
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (line.startsWith(">")) {
      const inner = [];
      while (i < lines.length && lines[i].startsWith(">")) inner.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", blocks: parse(inner.join("\n"), seen) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++].trim());
    blocks.push({ type: "p", src: para.join("\n") });
  }
  return blocks;
}

/** The text of a block, one piece per paragraph, list item or table row: what dates and searches look at. */
export function blockTexts(block) {
  switch (block.type) {
    case "p": return [block.src];
    case "heading": return [block.src];
    case "code": return block.text.split("\n");
    case "table": return block.rows.map(r => r.src);
    case "quote": return block.blocks.flatMap(blockTexts);
    case "list": return block.items.flatMap(it => [it.src, ...it.children.flatMap(blockTexts)]);
    default: return [];
  }
}

// ---------- inline ----------

const SAFE_URL = /^(https?:|mailto:|#|\.{0,2}\/|[^:]*$)/i;

function matchLink(src, i, to) {
  let depth = 0, j = i;
  for (; j < to; j++) {
    if (src[j] === "[") depth++;
    else if (src[j] === "]" && --depth === 0) break;
  }
  if (j >= to || src[j + 1] !== "(") return null;
  let k = j + 2, paren = 1;
  for (; k < to; k++) {
    if (src[k] === "(") paren++;
    else if (src[k] === ")" && --paren === 0) break;
  }
  if (k >= to) return null;
  return { from: i + 1, to: j, href: src.slice(j + 2, k).trim(), end: k + 1 };
}

function closingStar(src, from, to) {
  for (let j = from; j < to; j++) {
    if (src[j] === "`") {
      const k = src.indexOf("`", j + 1);
      if (k !== -1 && k < to) { j = k; continue; }
    }
    if (src[j] !== "*") continue;
    if (src[j + 1] === "*") { j++; continue; }
    if (src[j - 1] !== " ") return j;
  }
  return -1;
}

function text(src, from, to, ctx, inLink) {
  let out = "", at = from;
  if (!inLink) {
    for (const d of ctx.found) {
      if (d.index < at || d.index + d.length > to) continue;
      out += esc(src.slice(at, d.index)) + `<a class="md-date" href="${esc(d.href)}">${esc(src.slice(d.index, d.index + d.length))}</a>`;
      at = d.index + d.length;
    }
  }
  return out + esc(src.slice(at, to));
}

function inline(src, from, to, ctx, inLink) {
  let out = "", i = from, start = from;
  const flush = end => { if (end > start) out += text(src, start, end, ctx, inLink); };
  while (i < to) {
    const c = src[i];
    if (c === "`") {
      const j = src.indexOf("`", i + 1);
      if (j !== -1 && j < to) {
        flush(i);
        out += `<code>${esc(src.slice(i + 1, j))}</code>`;
        i = start = j + 1;
        continue;
      }
    } else if (c === "[" && !inLink) {
      const m = matchLink(src, i, to);
      if (m) {
        flush(i);
        const label = inline(src, m.from, m.to, ctx, true);
        const target = SAFE_URL.test(m.href) ? (ctx.link ? ctx.link(m.href) : { href: m.href, external: /^https?:/i.test(m.href) }) : null;
        out += target
          ? `<a href="${esc(target.href)}"${target.cls ? ` class="${target.cls}"` : ""}${target.external ? ' target="_blank" rel="noopener"' : ""}>${target.before || ""}${label}</a>`
          : label;
        i = start = m.end;
        continue;
      }
    } else if (c === "*" && src[i + 1] === "*") {
      const j = src.indexOf("**", i + 2);
      if (j > i + 2 && j < to) {
        flush(i);
        out += `<strong>${inline(src, i + 2, j, ctx, inLink)}</strong>`;
        i = start = j + 2;
        continue;
      }
    } else if (c === "*" && src[i + 1] && src[i + 1] !== " ") {
      const j = closingStar(src, i + 1, to);
      if (j !== -1) {
        flush(i);
        out += `<em>${inline(src, i + 1, j, ctx, inLink)}</em>`;
        i = start = j + 1;
        continue;
      }
    }
    i++;
  }
  flush(to);
  return out;
}

/** The dates of `src` that have somewhere to go (a lesson or a competition that day). */
function linkable(src, ctx) {
  if (!ctx.dateHref) return [];
  return findDates(src).flatMap(d => {
    const href = ctx.dateHref(d.iso);
    return href ? [{ ...d, href }] : [];
  });
}

/** One line of inline Markdown as HTML. */
export function renderInline(src, ctx = {}) {
  return inline(src, 0, src.length, { ...ctx, found: linkable(src, ctx) }, false);
}

// ---------- blocks to HTML ----------

const SOURCES = /^fonti?$/i;

function list(block, ctx) {
  const tag = block.ordered ? "ol" : "ul";
  const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
  const items = block.items.map(it => `<li>${renderInline(it.src, ctx)}${it.children.map(ch => list(ch, ctx)).join("")}</li>`);
  return `<${tag}${start}>${items.join("")}</${tag}>`;
}

/**
 * A table in a box that scrolls sideways when needed. Many columns ("wide": numbers, medals) keep each
 * cell on one line; four or more columns with long text ("stack") become one card per row on a phone.
 */
function table(block, ctx) {
  const labels = block.head.cells.map(([a, b]) => plain(block.head.src.slice(a, b)));
  const longest = Math.max(0, ...block.rows.flatMap(r => r.cells.map(([a, b]) => plain(r.src.slice(a, b)).length)));
  const shape = labels.length >= 5 ? " wide" : labels.length === 4 && longest > 40 ? " stack" : "";
  const row = (r, tag) => {
    const c = { ...ctx, found: linkable(r.src, ctx) };
    return `<tr>${r.cells.map(([a, b], i) => `<${tag}${tag === "td" && labels[i] ? ` data-label="${esc(labels[i])}"` : ""}>${inline(r.src, a, b, c, false)}</${tag}>`).join("")}</tr>`;
  };
  return `<div class="md-table${shape}"><table><thead>${row(block.head, "th")}</thead><tbody>${block.rows.map(r => row(r, "td")).join("")}</tbody></table></div>`;
}

/**
 * Blocks to HTML. `ctx.link(href)` turns a link into { href, cls, external, before };
 * `ctx.dateHref(iso)` gives the place a date links to, or null. Dates under a "Fonte" heading
 * are the day a web page was checked, not a lesson, so they stay plain.
 */
export function render(blocks, ctx = {}) {
  let html = "", section = "";
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2) section = b.text;
    const c = SOURCES.test(section) ? { ...ctx, dateHref: null } : ctx;
    switch (b.type) {
      case "heading": html += `<h${b.level} id="${esc(b.slug)}">${renderInline(b.src, c)}</h${b.level}>`; break;
      case "p": html += `<p>${renderInline(b.src, c)}</p>`; break;
      case "code": html += `<pre class="md-pre"><code>${esc(b.text)}</code></pre>`; break;
      case "hr": html += "<hr>"; break;
      case "quote": html += `<blockquote>${render(b.blocks, c)}</blockquote>`; break;
      case "list": html += list(b, c); break;
      case "table": html += table(b, c); break;
    }
  }
  return html;
}

export const isSourcesHeading = text => SOURCES.test(text);
