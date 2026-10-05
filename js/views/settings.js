import { getConfig, setConfig, isConnected, load, disconnect, getState, errorMessage, tokenDaysLeft, TOKEN_REMIND_DAYS, DEV, DEFAULTS } from "../store.js";
import { getNotes, loadNotes, forgetNotes } from "../notes.js";
import { icon } from "../icons.js";
import { toast, armConfirm } from "../ui.js";
import { navigate } from "../router.js";
import { esc, fmtRelative, fmtShortDate, plural, today } from "../format.js";

export function renderSettings(root) {
  let savedToast = null;

  function draw() {
    const cfg = getConfig();
    const connected = isConnected();
    root.innerHTML = `
      <section class="view settings">
        <div class="hero">
          <div class="seal"><span>功夫</span></div>
          <h1>${connected ? "Impostazioni" : "Collega i tuoi dati"}</h1>
          <p>${connected
            ? "La pagina legge e salva allenamenti e gare nel tuo repository privato su GitHub."
            : "Allenamenti e gare stanno nel tuo repository privato su GitHub. La pagina ci arriva con un token personale, che resta solo in questo browser."}</p>
        </div>
        <div class="settings-stack">
          ${DEV ? `<div class="dev-banner">Modalità sviluppo: i dati arrivano da <b>dev-data.json</b> e i salvataggi restano in questo browser.</div>` : ""}
          ${connected && !DEV ? statusCard(cfg) : ""}
          ${DEV ? "" : tokenForm(cfg, connected)}
          ${connected ? "" : steps(cfg)}
        </div>
      </section>`;
    root.querySelectorAll(".expiry-pick").forEach(showExpiry);
  }

  function statusCard(cfg) {
    const { data, syncedAt } = getState();
    return `<div class="card status-card">
      <div class="status-row"><span>Repository</span><b>${esc(cfg.repo)}</b></div>
      <div class="status-row"><span>File</span><b>${esc(cfg.path)}</b></div>
      <div class="status-row"><span>Ultima sincronizzazione</span><b>${fmtRelative(syncedAt)}</b></div>
      <div class="status-row"><span>Dati</span><b>${data ? `${data.sessions.length} sessioni · ${data.competitions.length} gare${data.goals.length ? ` · ${plural(data.goals.length, "traguardo", "traguardi")}` : ""}` : "—"}</b></div>
      <div class="status-row"><span>Conoscenza</span><b>${notesLine()}</b></div>
      ${expiryPick("current", cfg.tokenExpires, "Scadenza del token", "La trovi su GitHub, nella lista dei token. Una settimana prima ti avviso.")}
      <div class="status-actions">
        <button class="btn btn-ghost" data-reload>${icon("refresh")} Ricarica</button>
        <button class="btn btn-danger" data-disconnect>${icon("logout")} Scollega</button>
      </div>
    </div>`;
  }

  function notesLine() {
    const { notes } = getNotes();
    if (!notes) return "—";
    const count = [...notes.keys()].filter(path => path !== "README.md").length;
    return plural(count, "nota", "note");
  }

  /** A token's expiry: the date and how far it is, with a chip that opens the date picker. */
  function expiryPick(kind, value, title = "", note = "") {
    return `<div class="expiry-pick ${kind}">
      <div class="expiry-text">${title ? `<span>${title}</span>` : ""}<b data-expiry-value></b>${note ? `<small data-expiry-note>${note}</small>` : ""}</div>
      <label class="chip date-pick">${icon("calendar")}<span data-expiry-action></span><input type="date"${kind === "new" ? ` name="expires"` : ""} min="${today()}" value="${esc(value)}" aria-label="Scegli la scadenza del token"></label>
    </div>`;
  }

  function showExpiry(pick) {
    const date = pick.querySelector("input[type=date]").value;
    const days = tokenDaysLeft({ tokenExpires: date });
    const value = pick.querySelector("[data-expiry-value]");
    value.className = days === null ? "none" : days < 0 ? "expired" : days <= TOKEN_REMIND_DAYS ? "soon" : "";
    const left = days < 0 ? "scaduto" : days === 0 ? "oggi" : days === 1 ? "domani" : `tra ${days} giorni`;
    // a narrow box breaks the line after the dot, never inside the date or the days
    value.textContent = days === null ? "Non indicata" : `${fmtShortDate(date)} · ${left.replaceAll(" ", " ")}`;
    pick.querySelector("[data-expiry-action]").textContent = days === null ? "Scegli" : "Cambia";
    const note = pick.querySelector("[data-expiry-note]");
    if (note) note.hidden = days !== null;
  }

  function tokenForm(cfg, connected) {
    return `<form class="card token-form" novalidate>
      <label>${connected ? "Nuovo token (se vuoi cambiarlo)" : "Token GitHub"}
        <input class="input" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      </label>
      <div class="expiry-field"${connected ? " hidden" : ""}>
        <span class="expiry-title">${connected ? "Scadenza del nuovo token" : "Scadenza del token"}</span>
        ${expiryPick("new", "")}
        <small>GitHub la mostra quando generi il token. Una settimana prima ti avviso.</small>
      </div>
      ${connected ? `<p class="form-hint">Per rinnovarlo apri <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">i tuoi token su GitHub</a>: rigenera questo (Regenerate token) o creane uno nuovo con gli stessi permessi, poi incollalo qui sopra.</p>` : ""}
      <details>
        <summary>Avanzate</summary>
        <div class="row">
          <label>Repository <input class="input" name="repo" value="${esc(cfg.repo)}" spellcheck="false" autocomplete="off"></label>
          <label>File dei dati <input class="input" name="path" value="${esc(cfg.path)}" spellcheck="false" autocomplete="off"></label>
          <label>Branch <input class="input" name="branch" value="${esc(cfg.branch)}" spellcheck="false" autocomplete="off"></label>
        </div>
      </details>
      <button class="btn btn-primary" type="submit">${icon("key")}<span>${connected ? "Aggiorna" : "Collega"}</span></button>
    </form>`;
  }

  function steps(cfg) {
    const repoName = cfg.repo.split("/")[1] || cfg.repo;
    return `<ol class="steps">
      <li>Su GitHub apri <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained tokens → Generate new token</a>.</li>
      <li>In <b>Repository access</b> scegli <b>Only select repositories</b> e seleziona <b>${esc(repoName)}</b>.</li>
      <li>In <b>Permissions</b> aggiungi <b>Contents</b> e impostalo su <b>Read and write</b>.</li>
      <li>Scegli la scadenza e genera il token. Copialo e incollalo qui sopra, con la sua scadenza: una settimana prima ti avviso.</li>
    </ol>`;
  }

  root.addEventListener("submit", async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    const previous = getConfig();
    const newToken = String(form.get("token") || "").trim();
    const next = {
      token: newToken || previous.token,
      repo: String(form.get("repo") || "").trim() || DEFAULTS.repo,
      path: String(form.get("path") || "").trim() || DEFAULTS.path,
      branch: String(form.get("branch") || "").trim() || DEFAULTS.branch,
      // the date in the form belongs to the token pasted with it
      tokenExpires: newToken ? String(form.get("expires") || "") : previous.tokenExpires,
    };
    if (!next.token) {
      toast("Incolla il token", "error");
      e.target.querySelector("input[name=token]").focus();
      return;
    }
    if (newToken && next.tokenExpires && next.tokenExpires < today()) {
      toast("Questa scadenza è già passata: controlla la data su GitHub", "error");
      return;
    }
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>Controllo…</span>`;
    setConfig(next);
    try {
      await load();
      toast(`Collegato: ${getState().data.sessions.length} sessioni`);
      loadNotes().catch(() => {});
      navigate("#/calendar");
    } catch (err) {
      setConfig(previous);
      toast(errorMessage(err), "error");
      draw();
    }
  });

  // the date of a new token is asked only once one is pasted
  root.addEventListener("input", e => {
    if (e.target.name !== "token" || !isConnected()) return;
    root.querySelector(".expiry-field").hidden = !e.target.value.trim();
  });

  root.addEventListener("change", e => {
    const pick = e.target.closest(".expiry-pick");
    if (!pick) return;
    if (pick.classList.contains("current")) {
      const date = e.target.value;
      if (date && date < today()) {
        toast("Questa scadenza è già passata: controlla la data su GitHub", "error");
        e.target.value = getConfig().tokenExpires;
      } else {
        // the expiry of the token in use is saved at once: nothing to check on GitHub
        setConfig({ ...getConfig(), tokenExpires: date });
        // one toast when the picker settles (on some phones it fires at every day touched)
        clearTimeout(savedToast);
        savedToast = setTimeout(() => {
          const saved = getConfig().tokenExpires;
          toast(saved ? `Scadenza salvata: ${fmtShortDate(saved)}` : "Scadenza tolta");
        }, 600);
      }
    }
    showExpiry(pick);
  });

  root.addEventListener("click", e => {
    const chip = e.target.closest(".date-pick");
    if (chip) {
      if (matchMedia("(pointer: fine)").matches) {
        try { chip.querySelector("input").showPicker(); } catch { /* the native control opens on its own */ }
      }
      return;
    }
    const reload = e.target.closest("[data-reload]");
    if (reload) {
      reload.disabled = true;
      Promise.all([load(), loadNotes()])
        .then(() => { toast("Dati e note aggiornati"); draw(); })
        .catch(err => { toast(errorMessage(err), "error"); reload.disabled = false; });
      return;
    }
    const out = e.target.closest("[data-disconnect]");
    if (out) {
      armConfirm(out, "Conferma", () => {
        disconnect();
        forgetNotes();
        toast("Scollegato da questo browser");
        navigate("#/settings", { replace: true });
      });
    }
  });

  draw();
}
