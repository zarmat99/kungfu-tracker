import { getState, subscribe, commit, errorMessage } from "../store.js";
import { today, relativeDay, whenLabel, esc } from "../format.js";
import { icon } from "../icons.js";
import { toast, stamp, armConfirm } from "../ui.js";
import { navigate } from "../router.js";

export function renderGoalForm(root, params) {
  if (!getState().data) {
    // opened directly on this page: wait for the data
    root.innerHTML = `<section class="view"><div class="skeleton" style="height:420px;margin-top:20px"></div></section>`;
    const unsubscribe = subscribe(state => {
      if (!state.data) return;
      unsubscribe();
      renderGoalForm(root, params);
    });
    return unsubscribe;
  }

  const editId = params.get("id");
  const editing = editId ? getState().data.goals.find(g => g.id === editId) : null;
  if (editId && !editing) {
    root.innerHTML = `<section class="view">
      <div class="view-title"><span class="cn" aria-hidden="true">标</span><p class="eyebrow">Modifica</p><h1>Non trovato</h1></div>
      <div class="notice">Questo traguardo non esiste più: forse è stato eliminato.<a class="btn btn-ghost" href="#/progress">Torna ai grafici</a></div>
    </section>`;
    return;
  }

  const form = editing
    ? { name: editing.name || "", date: editing.date, dateTbc: Boolean(editing.dateTbc), notes: editing.notes || "" }
    : { name: "", date: today(), dateTbc: false, notes: "" };
  let saving = false;

  root.innerHTML = `
    <section class="view goal-form">
      <div class="view-title">
        <span class="cn" aria-hidden="true">标</span>
        <p class="eyebrow">${editing ? "Modifica traguardo" : "Nuovo traguardo"}</p>
        <h1>${editing ? "Modifica" : "Traguardo"}</h1>
      </div>
      <form class="form" novalidate>
        <div>
          <p class="field-label">Nome del traguardo</p>
          <input class="input" name="name" placeholder="Es. Primo esame di grado" autocomplete="off">
        </div>
        <div>
          <p class="field-label">Quando</p>
          <div class="card date-card">
            <div><div class="big" data-date-label></div><div class="small" data-date-sub></div></div>
            <label class="chip date-pick">${icon("calendar")} Cambia data<input type="date" name="date" aria-label="Scegli il giorno"></label>
            <label class="switch-row">
              <span><b>Data da confermare</b><small>Si vede solo il mese, e il conto alla rovescia è indicativo</small></span>
              <input type="checkbox" class="switch" name="tbc">
            </label>
          </div>
        </div>
        <div>
          <p class="field-label">Note</p>
          <textarea class="input" name="notes" rows="3" placeholder="Programma, cosa preparare, cosa ha detto il maestro…"></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" data-save></button>
          <a class="btn btn-ghost" href="#/progress">Annulla</a>
        </div>
        ${editing ? `<div class="form-delete"><button type="button" class="chip-btn danger" data-delete>${icon("trash")} Elimina il traguardo</button></div>` : ""}
      </form>
    </section>`;

  const $ = sel => root.querySelector(sel);
  const nameInput = $("[name=name]");
  const dateInput = $("[name=date]");
  const tbcInput = $("[name=tbc]");
  const notesInput = $("[name=notes]");
  const saveButton = $("[data-save]");
  nameInput.value = form.name;
  notesInput.value = form.notes;
  tbcInput.checked = form.dateTbc;

  function update() {
    $("[data-date-label]").textContent = whenLabel(form);
    $("[data-date-sub]").textContent = `${relativeDay(form.date)}${form.dateTbc ? " · giorno indicativo" : ""}`;
    dateInput.value = form.date;
  }

  function setSaving(on) {
    saving = on;
    saveButton.disabled = on;
    saveButton.innerHTML = on
      ? `<span class="spinner"></span><span>Salvo su GitHub…</span>`
      : `${icon("check")}<span>${editing ? "Salva modifiche" : "Salva il traguardo"}</span>`;
  }

  nameInput.addEventListener("input", () => { form.name = nameInput.value; });
  notesInput.addEventListener("input", () => {
    form.notes = notesInput.value;
    fit(notesInput);
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

  $("form").addEventListener("submit", async e => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      toast("Dai un nome al traguardo", "error");
      nameInput.focus();
      return;
    }
    const notes = form.notes.trim();
    const now = Date.now();
    const id = editing?.id || crypto.randomUUID();
    let mutate, message;
    if (editing) {
      mutate = d => {
        const i = d.goals.findIndex(g => g.id === id);
        if (i < 0) throw new Error("Questo traguardo non esiste più");
        const next = { ...d.goals[i], date: form.date, name, notes, updatedAt: now };
        if (form.dateTbc) next.dateTbc = true;
        else delete next.dateTbc;
        d.goals[i] = next;
      };
      message = `Edit goal ${form.date} (${name})`;
    } else {
      mutate = d => d.goals.push({ id, date: form.date, ...(form.dateTbc ? { dateTbc: true } : {}), name, notes, createdAt: now });
      message = `Add goal ${form.date} (${name})`;
    }

    setSaving(true);
    try {
      await commit(mutate, message);
      stamp("标");
      toast(editing ? "Traguardo aggiornato" : "Traguardo salvato");
      setTimeout(() => navigate(`#/progress?goal=${encodeURIComponent(id)}`), 700);
    } catch (err) {
      toast(errorMessage(err), "error");
      setSaving(false);
    }
  });

  $("[data-delete]")?.addEventListener("click", e => {
    const button = e.currentTarget;
    armConfirm(button, "Conferma", async () => {
      button.disabled = true;
      try {
        await commit(d => { d.goals = d.goals.filter(g => g.id !== editing.id); }, `Delete goal ${editing.date} (${editing.name})`);
        toast("Traguardo eliminato");
        navigate("#/progress");
      } catch (err) {
        toast(errorMessage(err), "error");
        button.disabled = false;
      }
    });
  });

  setSaving(false);
  update();
  fit(notesInput);
}

/** Grows a textarea with its text. */
function fit(el) {
  if (!el.value) return void (el.style.height = "");
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}
