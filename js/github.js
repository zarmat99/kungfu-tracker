// Minimal client for the GitHub API: read and write one JSON file in a repository, and read the notes.
const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

async function request(cfg, method, url, body) {
  const res = await fetch(API + url, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).message || message; } catch { /* not JSON */ }
    throw new GitHubError(res.status, message);
  }
  return res.json();
}

const contentsPath = cfg => `/repos/${cfg.repo}/contents/${cfg.path.split("/").map(encodeURIComponent).join("/")}`;

export async function readFile(cfg) {
  const file = await request(cfg, "GET", `${contentsPath(cfg)}?ref=${encodeURIComponent(cfg.branch)}`);
  let content = file.content;
  if (file.encoding !== "base64") {
    // files over 1 MB come without content: read them through the blob API
    content = (await request(cfg, "GET", `/repos/${cfg.repo}/git/blobs/${file.sha}`)).content;
  }
  return { text: fromBase64(content), sha: file.sha };
}

/** Every file of the branch (path, blob sha, size), from one tree request. */
export async function readTree(cfg) {
  const tree = await request(cfg, "GET", `/repos/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`);
  return tree.tree.filter(entry => entry.type === "blob");
}

/** A text file by its blob sha. */
export async function readBlob(cfg, sha) {
  return fromBase64((await request(cfg, "GET", `/repos/${cfg.repo}/git/blobs/${sha}`)).content);
}

/** Any file by its blob sha, as raw bytes: for videos and pages. */
export async function readBlobRaw(cfg, sha, type) {
  const res = await fetch(`${API}/repos/${cfg.repo}/git/blobs/${sha}`, {
    headers: { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new GitHubError(res.status, res.statusText);
  return new Blob([await res.arrayBuffer()], { type });
}

export async function writeFile(cfg, text, sha, message) {
  const res = await request(cfg, "PUT", contentsPath(cfg), {
    message,
    content: toBase64(text),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  });
  return { sha: res.content.sha };
}
