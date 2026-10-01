import { getState, subscribe, commit, load, errorMessage } from "../store.js";
import { MEDALS, MEDAL_PLURALS, MEDAL_KEYS, LEVELS, LEVEL_CHOICES, RESULTS } from "../types.js";
import { MONTHS, MONTHS_SHORT, cap, today, addDays, parseISO, daysBetween, fmtLongDate, fmtShortDate, fmtNum, fmtSigned, plural, esc } from "../format.js";
import { icon } from "../icons.js";
import { openSheet, closeSheet, sheetBody, toast, stamp, armConfirm, showTip, hideTip } from "../ui.js";
import { byDate } from "../stats.js";
import { hasResults, upcoming, awaitingResults, withResults, palmares, bySpecialty, opponents, roundsByNumber, roundOutcome, categoryLimit } from "../competition-stats.js";

const OPPONENTS_SHOWN = 5;
const CHART_POINTS = 20;
const OUTCOMES = { won: { label: "Vinto", mark: "V" }, draw: { label: "Pari", mark: "=" }, lost: { label: "Perso", mark: "P" } };

const q = id => encodeURIComponent(id);
const editLink = c => `#/competition-edit?id=${q(c.id)}`;
const fmtKg = kg => kg.toFixed(1).replace(".", ",");

/** "Sabato 15 maggio 2027", or "Maggio 2027" when the day is still to be confirmed. */
export function whenLabel(c) {
  const d = parseISO(c.date);
  return c.dateTbc ? `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}` : `${fmtLongDate(c.date)} ${d.getFullYear()}`;
}

