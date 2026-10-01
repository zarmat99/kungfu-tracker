import { getState, subscribe, commit, load, errorMessage } from "../store.js";
import { MEDALS, MEDAL_PLURALS, MEDAL_KEYS, LEVELS, LEVEL_CHOICES, RESULTS } from "../types.js";
import { MONTHS_SHORT, today, parseISO, daysBetween, fmtShortDate, whenLabel, plural, esc } from "../format.js";
import { icon } from "../icons.js";
import { openSheet, closeSheet, sheetBody, toast, armConfirm, showTip, hideTip } from "../ui.js";
import { hasResults, upcoming, awaitingResults, withResults, palmares, bySpecialty, opponents, roundsByNumber, roundOutcome } from "../competition-stats.js";

const OPPONENTS_SHOWN = 5;
const OUTCOMES = { won: { label: "Vinto", mark: "V" }, draw: { label: "Pari", mark: "=" }, lost: { label: "Perso", mark: "P" } };

const q = id => encodeURIComponent(id);
const editLink = c => `#/competition-edit?id=${q(c.id)}`;

export function renderCompetitions(root, params) {
  let drawnData;
  let animate = true;
  let sheetId = null; // the competition shown in the sheet
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
    sheetId = id;
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

  function refreshSheet() {
    const body = sheetBody();
    if (!body || !sheetId) return;
    const c = getState().data.competitions.find(x => x.id === sheetId);
    if (!c) return closeSheet();
    body.innerHTML = competitionSheet(c);
    body.querySelector(".sheet-list")?.classList.add("static");
  }

  // ---------- events ----------

  root.addEventListener("click", e => {
    if (e.target.closest("a, summary")) return;
    const tipped = e.target.closest("[data-tip]");
    if (tipped) return showTip(tipped.getBoundingClientRect(), tipped.dataset.tip, tipped.dataset.tipLabel);
    const open = e.target.closest("[data-open]");
    if (open) return openCompetition(open.dataset.open);
    if (e.target.closest("[data-all-opponents]")) {
      allOpponents = true;
      return draw();
    }
    if (e.target.closest("[data-retry]")) load().catch(err => toast(errorMessage(err), "error"));
  });

  root.addEventListener("focusin", e => {
    const tipped = e.target.closest("[data-tip]");
    if (tipped && tipped.matches(":focus-visible")) showTip(tipped.getBoundingClientRect(), tipped.dataset.tip, tipped.dataset.tipLabel);
  });
  root.addEventListener("focusout", e => {
    if (e.target.closest("[data-tip]")) hideTip();
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
