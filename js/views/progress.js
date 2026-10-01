import { getState, subscribe, load, errorMessage } from "../store.js";
import { TYPE_KEYS, typeOf, LEVELS } from "../types.js";
import { MONTHS, MONTHS_SHORT, today, daysBetween, weekStart, fmtNum, fmtShortDate, fmtSpan, fmtWeek, whenLabel, plural, esc } from "../format.js";
import { icon } from "../icons.js";
import { toast, showTip, hideTip, typeBar } from "../ui.js";
import {
  SEASON_MONTHS, seasons, seasonWeeks, monthMinutes, streakRuns, longestRun, currentRun,
  lastSeasonSoFar, lastTwoFull, biggestChange, milestones, pastGoals,
} from "../progress-stats.js";

// A weekly row starts one week before 1 September (a season's first week can begin in August) and spans a year.
const PAD = 7;
const SPAN = PAD + 366;
/** Days from 1 September to the first of each month, in season order. */
const MONTH_DAYS = [0, 30, 61, 91, 122, 153, 181, 212, 242, 273, 303, 334];

const at = days => `${(((days + PAD) / SPAN) * 100).toFixed(3)}%`;
const hours = minutes => fmtNum(minutes / 60);
const q = id => encodeURIComponent(id);

export function renderProgress(root, params) {
  let drawnData;
  let animate = true;
  let flash = params.get("goal");
  let rows = new Map(); // season year -> { season, weeks, marks }
  let picked = null; // the week shown in the label: { plot, i, el }

  function draw() {
    const { data, status, error } = getState();
    drawnData = data;
    if (picked) unpick();
    if (!data) {
      root.innerHTML = status === "error"
        ? `<section class="view"><div class="notice">${esc(errorMessage(error))}<button class="btn btn-ghost" data-retry>${icon("refresh")} Riprova</button></div></section>`
        : skeleton();
      return;
    }
    const now = today();
    const list = seasons(data.sessions, now);
    rows = new Map(list.map(s => [String(s.year), { season: s, weeks: seasonWeeks(s, now), marks: marksIn(s, data) }]));
    root.innerHTML = `
      <section class="${animate ? "view " : ""}progress">
        <div class="view-title">
          <span class="cn" aria-hidden="true">进</span>
          <p class="eyebrow">Progressi e traguardi</p>
          <h1>Grafici</h1>
        </div>
        ${list.length ? seasonHero(list[0], data.sessions, now) : ""}
        ${goalsSection(data, now)}
        ${list.length
          ? weeksSection(list, data.sessions, now) + seasonsSection(list)
          : `<div class="card empty"><span class="cn" aria-hidden="true">空</span>Ancora nessuna sessione da mettere in grafico</div>`}
      </section>`;
    animate = false;
    if (flash) {
      root.querySelector(`[data-goal="${CSS.escape(flash)}"]`)?.classList.add("flash");
      flash = null;
    }
  }

  /** Competitions and goals that fall in a season's weekly row. */
  function marksIn(season, data) {
    const inside = date => date >= weekStart(season.from) && date <= season.to;
    return [
      ...data.competitions.filter(c => inside(c.date)).map(item => ({ kind: "competition", item })),
      ...data.goals.filter(g => inside(g.date)).map(item => ({ kind: "goal", item })),
    ];
  }

  // ---------- this season ----------

  function seasonHero(s, sessions, now) {
    const before = lastSeasonSoFar(sessions, now);
    return `<article class="season-hero">
      <span class="watermark" aria-hidden="true">季</span>
      <p class="eyebrow">Stagione ${s.label} · in corso</p>
      <div class="hero-figure"><b>${hours(s.minutes)}</b><span>${s.minutes === 60 ? "ora" : "ore"}</span></div>
      <p class="hero-sub">${s.count ? `${plural(s.count, "sessione", "sessioni")} in ${plural(s.weeks.size, "settimana", "settimane")}, dal 1° settembre` : "Ancora nessuna sessione dal 1° settembre"}</p>
      ${s.count ? typeBar(s.byType) : ""}
      ${before ? `<p class="hero-compare">${icon("clock")}<span>Un anno fa, alla stessa data: ${before.count ? `${hours(before.minutes)} ore in ${plural(before.count, "sessione", "sessioni")}` : "nessuna sessione"}.</span></p>` : ""}
    </article>`;
  }

  // ---------- goals ----------

  function goalsSection(data, now) {
    const ahead = milestones(data, now);
    const past = pastGoals(data.goals, now);
    return `
      <div class="section-title"><h2>Traguardi</h2><span>${ahead.length ? `${ahead.length} in vista` : ""}</span></div>
      ${ahead.length
        ? `<ol class="goal-list">${ahead.map(m => goalRow(m, now)).join("")}</ol>`
        : `<div class="card empty"><span class="cn" aria-hidden="true">空</span>Nessun traguardo in vista</div>`}
      <a class="btn btn-ghost add-goal" href="#/goal-edit">${icon("plus")} Aggiungi un traguardo</a>
      ${past.length ? `<p class="field-label past-label">Traguardi passati</p><ul class="goal-past">${past.map(pastRow).join("")}</ul>` : ""}`;
  }

  function goalRow({ kind, item }, now) {
    const days = daysBetween(now, item.date);
    const comp = kind === "competition";
    const href = comp ? `#/competitions?open=${q(item.id)}` : `#/goal-edit?id=${q(item.id)}`;
    return `<li><a class="goal-row ${kind}" href="${href}" data-goal="${esc(item.id)}">
      <span class="g-days">${days === 0 ? "<b>Oggi</b>" : `<b>${item.dateTbc ? `<i class="approx">~</i>` : ""}${days}</b><small>${days === 1 ? "giorno" : "giorni"}</small>`}</span>
      <span class="g-main">
        <span class="g-kind">${icon(comp ? "trophy" : "flag")}${comp ? LEVELS[item.level] || "Gara" : "Traguardo"}</span>
        <b class="g-name">${esc(item.name)}</b>
        <span class="g-when">${whenLabel(item)}${comp && item.location ? ` · ${esc(item.location)}` : ""}${item.dateTbc ? ` <span class="tag">da confermare</span>` : ""}</span>
        ${!comp && item.notes ? `<span class="g-notes">${esc(item.notes)}</span>` : ""}
      </span>
      ${icon("right", "g-chev")}
    </a></li>`;
  }

  const pastRow = g => `<li><a class="goal-past-row" href="#/goal-edit?id=${q(g.id)}" data-goal="${esc(g.id)}">
    <span>${fmtShortDate(g.date)}</span><b>${esc(g.name)}</b>${icon("right", "g-chev")}
  </a></li>`;

  // ---------- weeks and streaks ----------

  function weeksSection(list, sessions, now) {
    const done = sessions.filter(s => s.date <= now);
    const runs = streakRuns(done);
    const record = longestRun(runs);
    const ongoing = currentRun(runs, now);
    const all = [...rows.values()].flatMap(r => r.weeks);
    const max = Math.max(60, ...all.map(w => w.minutes));
    const peak = all.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    const peakEvents = [...new Set(done.filter(s => s.type === "event" && s.title && weekStart(s.date) === peak.monday).map(s => s.title))];
    const active = new Set(done.map(s => weekStart(s.date))).size;
    return `
      <div class="section-title"><h2>Presenze</h2><span>${plural(active, "settimana", "settimane")} con allenamento</span></div>
      ${record ? `<div class="stats streak-stats">
        <div class="stat"><b>${ongoing ? ongoing.weeks : 0}</b><span>Settimane di fila</span><small>${ongoing ? `dal ${fmtShortDate(ongoing.start)}` : "nessuna serie in corso"}</small></div>
        <div class="stat"><b>${record.weeks}</b><span>Record di fila</span><small>${fmtSpan(record.start, record.end)}</small></div>
      </div>` : ""}
      <article class="card weeks-card">
        <span class="watermark" aria-hidden="true">周</span>
        <p class="chart-note">Ogni barra è una settimana: più è alta, più ore.</p>
        <div class="legend wk-legend"><span class="mk-comp">${icon("star")}Gara</span><span class="mk-goal">${icon("flag")}Traguardo</span><span class="mk-now"><i></i>Oggi</span></div>
        ${list.map(s => weekRow(rows.get(String(s.year)), { record, ongoing, max, now })).join("")}
        <div class="wk-axis" aria-hidden="true">${SEASON_MONTHS.map((m, k) => `<span style="left:${at(MONTH_DAYS[k])}">${MONTHS_SHORT[m]}</span>`).join("")}</div>
        ${peak.minutes ? `<p class="insight">La settimana con più ore: ${hours(peak.minutes)} h, ${fmtWeek(peak.monday)}${peakEvents.length ? ` (${esc(peakEvents.join(", "))})` : ""}.</p>` : ""}
        ${monthTable(list, now)}
      </article>`;
  }

  function weekRow({ season, weeks, marks }, { record, ongoing, max, now }) {
    const brackets = [
      record && bracket(record, season, weeks, record === ongoing ? `Record · ${record.weeks} settimane, in corso` : `Record · ${record.weeks} settimane`),
      ongoing && ongoing !== record && bracket(ongoing, season, weeks, `${ongoing.weeks} di fila`),
    ].filter(Boolean).join("");
    const summary = `${season.label}: ${hours(season.minutes)} ore in ${plural(season.weeks.size, "settimana", "settimane")} con allenamento. Con le frecce scorri le settimane.`;
    return `<div class="wk-row${season.current ? " current" : ""}">
      <div class="wk-head"><b>${season.label}</b><span>${season.current ? "in corso · " : ""}${hours(season.minutes)} h · ${plural(season.weeks.size, "settimana", "settimane")}</span></div>
      <div class="wk-plot${brackets ? " tall" : ""}" data-tip-zone data-season="${season.year}" tabindex="0" role="img" aria-label="${esc(summary)}">
        ${brackets}
        ${weeks.map((w, i) => weekMark(w, i, max)).join("")}
        ${marks.map(m => markIcon(m, season, weeks, max)).join("")}
        ${season.current ? `<i class="wk-today" style="left:${at(daysBetween(season.from, now) + 0.5)}"></i>` : ""}
      </div>
    </div>`;
  }

  // a week is 7 days wide: its bar takes the middle 5
  const weekMark = (w, i, max) => w.minutes
    ? `<i class="wk-bar" data-i="${i}" style="left:${at(w.offset + 1)};--h:${(w.minutes / max).toFixed(3)}"></i>`
    : `<i class="wk-dot" data-i="${i}" style="left:${at(w.offset + 1)}"></i>`;

  function markIcon({ kind, item }, season, weeks, max) {
    const offset = daysBetween(season.from, item.date);
    const week = weeks.find(w => offset >= w.offset && offset < w.offset + 7);
    return `<i class="wk-mark ${kind}" style="left:${at(offset + 0.5)};--h:${((week?.minutes || 0) / max).toFixed(3)}">${icon(kind === "goal" ? "flag" : "star")}</i>`;
  }

  /** A bracket over a run of weeks, cut to this season; the label goes where the run ends. */
  function bracket(run, season, weeks, text) {
    const first = weeks[0].monday, last = weeks.at(-1).monday;
    const from = run.from > first ? run.from : first;
    const to = run.to < last ? run.to : last;
    if (from > to) return "";
    const a = daysBetween(season.from, from) + 1, b = daysBetween(season.from, to) + 6;
    const middle = ((a + b) / 2 + PAD) / SPAN;
    const align = middle < 0.3 ? " start" : middle > 0.7 ? " end" : "";
    return `<span class="wk-bracket${align}" style="left:${at(a)};width:${(((b - a) / SPAN) * 100).toFixed(3)}%">${to === run.to ? `<em>${text}</em>` : ""}</span>`;
  }

  function weekTip(row, i) {
    const w = row.weeks[i];
    const marks = row.marks.filter(m => weekStart(m.item.date) === w.monday);
    const names = marks.map(m => m.item.name);
    if (w.future) {
      // a day still to be confirmed has only its month
      const tbc = marks.find(m => m.item.dateTbc);
      return {
        value: names.length ? names.join(", ") : "In arrivo",
        label: tbc ? `${whenLabel(tbc.item)} · data da confermare` : fmtWeek(w.monday),
      };
    }
    return {
      value: w.minutes ? `${hours(w.minutes)} h` : "Nessun allenamento",
      label: [fmtWeek(w.monday), w.count && plural(w.count, "sessione", "sessioni"), ...names].filter(Boolean).join(" · "),
    };
  }

  function monthTable(list, now) {
    const cols = [...list].reverse();
    const months = cols.map(monthMinutes);
    const thisMonth = (Number(now.slice(5, 7)) + 3) % 12;
    const cell = (s, j, k) => (s.current && k > thisMonth ? "" : months[j][k] ? hours(months[j][k]) : "–");
    return `<details class="numbers">
      <summary>${icon("down", "chev")}Vedi i numeri</summary>
      <table>
        <caption>Ore per mese</caption>
        <thead><tr><td></td>${cols.map(s => `<th scope="col">${s.label.slice(2)}</th>`).join("")}</tr></thead>
        <tbody>${SEASON_MONTHS.map((m, k) => `<tr><th scope="row">${MONTHS_SHORT[m]}</th>${cols.map((s, j) => `<td>${cell(s, j, k)}</td>`).join("")}</tr>`).join("")}</tbody>
        <tfoot>
          <tr><th scope="row">Totale</th>${cols.map(s => `<td>${hours(s.minutes)}</td>`).join("")}</tr>
          <tr><th scope="row">Settimane</th>${cols.map(s => `<td>${s.weeks.size}</td>`).join("")}</tr>
        </tfoot>
      </table>
    </details>`;
  }

  // ---------- seasons ----------

  function seasonsSection(list) {
    const max = Math.max(60, ...list.map(s => s.minutes));
    const present = new Set(list.flatMap(s => Object.keys(s.byType)));
    const order = [...TYPE_KEYS.filter(k => present.has(k)), ...[...present].filter(k => !TYPE_KEYS.includes(k))];
    const pair = lastTwoFull(list);
    return `
      <div class="section-title"><h2>Ore per stagione</h2><span>da settembre ad agosto</span></div>
      <article class="card seasons-card">
        <span class="watermark" aria-hidden="true">时</span>
        <div class="legend ss-legend">${order.map(k => `<span style="--c:${typeOf(k).color}">${esc(typeOf(k).label)}</span>`).join("")}</div>
        <div class="ss-rows">${list.map(s => seasonBar(s, order, max)).join("")}</div>
        ${pair ? comparison(pair) : ""}
        ${typeTable(list, order)}
      </article>`;
  }

  function seasonBar(s, order, max) {
    const note = s.current ? "in corso" : s.lateStart ? `da ${MONTHS[Number(s.lateStart.slice(5, 7)) - 1]}` : "";
    return `<div class="ss-row">
      <span class="ss-label"><b>${s.label}</b>${note ? `<small>${note}</small>` : ""}</span>
      <span class="ss-track">
        <span class="ss-bar" style="--f:${(s.minutes / max).toFixed(4)}">${order.filter(k => s.byType[k]).map(k => {
          const t = typeOf(k), value = `${hours(s.byType[k])} h`;
          return `<button class="ss-seg" style="--c:${t.color};flex-grow:${s.byType[k]}" data-tip="${value}" data-tip-label="${esc(t.label)} · ${s.label}" aria-label="${esc(`${t.label} nel ${s.label}: ${value}`)}"></button>`;
        }).join("")}</span>
        <b class="ss-total">${hours(s.minutes)} h</b>
      </span>
    </div>`;
  }

  function comparison([older, newer]) {
    const pct = Math.round((newer.minutes / older.minutes - 1) * 100);
    const change = pct === 0 ? `quante nel ${older.label}` : `il ${Math.abs(pct)}% ${pct > 0 ? "in più" : "in meno"} rispetto al ${older.label}`;
    const big = pct ? biggestChange(older, newer, Math.sign(pct)) : null;
    return `<p class="insight">Nel ${newer.label}: ${hours(newer.minutes)} ore, ${change}.${big ? ` ${pct > 0 ? "La crescita più grande" : "Il calo più grande"}: ${esc(typeOf(big.type).label)}, da ${hours(big.from)} a ${hours(big.to)} ore.` : ""}</p>`;
  }

  function typeTable(list, order) {
    return `<details class="numbers">
      <summary>${icon("down", "chev")}Vedi i numeri</summary>
      <table>
        <caption>Ore per tipo di lezione</caption>
        <thead><tr><td></td>${order.map(k => `<th scope="col" class="th-type" style="--c:${typeOf(k).color}"><span aria-hidden="true">${typeOf(k).glyph}</span><span class="sr-only">${esc(typeOf(k).label)}</span></th>`).join("")}<th scope="col">Tot.</th></tr></thead>
        <tbody>${[...list].reverse().map(s => `<tr><th scope="row">${s.label.slice(2)}</th>${order.map(k => `<td>${s.byType[k] ? hours(s.byType[k]) : "–"}</td>`).join("")}<td><b>${hours(s.minutes)}</b></td></tr>`).join("")}</tbody>
      </table>
    </details>`;
  }

  // ---------- picking a week ----------

  /** The week under the pointer, by position: a bar is too thin to aim at. */
  function weekAt(plot, clientX) {
    const box = plot.getBoundingClientRect();
    const day = ((clientX - box.left) / box.width) * SPAN - PAD;
    return Math.floor((day - rows.get(plot.dataset.season).weeks[0].offset) / 7);
  }

  /** Where the keyboard starts: this week, or the last week with sessions. */
  function restingWeek(plot) {
    const weeks = rows.get(plot.dataset.season).weeks;
    const now = weeks.findIndex(w => w.current);
    if (now >= 0) return now;
    const last = weeks.findLastIndex(w => w.minutes);
    return last >= 0 ? last : 0;
  }

  function pick(plot, i) {
    const row = rows.get(plot.dataset.season);
    if (!row) return;
    i = Math.max(0, Math.min(row.weeks.length - 1, i));
    if (picked?.el && (picked.plot !== plot || picked.i !== i)) picked.el.classList.remove("on");
    const el = plot.querySelector(`[data-i="${i}"]`);
    el.classList.add("on");
    picked = { plot, i, el };
    const { value, label } = weekTip(row, i);
    const box = plot.getBoundingClientRect(), mark = el.getBoundingClientRect();
    showTip({ left: mark.left, right: mark.right, top: box.top, bottom: box.bottom }, value, label);
  }

  function unpick(tip = true) {
    picked?.el.classList.remove("on");
    picked = null;
    if (tip) hideTip();
  }

  // ---------- events ----------

  root.addEventListener("click", e => {
    const tipped = e.target.closest("[data-tip]");
    if (tipped) return showTip(tipped.getBoundingClientRect(), tipped.dataset.tip, tipped.dataset.tipLabel);
    if (e.target.closest("[data-retry]")) load().catch(err => toast(errorMessage(err), "error"));
  });

  root.addEventListener("pointerdown", e => {
    const plot = e.target.closest(".wk-plot");
    if (plot) pick(plot, weekAt(plot, e.clientX));
  });
  root.addEventListener("pointermove", e => {
    const plot = e.target.closest(".wk-plot");
    if (plot && (e.pointerType === "mouse" || e.buttons)) pick(plot, weekAt(plot, e.clientX));
  });
  root.addEventListener("pointerout", e => {
    const plot = e.target.closest(".wk-plot");
    // the mouse left a row it was only hovering
    if (plot && e.pointerType === "mouse" && !plot.contains(e.relatedTarget) && document.activeElement !== plot) unpick();
  });

  root.addEventListener("keydown", e => {
    const plot = e.target.closest?.(".wk-plot");
    if (!plot) return;
    const i = picked?.plot === plot ? picked.i : restingWeek(plot);
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: Infinity }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      pick(plot, next);
    } else if (e.key === "Escape") unpick();
  });

  root.addEventListener("focusin", e => {
    const plot = e.target.closest(".wk-plot");
    if (plot) {
      if (plot.matches(":focus-visible")) pick(plot, restingWeek(plot));
      return;
    }
    const tipped = e.target.closest("[data-tip]");
    if (tipped && tipped.matches(":focus-visible")) showTip(tipped.getBoundingClientRect(), tipped.dataset.tip, tipped.dataset.tipLabel);
  });
  root.addEventListener("focusout", e => {
    // a tap on another row moves the focus after that row has already picked its week
    if (e.target.closest(".wk-plot")) {
      if (picked?.plot === e.target) unpick();
    } else if (e.target.closest("[data-tip]")) hideTip();
  });

  // the label closes on scroll and on a tap elsewhere: so does the highlight
  const onScroll = () => picked && unpick(false);
  const onDown = e => {
    if (picked && !e.target.closest?.(".wk-plot")) unpick(false);
  };
  addEventListener("scroll", onScroll, { passive: true, capture: true });
  addEventListener("pointerdown", onDown, { capture: true });

  const unsubscribe = subscribe(state => {
    if (state.data === drawnData && state.data) return;
    draw();
  });

  draw();

  return () => {
    unsubscribe();
    removeEventListener("scroll", onScroll, { capture: true });
    removeEventListener("pointerdown", onDown, { capture: true });
    hideTip();
  };
}

function skeleton() {
  return `<section class="view">
    <div class="skeleton" style="height:90px;margin-top:10px"></div>
    <div class="skeleton" style="height:230px;margin-top:22px"></div>
    <div class="skeleton" style="height:160px;margin-top:22px"></div>
  </section>`;
}
