import { useEffect, useRef } from "react";
import { markOwnBack } from "../lib/busy";

// Android back button / swipe-back closes the top-most open sheet instead of leaving the page.
// Each open sheet owns one history entry tagged with its depth. Closing a sheet by button
// removes that entry — but a tick later, so a sheet opening right after (cart → checkout,
// or React StrictMode's mount/unmount/mount) can take over the same entry instead.
const stack = [];
let listening = false;
let pending = null; // {depth, timer} — entry about to be removed

function onPop() {
  const depth = (window.history.state && window.history.state.gpSheet) || 0;
  while (stack.length > depth) {
    const top = stack.pop();
    top.popped = true;
    top.close();
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
    if (pending && pending.depth === depth) {
      clearTimeout(pending.timer); // reuse the entry of the sheet that just closed
      pending = null;
    } else {
      window.history.pushState({ ...(window.history.state || {}), gpSheet: depth }, "");
    }
    const entry = { close: () => closeRef.current(), popped: false };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (entry.popped) return;
      const timer = setTimeout(() => {
        pending = null;
        if (window.history.state && window.history.state.gpSheet === depth) {
          markOwnBack();
          window.history.back();
        }
      }, 0);
      pending = { depth, timer };
    };
  }, [open]);
}
