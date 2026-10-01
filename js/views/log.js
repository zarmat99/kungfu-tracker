import { getState, subscribe, commit, errorMessage } from "../store.js";
import { TYPES } from "../types.js";
import { today, addDays, relativeDay, fmtLongDate, fmtDuration, esc } from "../format.js";
import { icon } from "../icons.js";
import { toast, stamp } from "../ui.js";
import { navigate } from "../router.js";

const GRID_TYPES = ["taichi-yiquan", "combat", "shaolin", "xingyi"];
const QUICK_MINUTES = [60, 90, 105, 120, 180, 240];

export function renderLog(root, params) {
  const editId = params.get("id");
  if (editId && !getState().data) {
    // opened directly on an edit link: wait for the data
    root.innerHTML = `<section class="view"><div class="skeleton" style="height:420px;margin-top:20px"></div></section>`;
    const unsubscribe = subscribe(state => {
      if (!state.data) return;
      unsubscribe();
      renderLog(root, params);
    });
    return unsubscribe;
  }

  const editing = editId ? getState().data.sessions.find(s => s.id === editId) : null;
  if (editId && !editing) {
    root.innerHTML = `<section class="view">
      <div class="view-title"><span class="cn" aria-hidden="true">记录</span><p class="eyebrow">Modifica</p><h1>Non trovata</h1></div>
      <div class="notice">Questa sessione non esiste più: forse è stata eliminata.<a class="btn btn-ghost" href="#/calendar">Torna al calendario</a></div>
    </section>`;
    return;
  }

  const form = editing
    ? { date: editing.date, type: editing.type, duration: editing.duration, title: editing.title || "", notes: editing.notes || "" }
    : { date: params.get("date") || today(), type: "taichi-yiquan", duration: TYPES["taichi-yiquan"].duration, title: "", notes: "" };
  let saving = false;

  root.innerHTML = `
    <section class="view log">
      <div class="view-title">
        <span class="cn" aria-hidden="true">记录</span>
        <p class="eyebrow">${editing ? "Modifica sessione" : "Nuova sessione"}</p>
        <h1>${editing ? "Modifica" : "Registra"}</h1>
      </div>
      <form class="form" novalidate>
        <div>
          <p class="field-label">Quando</p>
          <div class="card date-card">
            <div><div class="big" data-date-label></div><div class="small" data-date-sub></div></div>
            <div class="date-chips">
              <button type="button" class="chip" data-when="today">Oggi</button>
              <button type="button" class="chip" data-when="yesterday">Ieri</button>
              <label class="chip" data-when="other">Altro<input type="date" name="date" aria-label="Scegli il giorno"></label>
            </div>
          </div>
        </div>
        <div>
          <p class="field-label">Tipo di lezione</p>
          <div class="types">
            ${GRID_TYPES.map(typeCard).join("")}
            ${editing ? "" : doubleCard()}
            ${typeCard("event", "wide")}
          </div>
        </div>
        <div data-title-field hidden>
          <p class="field-label">Nome dell'evento</p>
          <input class="input" name="title" placeholder="Es. Symposium 2026" autocomplete="off">
        </div>
        <div>
          <p class="field-label"><span>Durata</span><span data-duration-hint></span></p>
          <div class="card duration">
            <button type="button" class="round-btn" data-step="-15" aria-label="Meno 15 minuti">${icon("minus")}</button>
            <output data-duration aria-live="polite"></output>
            <button type="button" class="round-btn" data-step="15" aria-label="Più 15 minuti">${icon("plus")}</button>
          </div>
          <div class="chips">${QUICK_MINUTES.map(m => `<button type="button" class="chip" data-minutes="${m}">${fmtDuration(m)}</button>`).join("")}</div>
        </div>
        <div>
          <p class="field-label">Note</p>
          <textarea class="input" name="notes" rows="4" placeholder="Cosa avete fatto? Forme, esercizi, compagni, correzioni del maestro…"></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" data-save></button>
          ${editing ? `<a class="btn btn-ghost" href="#/calendar?m=${editing.date.slice(0, 7)}&d=${editing.date}">Annulla</a>` : ""}
        </div>
      </form>
    </section>`;

  const $ = sel => root.querySelector(sel);
  const dateInput = $("input[name=date]");
  const titleInput = $("input[name=title]");
  const notesInput = $("textarea[name=notes]");
  const saveButton = $("[data-save]");
  titleInput.value = form.title;
  notesInput.value = form.notes;

  function whenOf(date) {
    if (date === today()) return "today";
    if (date === addDays(today(), -1)) return "yesterday";
    return "other";
  }

  function update() {
    $("[data-date-label]").textContent = fmtLongDate(form.date);
    $("[data-date-sub]").textContent = `${relativeDay(form.date)} · ${form.date.slice(0, 4)}`;
    const when = whenOf(form.date);
    root.querySelectorAll("[data-when]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.when === when)));
    dateInput.value = form.date;

    root.querySelectorAll("[data-type]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.type === form.type)));
    $("[data-title-field]").hidden = form.type !== "event";

    const double = form.type === "double";
    $("[data-duration]").innerHTML = `${fmtDuration(form.duration)}<small>${double ? "per ciascuna parte" : "durata"}</small>`;
    $("[data-duration-hint]").textContent = double ? `Totale ${fmtDuration(form.duration * 2)}` : "";
    root.querySelectorAll("[data-minutes]").forEach(el => el.setAttribute("aria-pressed", String(Number(el.dataset.minutes) === form.duration)));
  }

  function setSaving(on) {
    saving = on;
    saveButton.disabled = on;
    saveButton.innerHTML = on
      ? `<span class="spinner"></span><span>Salvo su GitHub…</span>`
      : `${icon("check")}<span>${editing ? "Salva modifiche" : "Salva"}</span>`;
  }

  root.addEventListener("click", e => {
    const when = e.target.closest("[data-when]");
    if (when) {
      if (when.dataset.when === "today") form.date = today();
      else if (when.dataset.when === "yesterday") form.date = addDays(today(), -1);
      else if (matchMedia("(pointer: fine)").matches) {
        try { dateInput.showPicker(); } catch { /* the native control opens on its own */ }
        return;
      } else return;
      return update();
    }
    const type = e.target.closest("[data-type]");
    if (type) {
      form.type = type.dataset.type;
      if (!editing) form.duration = form.type === "double" ? 90 : TYPES[form.type].duration;
      update();
      if (form.type === "event") titleInput.focus();
      return;
    }
    const step = e.target.closest("[data-step]");
    if (step) {
      form.duration = Math.min(600, Math.max(15, form.duration + Number(step.dataset.step)));
      return update();
    }
    const minutes = e.target.closest("[data-minutes]");
    if (minutes) {
      form.duration = Number(minutes.dataset.minutes);
      return update();
    }
  });

  dateInput.addEventListener("change", () => {
    if (dateInput.value) form.date = dateInput.value;
    update();
  });
  titleInput.addEventListener("input", () => { form.title = titleInput.value; });
  notesInput.addEventListener("input", () => {
    form.notes = notesInput.value;
    notesInput.style.height = "auto";
    notesInput.style.height = `${notesInput.scrollHeight + 2}px`;
  });

  $("form").addEventListener("submit", async e => {
    e.preventDefault();
    if (saving) return;
    const title = form.title.trim();
    const notes = form.notes.trim();
    if (form.type === "event" && !title) {
      toast("Dai un nome all'evento", "error");
      titleInput.focus();
      return;
    }
    const now = Date.now();
    const session = (type, extra = {}) => ({
      date: form.date,
      type,
      duration: form.duration,
      ...(type === "event" ? { title } : {}),
      notes,
      ...extra,
    });

    let mutate, message;
    if (editing) {
      mutate = d => {
        const i = d.sessions.findIndex(s => s.id === editing.id);
        if (i < 0) throw new Error("Questa sessione non esiste più");
        const old = d.sessions[i];
        d.sessions[i] = { id: old.id, ...session(form.type), createdAt: old.createdAt, updatedAt: now };
      };
      message = `Edit session ${form.date} (${form.type})`;
    } else if (form.type === "double") {
      mutate = d => d.sessions.push(
        { id: crypto.randomUUID(), ...session("taichi-yiquan"), createdAt: now },
        { id: crypto.randomUUID(), ...session("shaolin"), createdAt: now + 1 },
      );
      message = `Log double lesson ${form.date}`;
    } else {
      mutate = d => d.sessions.push({ id: crypto.randomUUID(), ...session(form.type), createdAt: now });
      message = `Log session ${form.date} (${form.type})`;
    }

    setSaving(true);
    try {
      await commit(mutate, message);
      stamp("功");
      toast(editing ? "Modifiche salvate" : form.type === "double" ? "Lezione doppia salvata" : "Sessione salvata");
      setTimeout(() => navigate(`#/calendar?m=${form.date.slice(0, 7)}&d=${form.date}`), 700);
    } catch (err) {
      toast(errorMessage(err), "error");
      setSaving(false);
    }
  });

  setSaving(false);
  update();
}

function typeCard(key, extra = "") {
  const t = TYPES[key];
  return `<button type="button" class="type ${extra}" style="--c:${t.color}" data-type="${key}" aria-pressed="false">
    <span class="t-glyph">${t.glyph}</span>
    <span><span class="t-label">${esc(t.label)}</span><span class="t-sub">${esc(t.sub)}</span></span>
  </button>`;
}

function doubleCard() {
  return `<button type="button" class="type wide double" data-type="double" aria-pressed="false">
    <span class="t-glyph">太极<span>+</span>少林</span>
    <span><span class="t-label">Lezione doppia</span><span class="t-sub">Taichi e Yiquan + Shaolin · 2 sessioni</span></span>
  </button>`;
}
