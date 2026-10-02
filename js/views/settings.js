import { getConfig, setConfig, isConnected, load, disconnect, getState, errorMessage, DEV, DEFAULTS } from "../store.js";
import { getNotes, loadNotes, forgetNotes } from "../notes.js";
import { icon } from "../icons.js";
import { toast, armConfirm } from "../ui.js";
import { navigate } from "../router.js";
import { esc, fmtRelative, plural } from "../format.js";

export function renderSettings(root) {
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
  }

  function statusCard(cfg) {
    const { data, syncedAt } = getState();
    return `<div class="card status-card">
      <div class="status-row"><span>Repository</span><b>${esc(cfg.repo)}</b></div>
      <div class="status-row"><span>File</span><b>${esc(cfg.path)}</b></div>
      <div class="status-row"><span>Ultima sincronizzazione</span><b>${fmtRelative(syncedAt)}</b></div>
      <div class="status-row"><span>Dati</span><b>${data ? `${data.sessions.length} sessioni · ${data.competitions.length} gare${data.goals.length ? ` · ${plural(data.goals.length, "traguardo", "traguardi")}` : ""}` : "—"}</b></div>
      <div class="status-row"><span>Conoscenza</span><b>${notesLine()}</b></div>
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

  function tokenForm(cfg, connected) {
    return `<form class="card token-form" novalidate>
      <label>${connected ? "Nuovo token (se vuoi cambiarlo)" : "Token GitHub"}
        <input class="input" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      </label>
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
      <li>Scegli la scadenza e genera il token. Copialo e incollalo qui sopra.</li>
    </ol>`;
  }

  root.addEventListener("submit", async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    const previous = getConfig();
    const next = {
      token: String(form.get("token") || "").trim() || previous.token,
      repo: String(form.get("repo") || "").trim() || DEFAULTS.repo,
      path: String(form.get("path") || "").trim() || DEFAULTS.path,
      branch: String(form.get("branch") || "").trim() || DEFAULTS.branch,
    };
    if (!next.token) {
      toast("Incolla il token", "error");
      e.target.querySelector("input[name=token]").focus();
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

  root.addEventListener("click", e => {
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
