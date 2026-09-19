import { useEffect, useState } from "react";
import { markOwnBack } from "./busy";

// Hash routing (#/sell, #/sales/12) — works on any GitHub Pages sub-path and offline.
function current() {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { parts, page: parts[0] || "home", params: new URLSearchParams(query || "") };
}

export function useRoute() {
  const [r, setR] = useState(current);
  useEffect(() => {
    const on = () => setR(current());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export function navigate(path, { replace = false } = {}) {
  const url = "#/" + path.replace(/^[#/]+/, "");
  if (replace) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  window.scrollTo(0, 0);
}

export function goBack(fallback = "home") {
  if (window.history.length > 1) {
    markOwnBack();
    window.history.back();
  }
  else navigate(fallback, { replace: true });
}
