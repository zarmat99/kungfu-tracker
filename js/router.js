export function parseRoute() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  return { name: path || "calendar", params: new URLSearchParams(query || "") };
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else if (location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = hash;
  }
}