export function renderCompetitions(root, params) {
  let drawnData;
  let animate = true;
  let sheet = null; // { kind: "competition", id } or { kind: "weight" }
  let chart = null; // points of the weight chart, for the crosshair
  let allOpponents = false;
  const openOpponents = new Set();
  let openOnLoad = params.get("open");

  function draw() {
    const { data, status, error } = getState();
    drawnData = data;
    if (!data) {
      root.innerHTML = status === "error"
        ? `<section class="view"><div class="notice">${esc(errorMessage(error))}<button class="btn btn-ghost" data-retry>${icon("refresh")} Riprova</button></div></section>`
        : skeleton();
      return;
    }
    const comps = data.competitions;
    const next = upcoming(comps);
    const done = withResults(comps);
    root.innerHTML = `
      <section class="${animate ? "view " : ""}competitions">
        <div class="view-title">
          <span class="cn" aria-hidden="true">赛</span>
          <p class="eyebrow">Palmarès e preparazione</p>
          <h1>Gare</h1>
        </div>
        ${awaitingResults(comps).map(pendingCard).join("")}
        ${next.length ? nextCard(next[0]) : `<div class="card empty"><span class="cn" aria-hidden="true">空</span>Nessuna gara in programma</div>`}
        ${laterList(next.slice(1))}
        <a class="btn btn-ghost add-comp" href="#/competition-edit">${icon("plus")} Aggiungi una gara</a>
        ${weightSection([...data.weights].sort(byDate), next[0], done[0])}
        ${done.length ? palmaresSection(done) + historySection(done) : ""}
        ${opponentsSection(comps)}
        ${roundsSection(comps)}
      </section>`;
    animate = false;
  }

  // ---------- upcoming ----------

  function pendingCard(c) {
    return `<article class="pending-comp">
      <span class="watermark" aria-hidden="true">赛</span>
      <p class="eyebrow">Com'è andata?</p>
      <h2>${esc(c.name)}</h2>
      <p class="s-meta">${icon("calendar")} ${fmtShortDate(c.date)}${c.location ? ` · ${esc(c.location)}` : ""}</p>
      <a class="btn btn-primary" href="${editLink(c)}">${icon("trophy")} Aggiungi i risultati</a>
    </article>`;
  }

  function nextCard(c) {
    const days = daysBetween(today(), c.date);
    const weeks = Math.floor(days / 7);
    const approx = c.dateTbc ? "~" : "";
    return `<article class="next-comp" data-open="${esc(c.id)}">
      <span class="watermark" aria-hidden="true">备战</span>
      <p class="eyebrow">Prossima gara · ${LEVEL_CHOICES[c.level] || "Gara"}</p>
      <h2>${esc(c.name)}</h2>
      <p class="s-meta">${icon("pin")} ${esc(c.location || "Luogo da definire")}${c.category ? ` · ${esc(c.category)}` : ""}</p>
      <div class="countdown">
        ${days === 0 ? `<b>Oggi</b>` : `<b>${approx ? `<i class="approx">${approx}</i>` : ""}${days}</b><span>${days === 1 ? "giorno" : "giorni"}${weeks >= 2 ? `<small>${c.dateTbc ? "circa " : ""}${weeks} settimane</small>` : ""}</span>`}
      </div>
      <p class="next-when">${whenLabel(c)}${c.dateTbc ? ` <span class="tag">data da confermare</span>` : ""}</p>
      ${c.prep ? `<p class="next-prep">${esc(c.prep)}</p>` : ""}
      <div class="next-actions">
        <button class="chip-btn" data-open="${esc(c.id)}">${icon("right")} Dettagli</button>
        <a class="chip-btn" href="${editLink(c)}">${icon("clipboard")} ${c.prep ? "Preparazione" : "Note di preparazione"}</a>
      </div>
    </article>`;
  }

  function laterList(list) {
    if (!list.length) return "";
    return `<ul class="later">${list.map(c => `<li>
      <button class="later-row" data-open="${esc(c.id)}">
        <span class="later-date">${fmtShortDate(c.date)}</span>
        <span class="later-name">${esc(c.name)}</span>
        <span class="later-days">${c.dateTbc ? "~" : ""}${daysBetween(today(), c.date)} gg</span>
      </button></li>`).join("")}</ul>`;
  }

  // ---------- weight ----------

  function weightSection(weights, next, last) {
    const ref = next?.category ? { comp: next, label: "prossima gara" } : last?.category ? { comp: last, label: "ultima gara" } : null;
    const limit = ref ? categoryLimit(ref.comp.category) : null;
    const latest = weights.at(-1);
    let body;
    if (!latest) {
      chart = null;
      body = `<p class="w-empty">Pesati ogni tanto: qui vedi come cambia il peso e quanto manca al limite della categoria.</p>
        <button class="btn btn-ghost" data-weight>${icon("scale")} Registra il peso</button>`;
    } else {
      const prev = weights.at(-2);
      const margin = limit != null ? limit - latest.kg : null;
      body = `
        <div class="w-head">
          <div class="w-figure"><b>${fmtNum(latest.kg)}</b><span>kg</span></div>
          <div class="w-side">
            <span>${fmtShortDate(latest.date)}</span>
            ${prev ? `<span class="w-delta">${fmtSigned(latest.kg - prev.kg)} kg dalla volta prima</span>` : ""}
          </div>
          <button class="chip-btn" data-weight>${icon("plus")} Pesati</button>
        </div>
        ${weightChart(weights, limit)}
        ${margin == null ? "" : margin >= 0
          ? `<p class="w-limit">${icon("check")} ${fmtNum(margin)} kg sotto il limite di ${fmtNum(limit)} kg</p>`
          : `<p class="w-limit over">${icon("alert")} ${fmtNum(-margin)} kg sopra il limite di ${fmtNum(limit)} kg</p>`}`;
    }
    return `
      <div class="section-title"><h2>Peso</h2><span>${ref ? `${esc(ref.comp.category)} · ${ref.label}` : ""}</span></div>
      <article class="card weight-card"><span class="watermark" aria-hidden="true">体重</span>${body}</article>`;
  }

  function weightChart(weights, limit) {
    const pts = weights.slice(-CHART_POINTS);
    if (pts.length < 2) {
      chart = null;
      return "";
    }
    const times = pts.map(w => parseISO(w.date).getTime());
    const t0 = times[0], t1 = times.at(-1);
    const xs = times.map((t, i) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * 100 : (i / (pts.length - 1)) * 100));
    let lo = Math.min(...pts.map(p => p.kg)), hi = Math.max(...pts.map(p => p.kg));
    const showLimit = limit != null && limit > lo - 3 && limit < hi + 3;
    if (showLimit) {
      lo = Math.min(lo, limit);
      hi = Math.max(hi, limit);
    }
    const pad = Math.max(0.5, (hi - lo) * 0.18);
    lo -= pad;
    hi += pad;
    const ys = pts.map(p => ((hi - p.kg) / (hi - lo)) * 100);
    chart = { pts, xs, ys, index: pts.length - 1 };
    const line = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");
    const limitY = showLimit ? ((hi - limit) / (hi - lo)) * 100 : null;
    const first = pts[0], last = pts.at(-1);
    return `
      <div class="w-chart" tabindex="0" role="img" aria-label="Andamento del peso: da ${fmtNum(first.kg)} kg il ${fmtShortDate(first.date)} a ${fmtNum(last.kg)} kg il ${fmtShortDate(last.date)}">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path class="w-area" d="${line} L100 100 L0 100 Z"/>
          <path class="w-line" d="${line}" vector-effect="non-scaling-stroke"/>
        </svg>
        ${showLimit ? `<i class="w-limit-line" style="top:${limitY.toFixed(2)}%"><span>${fmtNum(limit)} kg</span></i>` : ""}
        <i class="w-cross" hidden></i>
        <i class="w-dot" style="left:100%;top:${ys.at(-1).toFixed(2)}%"></i>
      </div>
      <div class="w-axis" aria-hidden="true"><span>${fmtShortDate(first.date, first.date.slice(0, 4) !== last.date.slice(0, 4))}</span><span>${fmtShortDate(last.date, false)}</span></div>`;
  }

  function pointAt(el, i) {
    if (!chart) return;
    chart.index = i;
    const r = el.getBoundingClientRect();
    const x = r.left + (chart.xs[i] / 100) * r.width;
    const y = r.top + (chart.ys[i] / 100) * r.height;
    const cross = el.querySelector(".w-cross");
    cross.hidden = false;
    cross.style.left = `${chart.xs[i]}%`;
    const dot = el.querySelector(".w-dot");
    dot.style.left = `${chart.xs[i]}%`;
    dot.style.top = `${chart.ys[i]}%`;
    const p = chart.pts[i];
    showTip({ left: x, right: x, top: y - 8, bottom: y + 8 }, `${fmtNum(p.kg)} kg`, fmtShortDate(p.date));
  }

  function resetChart(el) {
    if (!chart) return;
    hideTip();
    el.querySelector(".w-cross").hidden = true;
    const dot = el.querySelector(".w-dot");
    dot.style.left = "100%";
    dot.style.top = `${chart.ys.at(-1)}%`;
  }

  function nearest(el, clientX) {
    const r = el.getBoundingClientRect();
    const fx = ((clientX - r.left) / r.width) * 100;
    let best = 0;
    chart.xs.forEach((x, i) => { if (Math.abs(x - fx) < Math.abs(chart.xs[best] - fx)) best = i; });
    return best;
  }

  // ---------- palmarès ----------

  function palmaresSection(done) {
    const p = palmares(done);
    return `
      <div class="section-title"><h2>Palmarès</h2><span>${plural(p.competitions, "gara", "gare")} · ${plural(p.medalCount, "medaglia", "medaglie")}</span></div>
      <article class="card palmares">
        <span class="watermark" aria-hidden="true">奖牌</span>
        <div class="tally">${MEDAL_KEYS.map(m => `
          <div class="tally-item medal-${m}">
            <span class="medal medal-${m}"></span><b>${p.medals[m]}</b><span>${p.medals[m] === 1 ? MEDALS[m] : MEDAL_PLURALS[m]}</span>
          </div>`).join("")}
        </div>
        <div class="record">
          <div><b>${p.won + p.lost}</b><span>Incontri</span></div>
          <div><b>${p.won}</b><span>Vinti</span></div>
          <div><b>${p.lost}</b><span>Persi</span></div>
        </div>
        <ul class="spec-list">${bySpecialty(done).map(r => `
          <li>
            <div class="spec-top"><b>${esc(r.name)}</b><span>${plural(r.competitions, "gara", "gare")}</span></div>
            <div class="spec-bottom">
              <span class="spec-medals">${MEDAL_KEYS.filter(m => r.medals[m]).map(m => `<span class="spec-medal"><span class="medal medal-${m}"></span>${r.medals[m]}<span class="sr-only"> ${r.medals[m] === 1 ? MEDALS[m] : MEDAL_PLURALS[m]}</span></span>`).join("") || `<span class="muted">Nessuna medaglia</span>`}</span>
              <span class="spec-record">${r.won}–${r.lost} <small>incontri V–P</small></span>
            </div>
          </li>`).join("")}
        </ul>
      </article>`;
  }

  function historySection(done) {
    return `
      <div class="section-title"><h2>Gare disputate</h2><span>${done.length}</span></div>
      <ol class="comp-list">${done.map(c => {
        const d = parseISO(c.date);
        const medals = c.specialties.filter(sp => MEDALS[sp.medal]);
        return `<li><button class="comp-row" data-open="${esc(c.id)}">
          <span class="cr-date"><b>${d.getDate()}</b><span>${MONTHS_SHORT[d.getMonth()]}</span><small>${d.getFullYear()}</small></span>
          <span class="cr-main"><span class="cr-name">${esc(c.name)}</span><span class="cr-meta">${esc([c.location, c.category].filter(Boolean).join(" · "))}</span></span>
          <span class="cr-medals">${medals.map(sp => `<span class="medal medal-${sp.medal}"></span>`).join("")}<span class="sr-only">${medals.map(sp => `${MEDALS[sp.medal]} in ${esc(sp.name)}`).join(", ")}</span></span>
        </button></li>`;
      }).join("")}</ol>`;
  }

  // ---------- opponents ----------

  function opponentsSection(comps) {
    const list = opponents(comps);
    if (!list.length) return "";
    const shown = allOpponents ? list : list.slice(0, OPPONENTS_SHOWN);
    return `
      <div class="section-title"><h2>Avversari</h2><span>${list.length}</span></div>
      <ul class="opp-list">${shown.map(o => `<li>
        <details data-opp="${esc(o.key)}"${openOpponents.has(o.key) ? " open" : ""}>
          <summary>
            <span class="avatar" aria-hidden="true">${esc(initials(o.name))}</span>
            <span class="opp-main"><b>${esc(o.name)}</b><small>${plural(o.meetings.length, "incontro", "incontri")} · ${fmtShortDate(o.meetings.at(-1).competition.date)}</small></span>
            <span class="opp-record">${o.meetings.map(m => resultChip(m.match.result)).join("")}</span>
            ${icon("down", "chev")}
          </summary>
          <ol class="meetings">${[...o.meetings].reverse().map(meetingRow).join("")}</ol>
        </details></li>`).join("")}
      </ul>
      ${shown.length < list.length ? `<button class="btn btn-ghost show-more" data-all-opponents>Mostra tutti (${list.length})</button>` : ""}`;
  }

  const resultChip = result => `<i class="rchip ${RESULTS[result] ? result : ""}">${result === "won" ? "V" : result === "lost" ? "P" : "?"}<span class="sr-only"> ${RESULTS[result] || ""}</span></i>`;

  const meetingRow = ({ competition: c, specialty: sp, match: m }) => `<li class="meeting">
    <span class="res ${RESULTS[m.result] ? m.result : ""}">${RESULTS[m.result] || "—"}</span>
    <span class="mt-main"><b>${esc(sp.name)}</b><small>${esc(c.name)} · ${fmtShortDate(c.date)}</small></span>
    ${m.rounds.length ? `<span class="round-chips">${m.rounds.map(roundChip).join("")}</span>` : ""}
  </li>`;

  const roundChip = (r, k) => `<span class="rc ${roundOutcome(r)}"><small>R${k + 1}</small>${r.me}–${r.opponent}</span>`;

  // ---------- rounds ----------

  function roundsSection(comps) {
    const rows = roundsByNumber(comps);
    if (!rows.length) return "";
    const matches = new Set(rows.flatMap(r => r.items.map(it => it.match))).size;
    const order = { won: 0, draw: 1, lost: 2 };
    const wins = items => items.filter(it => it.outcome === "won").length;
    const later = rows.slice(1).flatMap(r => r.items);
    return `
      <div class="section-title"><h2>Round per round</h2><span>${plural(matches, "incontro", "incontri")} con i punteggi</span></div>
      <article class="card rounds-card">
        <span class="watermark" aria-hidden="true">回合</span>
        <div class="legend outcomes">${Object.entries(OUTCOMES).map(([k, o]) => `<span class="${k}">${o.label}</span>`).join("")}<em>vinti / giocati</em></div>
        ${rows.map(r => `
          <div class="u-row">
            <span class="u-label">${r.number}° round</span>
            <span class="u-dots">${[...r.items].sort((a, b) => order[a.outcome] - order[b.outcome]).map(unitDot).join("")}</span>
            <span class="u-value">${wins(r.items)}<small>/${r.items.length}</small></span>
          </div>`).join("")}
        ${later.length ? `<p class="insight">Primo round: vinti ${wins(rows[0].items)} su ${rows[0].items.length}. Dal secondo in poi: vinti ${wins(later)} su ${later.length}.</p>` : ""}
      </article>`;
  }

  function unitDot(it) {
    const o = OUTCOMES[it.outcome];
    const value = `${o.label} ${it.round.me}–${it.round.opponent}`;
    const label = `${it.specialty.name}${it.match.opponent ? ` con ${it.match.opponent}` : ""} · ${fmtShortDate(it.competition.date)}`;
    return `<button class="u-dot ${it.outcome}" data-tip="${esc(value)}" data-tip-label="${esc(label)}" aria-label="${esc(`${value}, ${label}`)}">${o.mark}</button>`;
  }

  // ---------- competition sheet ----------

  function competitionSheet(c) {
    const done = hasResults(c);
    const days = daysBetween(today(), c.date);
    return `
      <div class="sheet-head">
        <div>
          <p class="eyebrow">${LEVELS[c.level] || "Gara"}${done ? "" : days >= 0 ? " · in programma" : ""}</p>
          <h2>${esc(c.name)}</h2>
        </div>
        <button class="icon-btn" data-close aria-label="Chiudi">${icon("x")}</button>
      </div>
      <div class="comp-facts">
        <p class="s-meta">${icon("calendar")} ${whenLabel(c)}${c.dateTbc ? ` <span class="tag">da confermare</span>` : ""}</p>
        ${!done && days >= 0 ? `<p class="s-meta">${icon("clock")} ${days === 0 ? "È oggi" : days === 1 ? "Domani" : `${c.dateTbc ? "Circa" : "Tra"} ${days} giorni`}</p>` : ""}
        ${c.location ? `<p class="s-meta">${icon("pin")} ${esc(c.location)}</p>` : ""}
        ${c.category ? `<p class="s-meta">${icon("scale")} ${esc(c.category)}</p>` : ""}
      </div>
      ${c.prep ? `<section class="sheet-block"><p class="field-label">Preparazione</p><p class="s-notes">${esc(c.prep)}</p></section>` : ""}
      ${done ? `<div class="sheet-list">${c.specialties.map(specialtyCard).join("")}</div>` : ""}
      ${c.notes ? `<section class="sheet-block"><p class="field-label">Com'è andata</p><p class="s-notes">${esc(c.notes)}</p></section>` : ""}
      ${!done && days <= 0 ? `<a class="btn btn-primary" href="${editLink(c)}">${icon("trophy")} Aggiungi i risultati</a>` : ""}
      <div class="s-actions sheet-actions">
        <a class="chip-btn" href="${editLink(c)}">${icon("pencil")} Modifica</a>
        <button class="chip-btn danger" data-delete="${esc(c.id)}">${icon("trash")} Elimina</button>
      </div>`;
  }

  const specialtyCard = (sp, i) => `<article class="s-card sp-card ${MEDALS[sp.medal] ? `medal-${sp.medal}` : ""}" style="--i:${i}">
    <div class="sp-head">${MEDALS[sp.medal] ? `<span class="medal medal-${sp.medal}"></span>` : ""}<h3>${esc(sp.name)}</h3><span class="muted">${MEDALS[sp.medal] || "Nessuna medaglia"}</span></div>
    ${sp.notes ? `<p class="sp-notes">${esc(sp.notes)}</p>` : ""}
    ${sp.matches.length ? `<ol class="match-list">${sp.matches.map(matchRow).join("")}</ol>` : ""}
  </article>`;

  const matchRow = m => `<li class="match">
    <div class="match-top"><span class="res ${RESULTS[m.result] ? m.result : ""}">${RESULTS[m.result] || "—"}</span><span class="vs">${m.opponent ? `con <b>${esc(m.opponent)}</b>` : "Avversario non indicato"}</span></div>
    ${m.rounds.length ? `<div class="round-chips">${m.rounds.map(roundChip).join("")}</div>` : ""}
    ${m.notes ? `<p class="match-notes">${esc(m.notes)}</p>` : ""}
  </li>`;

  function openCompetition(id) {
    const c = getState().data?.competitions.find(x => x.id === id);
    if (!c) return toast("Questa gara non esiste più", "error");
    sheet = { kind: "competition", id };
    openSheet(competitionSheet(c)).addEventListener("click", onCompetitionSheetClick);
  }

  function onCompetitionSheetClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    if ("close" in btn.dataset) return closeSheet();
    if (btn.dataset.delete) {
      armConfirm(btn, "Conferma", async () => {
        const c = getState().data.competitions.find(x => x.id === btn.dataset.delete);
        if (!c) return;
        btn.disabled = true;
        try {
          await commit(d => { d.competitions = d.competitions.filter(x => x.id !== c.id); }, `Delete competition ${c.date} (${c.name})`);
          toast("Gara eliminata");
        } catch (err) {
          toast(errorMessage(err), "error");
          btn.disabled = false;
        }
      });
    }
  }

  // ---------- weight sheet ----------

  function weighList() {
    const weights = [...getState().data.weights].sort(byDate);
    if (!weights.length) return "";
    const offset = Math.max(0, weights.length - 8);
    const rows = weights.slice(offset).map((w, i) => ({ w, prev: weights[offset + i - 1] })).reverse();
    return `<p class="field-label">Ultime pesate</p>
      <ul class="weigh-list">${rows.map(({ w, prev }) => `<li>
        <span class="wl-date">${fmtShortDate(w.date)}</span>
        <b>${fmtNum(w.kg)} kg</b>
        <span class="wl-delta">${prev ? fmtSigned(w.kg - prev.kg) : ""}</span>
        <button class="chip-btn danger" data-delete-weight="${esc(w.id)}" aria-label="Elimina la pesata del ${fmtShortDate(w.date)}">${icon("trash")}</button>
      </li>`).join("")}</ul>`;
  }

  function openWeight() {
    sheet = { kind: "weight" };
    const weights = [...getState().data.weights].sort(byDate);
    const lastKg = weights.at(-1)?.kg;
    let date = today();
    const body = openSheet(`
      <div class="sheet-head">
        <div><p class="eyebrow">Peso</p><h2>Registra il peso</h2></div>
        <button class="icon-btn" data-close aria-label="Chiudi">${icon("x")}</button>
      </div>
      <form class="weight-form" novalidate>
        <div class="card duration kg-card">
          <button type="button" class="round-btn" data-kg-step="-0.1" aria-label="Meno 100 grammi">${icon("minus")}</button>
          <label class="kg-field"><input class="kg-input" name="kg" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="80,0" value="${lastKg ? fmtKg(lastKg) : ""}" aria-label="Peso in chili"><small>kg</small></label>
          <button type="button" class="round-btn" data-kg-step="0.1" aria-label="Più 100 grammi">${icon("plus")}</button>
        </div>
        <div class="date-chips">
          <button type="button" class="chip" data-wday="today">Oggi</button>
          <button type="button" class="chip" data-wday="yesterday">Ieri</button>
          <label class="chip" data-wday="other"><span data-wday-label>Altro</span><input type="date" name="date" aria-label="Scegli il giorno"></label>
        </div>
        <button type="submit" class="btn btn-primary" data-save-weight>${icon("check")}<span>Salva</span></button>
      </form>
      <div data-weigh-list>${weighList()}</div>`);

    const form = body.querySelector(".weight-form");
    const input = form.querySelector("input[name=kg]");
    const dateInput = form.querySelector("input[name=date]");
    const save = form.querySelector("[data-save-weight]");
    const parseKg = s => {
      const n = parseFloat(String(s).replace(",", ".").replace(/[^\d.]/g, ""));
      return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
    };
    const syncDate = () => {
      const when = date === today() ? "today" : date === addDays(today(), -1) ? "yesterday" : "other";
      form.querySelectorAll("[data-wday]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.wday === when)));
      form.querySelector("[data-wday-label]").textContent = when === "other" ? fmtShortDate(date, false) : "Altro";
      dateInput.value = date;
    };

    body.addEventListener("click", e => {
      const el = e.target.closest("button, [data-wday]");
      if (!el) return;
      const d = el.dataset;
      if ("close" in d) return closeSheet();
      if (d.kgStep) {
        const kg = parseKg(input.value) ?? lastKg ?? 80;
        input.value = fmtKg(Math.round((kg + Number(d.kgStep)) * 10) / 10);
        return;
      }
      if (d.wday === "today" || d.wday === "yesterday") {
        date = d.wday === "today" ? today() : addDays(today(), -1);
        return syncDate();
      }
      if (d.wday === "other" && matchMedia("(pointer: fine)").matches) {
        try { dateInput.showPicker(); } catch { /* the native control opens on its own */ }
        return;
      }
      if (d.deleteWeight) {
        armConfirm(el, "Elimina", async () => {
          const w = getState().data.weights.find(x => x.id === d.deleteWeight);
          if (!w) return;
          el.disabled = true;
          try {
            await commit(data => { data.weights = data.weights.filter(x => x.id !== w.id); }, `Delete weight ${w.date} (${w.kg} kg)`);
            toast("Pesata eliminata");
          } catch (err) {
            toast(errorMessage(err), "error");
            el.disabled = false;
          }
        });
      }
    });

    dateInput.addEventListener("change", () => {
      if (dateInput.value) date = dateInput.value;
      syncDate();
    });

    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (save.disabled) return;
      const kg = parseKg(input.value);
      if (kg == null || kg < 30 || kg > 200) {
        toast("Scrivi il peso in chili, per esempio 82,4", "error");
        input.focus();
        return;
      }
      save.disabled = true;
      save.innerHTML = `<span class="spinner"></span><span>Salvo su GitHub…</span>`;
      try {
        await commit(data => data.weights.push({ id: crypto.randomUUID(), date, kg, createdAt: Date.now() }), `Log weight ${date} (${kg} kg)`);
        stamp("重");
        toast("Peso salvato");
        closeSheet();
      } catch (err) {
        toast(errorMessage(err), "error");
        save.disabled = false;
        save.innerHTML = `${icon("check")}<span>Salva</span>`;
      }
    });

    syncDate();
  }

  function refreshSheet() {
    const body = sheetBody();
    if (!body || !sheet) return;
    if (sheet.kind === "weight") {
      const list = body.querySelector("[data-weigh-list]");
      if (list) list.innerHTML = weighList();
      return;
    }
    const c = getState().data.competitions.find(x => x.id === sheet.id);
    if (!c) return closeSheet();
    body.innerHTML = competitionSheet(c);
    body.querySelector(".sheet-list")?.classList.add("static");
  }

  // ---------- events ----------

  root.addEventListener("click", e => {
    if (e.target.closest("a, summary, .w-chart")) return;
    const tipped = e.target.closest("[data-tip]");
    if (tipped) return showTip(tipped.getBoundingClientRect(), tipped.dataset.tip, tipped.dataset.tipLabel);
    const open = e.target.closest("[data-open]");
    if (open) return openCompetition(open.dataset.open);
    if (e.target.closest("[data-weight]")) return openWeight();
    if (e.target.closest("[data-all-opponents]")) {
      allOpponents = true;
      return draw();
    }
    if (e.target.closest("[data-retry]")) load().catch(err => toast(errorMessage(err), "error"));
  });

  root.addEventListener("focusin", e => {
    const tipped = e.target.closest("[data-tip]");
    if (tipped && tipped.matches(":focus-visible")) showTip(tipped.getBoundingClientRect(), tipped.dataset.tip, tipped.dataset.tipLabel);
    const el = e.target.closest(".w-chart");
    if (el && chart && el.matches(":focus-visible")) pointAt(el, chart.index);
  });
  root.addEventListener("focusout", e => {
    if (e.target.closest("[data-tip]")) hideTip();
    const el = e.target.closest(".w-chart");
    if (el) resetChart(el);
  });

  // the weight chart follows the finger (or the mouse) and snaps to the nearest weigh-in
  const onPointerDown = e => {
    const el = e.target.closest?.(".w-chart");
    if (el && chart) return pointAt(el, nearest(el, e.clientX));
    const shown = root.querySelector(".w-chart");
    if (shown) resetChart(shown);
  };
  document.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", e => {
    const el = e.target.closest(".w-chart");
    if (el && chart && (e.pointerType === "mouse" || e.buttons)) pointAt(el, nearest(el, e.clientX));
  });
  root.addEventListener("pointerout", e => {
    const el = e.target.closest(".w-chart");
    if (el && e.pointerType === "mouse" && !el.contains(e.relatedTarget)) resetChart(el);
  });
  root.addEventListener("keydown", e => {
    const el = e.target.closest(".w-chart");
    if (!el || !chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const last = chart.pts.length - 1;
    const i = { ArrowLeft: chart.index - 1, ArrowRight: chart.index + 1, Home: 0, End: last }[e.key];
    pointAt(el, Math.min(last, Math.max(0, i)));
  });

  // remember which opponents are open, so a refresh keeps them open
  root.addEventListener("toggle", e => {
    const key = e.target.dataset?.opp;
    if (!key) return;
    if (e.target.open) openOpponents.add(key);
    else openOpponents.delete(key);
  }, true);

  const onKey = e => {
    if (e.key === "Escape") hideTip();
  };
  document.addEventListener("keydown", onKey);

  const unsubscribe = subscribe(state => {
    if (state.data === drawnData && state.data) return;
    draw();
    refreshSheet();
    if (openOnLoad && state.data) {
      openCompetition(openOnLoad);
      openOnLoad = null;
    }
  });

  draw();
  if (openOnLoad && getState().data) {
    openCompetition(openOnLoad);
    openOnLoad = null;
  }

  return () => {
    unsubscribe();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onPointerDown);
    hideTip();
    closeSheet(true);
  };
}

function initials(name) {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || "") + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase();
}

function skeleton() {
  return `<section class="view">
    <div class="skeleton" style="height:90px;margin-top:10px"></div>
    <div class="skeleton" style="height:300px;margin-top:22px"></div>
    <div class="skeleton" style="height:180px;margin-top:22px"></div>
  </section>`;
}
