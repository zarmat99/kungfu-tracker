import { getState, subscribe, commit, errorMessage } from "../store.js";
import { MEDALS, MEDAL_KEYS, LEVEL_CHOICES, SPECIALTIES } from "../types.js";
import { today, relativeDay, fmtLongDate, esc } from "../format.js";
import { icon } from "../icons.js";
import { toast, stamp, armConfirm } from "../ui.js";
import { navigate } from "../router.js";
import { opponents } from "../competition-stats.js";

const newMatch = () => ({ opponent: "", result: null, notes: "", rounds: [{ me: "", opponent: "" }] });

export function renderCompetitionForm(root, params) {
  if (!getState().data) {
    // opened directly on this page: wait for the data
    root.innerHTML = `<section class="view"><div class="skeleton" style="height:520px;margin-top:20px"></div></section>`;
    const unsubscribe = subscribe(state => {
      if (!state.data) return;
      unsubscribe();
      renderCompetitionForm(root, params);
    });
    return unsubscribe;
  }

  const comps = getState().data.competitions;
  const editId = params.get("id");
  const editing = editId ? comps.find(c => c.id === editId) : null;
  if (editId && !editing) {
    root.innerHTML = `<section class="view">
      <div class="view-title"><span class="cn" aria-hidden="true">赛</span><p class="eyebrow">Modifica</p><h1>Non trovata</h1></div>
      <div class="notice">Questa gara non esiste più: forse è stata eliminata.<a class="btn btn-ghost" href="#/competitions">Torna alle gare</a></div>
    </section>`;
    return;
  }

  const latest = [...comps].sort((a, b) => b.date.localeCompare(a.date))[0];
  const form = editing
    ? {
        name: editing.name || "",
        date: editing.date,
        dateTbc: Boolean(editing.dateTbc),
        location: editing.location || "",
        level: editing.level || "national",
        category: editing.category || "",
        prep: editing.prep || "",
        notes: editing.notes || "",
        // copies, so the saved competition keeps any field this form doesn't know about
        specialties: editing.specialties.map(sp => ({
          ...sp,
          matches: sp.matches.map(m => ({ ...m, rounds: m.rounds.map(r => ({ ...r, me: String(r.me ?? ""), opponent: String(r.opponent ?? "") })) })),
        })),
      }
    : { name: "", date: params.get("date") || today(), dateTbc: false, location: "", level: "national", category: latest?.category || "", prep: "", notes: "", specialties: [] };
  let saving = false;

  const suggestions = values => [...new Map(values.map(v => (v || "").trim()).filter(Boolean).map(v => [v.toLowerCase(), v])).values()];
  const datalist = (id, values) => `<datalist id="${id}">${suggestions(values).map(v => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;
  const backHref = editing ? `#/competitions?open=${encodeURIComponent(editing.id)}` : "#/competitions";

  root.innerHTML = `
    <section class="view comp-form">
      <div class="view-title">
        <span class="cn" aria-hidden="true">赛</span>
        <p class="eyebrow">${editing ? "Modifica gara" : "Nuova gara"}</p>
        <h1>${editing ? "Modifica" : "Gara"}</h1>
      </div>
      <form class="form" novalidate>
        <div>
          <p class="field-label">Nome della gara</p>
          <input class="input" name="name" list="dl-names" placeholder="Es. Campionato Nazionale CKA-CSEN" autocomplete="off">
        </div>
        <div>
          <p class="field-label">Quando</p>
          <div class="card date-card">
            <div><div class="big" data-date-label></div><div class="small" data-date-sub></div></div>
            <label class="chip date-pick">${icon("calendar")} Cambia giorno<input type="date" name="date" aria-label="Scegli il giorno"></label>
            <label class="switch-row">
              <span><b>Data da confermare</b><small>Il conto alla rovescia sarà indicativo</small></span>
              <input type="checkbox" class="switch" name="tbc">
            </label>
          </div>
        </div>
        <div class="two">
          <div>
            <p class="field-label">Dove</p>
            <input class="input" name="location" list="dl-locations" placeholder="Es. Perugia" autocomplete="off">
          </div>
          <div>
            <p class="field-label">Categoria</p>
            <input class="input" name="category" list="dl-categories" placeholder="Es. 80–85 kg" autocomplete="off">
          </div>
        </div>
        <div>
          <p class="field-label">Livello</p>
          <div class="seg">${Object.entries(LEVEL_CHOICES).map(([k, label]) => `<button type="button" class="chip" data-level="${k}" aria-pressed="false">${label}</button>`).join("")}</div>
        </div>
        <div>
          <p class="field-label">Preparazione</p>
          <textarea class="input" name="prep" rows="3" placeholder="Obiettivi, cosa allenare, regolamento, iscrizione, viaggio…"></textarea>
        </div>
        <p class="results-later" data-results-later>${icon("clock")} I risultati li aggiungi dopo la gara.</p>
        <div data-results-block>
          <p class="field-label">Risultati</p>
          <div class="results" data-results></div>
        </div>
        <div data-notes-block>
          <p class="field-label">Com'è andata</p>
          <textarea class="input" name="notes" rows="3" placeholder="Sensazioni, cosa ha funzionato, cosa migliorare…"></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" data-save></button>
          <a class="btn btn-ghost" href="${backHref}">Annulla</a>
        </div>
      </form>
      ${datalist("dl-names", comps.map(c => c.name))}
      ${datalist("dl-locations", comps.map(c => c.location))}
      ${datalist("dl-categories", comps.map(c => c.category))}
      ${datalist("dl-opponents", opponents(comps).map(o => o.name))}
    </section>`;

  const $ = sel => root.querySelector(sel);
  const resultsEl = $("[data-results]");
  const dateInput = $("input[name=date]");
  const tbcInput = $("input[name=tbc]");
  const saveButton = $("[data-save]");
  for (const name of ["name", "location", "category", "prep", "notes"]) $(`[name=${name}]`).value = form[name];
  tbcInput.checked = form.dateTbc;

  // ---------- results editor ----------

  function renderResults() {
    resultsEl.innerHTML = form.specialties.map(specialtyEditor).join("") + addSpecialtyBar();
    resultsEl.querySelectorAll("textarea").forEach(fit);
  }

  function specialtyEditor(sp, i) {
    return `<article class="sp-editor">
      <div class="sp-editor-head">
        <input class="input title-input" data-field="sp-name" data-sp="${i}" value="${esc(sp.name)}" placeholder="Nome della specialità" aria-label="Specialità" autocomplete="off">
        <button type="button" class="chip-btn danger" data-remove-sp="${i}" aria-label="Togli la specialità">${icon("trash")}</button>
      </div>
      <div class="medal-pick" role="group" aria-label="Medaglia">
        ${MEDAL_KEYS.map(m => `<button type="button" class="chip" data-medal="${m}" data-sp="${i}" aria-pressed="${sp.medal === m}"><span class="medal medal-${m}"></span>${MEDALS[m]}</button>`).join("")}
        <button type="button" class="chip" data-medal="" data-sp="${i}" aria-pressed="${!MEDALS[sp.medal]}"><span class="medal medal-none"></span>Nessuna</button>
      </div>
      <div class="match-editors">${sp.matches.map((m, j) => matchEditor(m, i, j)).join("")}</div>
      <button type="button" class="chip-btn add-match" data-add-match="${i}">${icon("plus")} Aggiungi incontro</button>
      <textarea class="input note-input" rows="1" data-field="sp-notes" data-sp="${i}" placeholder="Note sulla specialità">${esc(sp.notes || "")}</textarea>
    </article>`;
  }

  function matchEditor(m, i, j) {
    const at = `data-sp="${i}" data-m="${j}"`;
    return `<div class="match-editor">
      <div class="me-head">
        <span class="me-num" aria-hidden="true">${j + 1}</span>
        <input class="input" data-field="m-opponent" ${at} value="${esc(m.opponent || "")}" list="dl-opponents" placeholder="Avversario" aria-label="Avversario dell'incontro ${j + 1}" autocomplete="off">
        <button type="button" class="icon-btn" data-remove-match="${i}.${j}" aria-label="Togli l'incontro ${j + 1}">${icon("x")}</button>
      </div>
      <div class="result-pick" role="group" aria-label="Risultato">
        <button type="button" class="chip result-chip won" data-result="won" ${at} aria-pressed="${m.result === "won"}">Vinto</button>
        <button type="button" class="chip result-chip lost" data-result="lost" ${at} aria-pressed="${m.result === "lost"}">Perso</button>
      </div>
      ${m.rounds.length ? `<div class="round-editors">
        <div class="round-editor round-head" aria-hidden="true"><span></span><span>Tu</span><span></span><span>Avv.</span><span></span></div>
        ${m.rounds.map((r, k) => roundEditor(r, i, j, k)).join("")}
      </div>` : ""}
      <button type="button" class="chip-btn" data-add-round="${i}.${j}">${icon("plus")} Round</button>
      <textarea class="input note-input" rows="1" data-field="m-notes" ${at} placeholder="Note sull'incontro">${esc(m.notes || "")}</textarea>
    </div>`;
  }

  function roundEditor(r, i, j, k) {
    const at = `data-sp="${i}" data-m="${j}" data-r="${k}"`;
    return `<div class="round-editor">
      <span class="re-label">R${k + 1}</span>
      <input class="input score" type="number" inputmode="numeric" min="0" step="1" data-field="r-me" ${at} value="${esc(r.me)}" aria-label="Round ${k + 1}: i tuoi punti">
      <span class="re-dash" aria-hidden="true">–</span>
      <input class="input score" type="number" inputmode="numeric" min="0" step="1" data-field="r-opp" ${at} value="${esc(r.opponent)}" aria-label="Round ${k + 1}: i punti dell'avversario">
      <button type="button" class="icon-btn small" data-remove-round="${i}.${j}.${k}" aria-label="Togli il round ${k + 1}">${icon("x")}</button>
    </div>`;
  }

  function addSpecialtyBar() {
    const used = new Set(form.specialties.map(sp => sp.name.trim().toLowerCase()));
    const choices = SPECIALTIES.filter(s => !used.has(s.toLowerCase()));
    return `<div class="add-sp">
      <p class="add-sp-label">${form.specialties.length ? "Un'altra specialità?" : "In quali specialità hai gareggiato?"}</p>
      <div class="add-sp-chips">
        ${choices.map(s => `<button type="button" class="chip" data-add-sp="${esc(s)}">${icon("plus")} ${esc(s)}</button>`).join("")}
        <button type="button" class="chip" data-add-sp="">${icon("plus")} Altra</button>
      </div>
    </div>`;
  }

  // ---------- top of the form ----------

  const resultsVisible = () => form.date <= today() || form.specialties.length > 0;

  function update() {
    const year = form.date.slice(0, 4);
    $("[data-date-label]").textContent = `${fmtLongDate(form.date)} ${year}`;
    $("[data-date-sub]").textContent = `${relativeDay(form.date)}${form.dateTbc ? " · giorno indicativo" : ""}`;
    dateInput.value = form.date;
    root.querySelectorAll("[data-level]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.level === form.level)));
    const results = resultsVisible();
    $("[data-results-block]").hidden = !results;
    $("[data-results-later]").hidden = results;
    $("[data-notes-block]").hidden = !results && !form.notes;
  }

  function setSaving(on) {
    saving = on;
    saveButton.disabled = on;
    saveButton.innerHTML = on
      ? `<span class="spinner"></span><span>Salvo su GitHub…</span>`
      : `${icon("check")}<span>${editing ? "Salva modifiche" : "Salva la gara"}</span>`;
  }

  const focus = (sel, { keyboard = true } = {}) => {
    const el = root.querySelector(sel);
    if (keyboard) el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const indexes = s => s.split(".").map(Number);

  root.addEventListener("click", e => {
    const el = e.target.closest("button");
    if (!el) return;
    const d = el.dataset;
    if (d.level) {
      form.level = d.level;
      return update();
    }
    if ("addSp" in d) {
      form.specialties.push({ name: d.addSp, medal: null, notes: "", matches: [newMatch()] });
      const i = form.specialties.length - 1;
      renderResults();
      update();
      // a known specialty: the next step is the medal, so just bring it into view
      return d.addSp ? focus(`.sp-editor:nth-child(${i + 1})`, { keyboard: false }) : focus(`[data-field="sp-name"][data-sp="${i}"]`);
    }
    if (d.removeSp) {
      const i = Number(d.removeSp);
      const drop = () => {
        form.specialties.splice(i, 1);
        renderResults();
        update();
      };
      const sp = form.specialties[i];
      const filled = sp.medal || sp.notes || sp.matches.some(m => m.opponent || m.result || m.notes || m.rounds.some(r => r.me !== "" || r.opponent !== ""));
      return filled ? armConfirm(el, "Togli", drop) : drop();
    }
    if ("medal" in d && d.sp) {
      form.specialties[Number(d.sp)].medal = d.medal || null;
      el.parentElement.querySelectorAll("[data-medal]").forEach(b => b.setAttribute("aria-pressed", String(b === el)));
      return;
    }
    if (d.result) {
      form.specialties[Number(d.sp)].matches[Number(d.m)].result = d.result;
      el.parentElement.querySelectorAll("[data-result]").forEach(b => b.setAttribute("aria-pressed", String(b === el)));
      return;
    }
    if (d.addMatch) {
      const i = Number(d.addMatch);
      form.specialties[i].matches.push(newMatch());
      renderResults();
      return focus(`[data-field="m-opponent"][data-sp="${i}"][data-m="${form.specialties[i].matches.length - 1}"]`);
    }
    if (d.removeMatch) {
      const [i, j] = indexes(d.removeMatch);
      form.specialties[i].matches.splice(j, 1);
      return renderResults();
    }
    if (d.addRound) {
      const [i, j] = indexes(d.addRound);
      const rounds = form.specialties[i].matches[j].rounds;
      rounds.push({ me: "", opponent: "" });
      renderResults();
      return focus(`[data-field="r-me"][data-sp="${i}"][data-m="${j}"][data-r="${rounds.length - 1}"]`);
    }
    if (d.removeRound) {
      const [i, j, k] = indexes(d.removeRound);
      form.specialties[i].matches[j].rounds.splice(k, 1);
      return renderResults();
    }
  });

  root.addEventListener("input", e => {
    const el = e.target;
    const field = el.dataset.field;
    if (el.tagName === "TEXTAREA") fit(el);
    if (!field) {
      if (el.name in form && typeof form[el.name] === "string" && el.name !== "date") form[el.name] = el.value;
      return;
    }
    const sp = form.specialties[Number(el.dataset.sp)];
    if (field === "sp-name") sp.name = el.value;
    else if (field === "sp-notes") sp.notes = el.value;
    else {
      const m = sp.matches[Number(el.dataset.m)];
      if (field === "m-opponent") m.opponent = el.value;
      else if (field === "m-notes") m.notes = el.value;
      else if (field === "r-me") m.rounds[Number(el.dataset.r)].me = el.value;
      else if (field === "r-opp") m.rounds[Number(el.dataset.r)].opponent = el.value;
    }
  });

  // a renamed specialty frees (or takes) its chip in the "add" bar
  root.addEventListener("change", e => {
    if (e.target.dataset.field === "sp-name") resultsEl.querySelector(".add-sp").outerHTML = addSpecialtyBar();
  });

  dateInput.addEventListener("change", () => {
    if (dateInput.value) form.date = dateInput.value;
    update();
  });
  $(".date-pick").addEventListener("click", () => {
    if (!matchMedia("(pointer: fine)").matches) return;
    try { dateInput.showPicker(); } catch { /* the native control opens on its own */ }
  });
  tbcInput.addEventListener("change", () => {
    form.dateTbc = tbcInput.checked;
    update();
  });

  // ---------- save ----------

  /** Turns the editor state into saved specialties, or says what is missing. */
  function buildSpecialties() {
    const specialties = [];
    for (const [i, sp] of form.specialties.entries()) {
      const name = sp.name.trim();
      if (!name) return { error: "Dai un nome alla specialità", focus: `[data-field="sp-name"][data-sp="${i}"]` };
      const matches = [];
      for (const [j, m] of sp.matches.entries()) {
        const opponent = (m.opponent || "").trim();
        const notes = (m.notes || "").trim();
        const scored = m.rounds.some(r => String(r.me).trim() || String(r.opponent).trim());
        if (!opponent && !m.result && !notes && !scored) continue; // left empty
        // problems are reported top to bottom, as the fields appear
        if (!m.result) return { error: "Indica se l'incontro è vinto o perso", focus: `[data-result][data-sp="${i}"][data-m="${j}"]` };
        const rounds = [];
        for (const [k, r] of m.rounds.entries()) {
          const me = String(r.me).trim(), opp = String(r.opponent).trim();
          if (!me && !opp) continue;
          const at = `[data-sp="${i}"][data-m="${j}"][data-r="${k}"]`;
          if (!/^\d{1,3}$/.test(me)) return { error: `Scrivi i tuoi punti del round ${k + 1}`, focus: `[data-field="r-me"]${at}` };
          if (!/^\d{1,3}$/.test(opp)) return { error: `Scrivi i punti dell'avversario nel round ${k + 1}`, focus: `[data-field="r-opp"]${at}` };
          rounds.push({ ...r, me: Number(me), opponent: Number(opp) });
        }
        matches.push({ ...m, opponent, result: m.result, notes, rounds });
      }
      specialties.push({ ...sp, name, medal: MEDALS[sp.medal] ? sp.medal : null, notes: (sp.notes || "").trim(), matches });
    }
    return { specialties };
  }

  $("form").addEventListener("submit", async e => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      toast("Dai un nome alla gara", "error");
      return focus("[name=name]");
    }
    const built = resultsVisible() ? buildSpecialties() : { specialties: [] };
    if (built.error) {
      toast(built.error, "error");
      return focus(built.focus);
    }
    const prep = form.prep.trim();
    const fields = {
      date: form.date,
      name,
      location: form.location.trim(),
      level: form.level,
      category: form.category.trim(),
      notes: form.notes.trim(),
      specialties: built.specialties,
    };
    const now = Date.now();
    const id = editing?.id || crypto.randomUUID();
    let mutate, message;
    if (editing) {
      mutate = d => {
        const i = d.competitions.findIndex(c => c.id === id);
        if (i < 0) throw new Error("Questa gara non esiste più");
        const next = { ...d.competitions[i], ...fields, updatedAt: now };
        if (form.dateTbc) next.dateTbc = true;
        else delete next.dateTbc;
        if (prep) next.prep = prep;
        else delete next.prep;
        d.competitions[i] = next;
      };
      message = `Edit competition ${form.date} (${name})`;
    } else {
      const { date, notes, specialties, ...rest } = fields;
      mutate = d => d.competitions.push({
        id,
        date,
        ...(form.dateTbc ? { dateTbc: true } : {}),
        ...rest,
        ...(prep ? { prep } : {}),
        notes,
        specialties,
        createdAt: now,
      });
      message = `Add competition ${form.date} (${name})`;
    }

    setSaving(true);
    try {
      await commit(mutate, message);
      stamp("赛");
      toast(editing ? "Gara aggiornata" : "Gara salvata");
      setTimeout(() => navigate(`#/competitions?open=${encodeURIComponent(id)}`), 700);
    } catch (err) {
      toast(errorMessage(err), "error");
      setSaving(false);
    }
  });

  renderResults();
  setSaving(false);
  update();
  root.querySelectorAll("textarea").forEach(fit);
}

/** Grows a textarea with its text. */
function fit(el) {
  if (!el.value) return void (el.style.height = "");
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}
