import { getState, subscribe, commit, load, errorMessage } from "../store.js";
import { typeOf, MEDALS, LEVELS } from "../types.js";
import { MONTHS, CN_MONTHS, WEEKDAYS, WEEKDAY_INITIALS, pad, iso, today, parseISO, cap, fmtDuration, fmtNum, fmtLongDate, esc } from "../format.js";
import { icon } from "../icons.js";
import { openSheet, closeSheet, sheetBody, toast, armConfirm } from "../ui.js";
import { groupByDate, summarize } from "../stats.js";
import { navigate } from "../router.js";

export function renderCalendar(root, params) {
  const now = today();
  let [year, month] = (params.get("m") || (params.get("d") || now).slice(0, 7)).split("-").map(Number);
  month -= 1;
  let flashDay = params.get("d");
  let sheetDay = null;
  let slide = "";
  let animate = true;
  let drawnData;

  function draw() {
    const { data, status, error } = getState();
    drawnData = data;
    if (!data) {
      root.innerHTML = status === "error"
        ? `<section class="view"><div class="notice">${esc(errorMessage(error))}<button class="btn btn-ghost" data-retry>${icon("refresh")} Riprova</button></div></section>`
        : skeleton();
      return;
    }
    const prefix = `${year}-${pad(month + 1)}`;
    const sessions = data.sessions.filter(s => s.date.startsWith(prefix));
    const comps = data.competitions.filter(c => c.date.startsWith(prefix));
    const sum = summarize(sessions);

    root.innerHTML = `
      <section class="${animate && !slide ? "view " : ""}calendar">
        <div class="month-head">
          <button class="icon-btn" data-nav="-1" aria-label="Mese precedente">${icon("left")}</button>
          <div class="month-title ${slide}">
            <span class="cn" aria-hidden="true">${CN_MONTHS[month]}</span>
            <span class="month-name">${cap(MONTHS[month])}</span>
            <span class="month-year">${year}</span>
          </div>
          <button class="icon-btn" data-nav="1" aria-label="Mese successivo">${icon("right")}</button>
        </div>
        <div class="stats ${slide}">
          <div class="stat"><b>${sum.count}</b><span>Sessioni</span></div>
          <div class="stat"><b>${fmtNum(sum.minutes / 60)}</b><span>Ore</span></div>
          <div class="stat"><b>${sum.days}</b><span>Giorni</span></div>
        </div>
        ${typeBar(sum)}
        <div class="weekdays">${WEEKDAY_INITIALS.map(d => `<span>${d}</span>`).join("")}</div>
        <div class="grid ${slide}">${cells(groupByDate(sessions), groupByDate(comps))}</div>
        <div class="section-title"><h2>Sessioni di ${MONTHS[month]}</h2><span>${sum.count ? fmtDuration(sum.minutes) : ""}</span></div>
        ${timeline(sessions, comps)}
      </section>`;
    slide = "";
    animate = false;
  }

  function typeBar(sum) {
    const entries = Object.entries(sum.byType).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return `<div class="typebar none"><i></i></div>`;
    return `
      <div class="typebar">${entries.map(([k, m]) => `<i style="--c:${typeOf(k).color};flex:${m}"></i>`).join("")}</div>
      <div class="legend">${entries.map(([k, m]) => `<span style="--c:${typeOf(k).color}">${typeOf(k).label} <b>${fmtNum(m / 60)} h</b></span>`).join("")}</div>`;
  }

  function cells(byDate, compsByDate) {
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const total = Math.ceil((offset + daysInMonth) / 7) * 7;
    let html = "";
    for (let i = 0; i < total; i++) {
      const date = new Date(year, month, i - offset + 1);
      if (date.getMonth() !== month) {
        html += `<div class="day out"><span class="num">${date.getDate()}</span></div>`;
        continue;
      }
      const ds = iso(date);
      const ss = byDate.get(ds) || [];
      const cs = compsByDate.get(ds) || [];
      const colors = [...new Set(ss.map(s => typeOf(s.type).color))];
      if (cs.length) colors.unshift("var(--c-gold)");
      const cls = ["day", colors.length && "has", ds === now && "today", ds === sheetDay && "selected", ds === flashDay && "flash"].filter(Boolean).join(" ");
      const style = colors.length ? `--c1:${colors[0]};--c2:${colors[1] || colors[0]}` : "";
      const label = `${fmtLongDate(ds)}${ss.length ? `, ${ss.length} ${ss.length === 1 ? "sessione" : "sessioni"}` : ""}${cs.length ? ", gara" : ""}`;
      html += `<button class="${cls}" style="${style}" data-day="${ds}" aria-label="${label}">
        <span class="num">${date.getDate()}</span>
        ${cs.length ? icon("star", "star") : ""}
        <span class="marks">${ss.slice(0, 4).map(s => `<i style="--c:${typeOf(s.type).color}"></i>`).join("")}</span>
      </button>`;
    }
    return html;
  }

  function timeline(sessions, comps) {
    const items = [
      ...sessions.map(s => ({ date: s.date, at: s.createdAt || 0, html: i => sessionEntry(s, i) })),
      ...comps.map(c => ({ date: c.date, at: -1, html: i => compEntry(c, i) })),
    ].sort((a, b) => b.date.localeCompare(a.date) || a.at - b.at);
    if (!items.length) return `<div class="card empty"><span class="cn" aria-hidden="true">空</span>Nessuna sessione a ${MONTHS[month]}</div>`;
    return `<ol class="timeline${animate ? " animate" : ""}">${items.map((it, i) => it.html(Math.min(i, 14))).join("")}</ol>`;
  }

  function entryDate(ds) {
    const d = parseISO(ds);
    return `<div class="entry-date"><b>${d.getDate()}</b><span>${WEEKDAYS[d.getDay()].slice(0, 3)}</span></div>`;
  }

  function sessionEntry(s, i) {
    const t = typeOf(s.type);
    return `<li class="entry" style="--c:${t.color};--i:${i}" data-day="${s.date}">
      <span class="watermark" aria-hidden="true">${t.glyph}</span>
      ${entryDate(s.date)}
      <div>
        <div class="entry-top"><span class="glyph">${t.glyph}</span><span class="label">${esc(s.title || t.label)}</span><span class="dur">${fmtDuration(s.duration)}</span></div>
        ${s.notes ? `<p class="entry-notes">${esc(s.notes)}</p>` : ""}
      </div>
    </li>`;
  }

  function compEntry(c, i) {
    return `<li class="entry comp" style="--i:${i}" data-day="${c.date}">
      <span class="watermark" aria-hidden="true">赛</span>
      ${entryDate(c.date)}
      <div>
        <div class="entry-top"><span class="glyph">赛</span><span class="label">${esc(c.name)}</span></div>
        <p class="entry-notes">${esc(c.location)} <span class="medal-row">${c.specialties.map(sp => `<span class="medal medal-${sp.medal}" title="${esc(sp.name)}"></span>`).join("")}</span></p>
      </div>
    </li>`;
  }

  // ---------- day sheet ----------

  function daySheet(ds) {
    const { data } = getState();
    const ss = data.sessions.filter(s => s.date === ds);
    const cs = data.competitions.filter(c => c.date === ds);
    const d = parseISO(ds);
    const total = ss.reduce((sum, s) => sum + s.duration, 0);
    return `
      <div class="sheet-head">
        <div>
          <p class="eyebrow">${cap(WEEKDAYS[d.getDay()])}${total ? ` · ${fmtDuration(total)}` : ""}</p>
          <h2>${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}</h2>
        </div>
        <button class="icon-btn" data-close aria-label="Chiudi">${icon("x")}</button>
      </div>
      <div class="sheet-list">
        ${cs.map((c, i) => compCard(c, i)).join("")}
        ${ss.map((s, i) => sessionCard(s, i + cs.length)).join("")}
        ${ss.length || cs.length ? "" : `<div class="empty"><span class="cn" aria-hidden="true">空</span>Nessuna sessione in questo giorno</div>`}
      </div>
      <button class="btn btn-primary" data-add="${ds}">${icon("plus")} Aggiungi sessione</button>`;
  }

  function sessionCard(s, i) {
    const t = typeOf(s.type);
    return `<article class="s-card" style="--c:${t.color};--i:${i}">
      <span class="watermark" aria-hidden="true">${t.glyph}</span>
      <p class="s-type">${t.label}</p>
      ${s.title ? `<h3 class="s-title">${esc(s.title)}</h3>` : ""}
      <p class="s-meta">${icon("clock")} ${fmtDuration(s.duration)}</p>
      ${s.notes ? `<p class="s-notes">${esc(s.notes)}</p>` : ""}
      <div class="s-actions">
        <button class="chip-btn" data-edit="${s.id}">${icon("pencil")} Modifica</button>
        <button class="chip-btn danger" data-delete="${s.id}">${icon("trash")} Elimina</button>
      </div>
    </article>`;
  }

  function compCard(c, i) {
    return `<article class="s-card c-card" style="--i:${i}">
      <span class="watermark" aria-hidden="true">赛</span>
      <p class="s-type">${LEVELS[c.level] || "Gara"}</p>
      <h3 class="s-title">${esc(c.name)}</h3>
      <p class="s-meta">${icon("pin")} ${esc(c.location)}${c.category ? ` · ${esc(c.category)}` : ""}</p>
      <ul class="medals">${c.specialties.map(sp => `<li><span class="medal medal-${sp.medal}"></span>${esc(sp.name)} <span class="muted">${MEDALS[sp.medal] || ""}</span></li>`).join("")}</ul>
    </article>`;
  }

  function openDay(ds) {
    sheetDay = ds;
    flashDay = null;
    root.querySelectorAll(".day.selected").forEach(el => el.classList.remove("selected"));
    root.querySelector(`.day[data-day="${ds}"]`)?.classList.add("selected");
    const body = openSheet(daySheet(ds));
    body.addEventListener("click", onSheetClick);
  }

  function refreshSheet() {
    const body = sheetBody();
    if (!body || !sheetDay) return;
    body.innerHTML = daySheet(sheetDay);
    body.querySelector(".sheet-list")?.classList.add("static");
  }

  function onSheetClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    if ("close" in btn.dataset) return closeSheet();
    if (btn.dataset.add) return navigate(`#/log?date=${btn.dataset.add}`);
    if (btn.dataset.edit) return navigate(`#/log?id=${btn.dataset.edit}`);
    if (btn.dataset.delete) {
      armConfirm(btn, "Conferma", async () => {
        const s = getState().data.sessions.find(x => x.id === btn.dataset.delete);
        if (!s) return;
        btn.disabled = true;
        try {
          await commit(d => { d.sessions = d.sessions.filter(x => x.id !== s.id); }, `Delete session ${s.date} (${s.type})`);
          toast("Sessione eliminata");
        } catch (err) {
          toast(errorMessage(err), "error");
          btn.disabled = false;
        }
      });
    }
  }

  // ---------- navigation ----------

  function go(delta) {
    month += delta;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    slide = delta > 0 ? "month-slide-next" : "month-slide-prev";
    animate = true;
    flashDay = null;
    history.replaceState(null, "", `#/calendar?m=${year}-${pad(month + 1)}`);
    draw();
  }

  root.addEventListener("click", e => {
    const nav = e.target.closest("[data-nav]");
    if (nav) return go(Number(nav.dataset.nav));
    const day = e.target.closest("[data-day]");
    if (day) return openDay(day.dataset.day);
    if (e.target.closest("[data-retry]")) load().catch(err => toast(errorMessage(err), "error"));
  });

  let touch = null;
  root.addEventListener("touchstart", e => {
    touch = e.target.closest(".grid, .month-head") ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  root.addEventListener("touchend", e => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  const onKey = e => {
    if (document.querySelector(".sheet-wrap") || e.target.closest("input, textarea")) return;
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };
  document.addEventListener("keydown", onKey);

  const unsubscribe = subscribe(state => {
    if (state.data === drawnData && state.data) return;
    draw();
    refreshSheet();
  });

  draw();
  if (params.get("open") && flashDay && getState().data) openDay(flashDay);

  return () => {
    unsubscribe();
    document.removeEventListener("keydown", onKey);
    closeSheet(true);
  };
}

function skeleton() {
  return `<section class="view">
    <div class="month-head"><span></span><div class="skeleton" style="height:84px"></div><span></span></div>
    <div class="stats">${'<div class="skeleton" style="height:80px"></div>'.repeat(3)}</div>
    <div class="skeleton" style="height:330px;margin-top:46px"></div>
  </section>`;
}
