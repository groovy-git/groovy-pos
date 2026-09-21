import { useEffect, useRef } from "react";
import { markOwnBack } from "../lib/busy";

/**
 * Android back button / swipe-back closes the top-most open sheet instead of leaving the page.
 * Each open sheet owns one history entry tagged with its depth (history.state.gpSheet).
 *
 * Closing a sheet by a button leaves its entry behind, so after the tick the history is trimmed back
 * to however many sheets are still open — in ONE step, however many closed. Doing it per sheet broke
 * when two closed at once (the outer ✕ with an inner sheet open): the second saw the first's
 * history.back() still in flight, took the entry for someone else's, and left an orphan behind that
 * swallowed the next Back press.
 *
 * A sheet opening in that same tick (cart → checkout, React StrictMode's mount/unmount/mount) reuses
 * the entry already there instead of pushing another; that also mops up any orphan left from before.
 */
const stack = [];
let listening = false;
let settleTimer = null;

const depthNow = () => (window.history.state && window.history.state.gpSheet) || 0;

function onPop() {
  const depth = depthNow();
  while (stack.length > depth) {
    const top = stack.pop();
    top.popped = true;
    top.close();
  }
}

// drop history entries that no open sheet owns any more
function settle() {
  settleTimer = null;
  const cur = depthNow();
  const want = stack.length;
  if (cur > want) {
    markOwnBack();
    window.history.go(want - cur);
  }
}

export function useBackClose(open, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (!listening) {
      window.addEventListener("popstate", onPop);
      listening = true;
    }
    const depth = stack.length + 1;
    // an entry at this depth is already there — one about to be trimmed, or an orphan: take it over
    if (depthNow() < depth) window.history.pushState({ ...(window.history.state || {}), gpSheet: depth }, "");
    const entry = { close: () => closeRef.current(), popped: false };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (entry.popped) return; // Back already removed its entry
      if (!settleTimer) settleTimer = setTimeout(settle, 0);
    };
  }, [open]);
}
