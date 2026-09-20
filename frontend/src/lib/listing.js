// Helpers that keep long product lists usable once a shop has thousands of items.
import { useCallback, useEffect, useRef, useState } from "react";

/** How many rows to draw at a time. A phone screen holds about eight. */
export const PAGE = 60;

// searching on one or two letters matches half the shop and costs a full pass for nothing
export const MIN_SEARCH = 3;

/** The value, but only after it has stopped changing for `ms`. */
export function useDebounced(value, ms = 150) {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setHeld(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return held;
}

/**
 * What to actually search for: the settled text, or nothing until it is long enough.
 * Searching every keystroke across a few thousand products is what makes typing feel sticky.
 */
export function useSearchQuery(q, ms = 150) {
  const held = useDebounced(q, ms);
  return held.trim().length >= MIN_SEARCH ? held : "";
}

/**
 * Draw the next page when the end of the list scrolls into view. Returns a ref to put on a
 * sentinel element; pass `enabled: false` once everything is drawn and it stops watching.
 */
export function useMoreOnScroll(enabled, onMore) {
  const ref = useRef(null);
  const cb = useRef(onMore);
  cb.current = onMore;
  const setRef = useCallback((el) => (ref.current = el), []);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries[0] && entries[0].isIntersecting && cb.current(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return setRef;
}
