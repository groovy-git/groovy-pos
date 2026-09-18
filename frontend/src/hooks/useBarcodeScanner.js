import { useEffect, useRef } from "react";

/**
 * Bluetooth/USB barcode scanners act like a keyboard that types very fast and ends with Enter.
 * We treat ≥4 characters typed <45 ms apart and ending in Enter as a scan — works with no
 * input focused and never fires for normal typing. Inputs marked data-scan-ignore are skipped
 * (e.g. the barcode field in the product form handles scans itself).
 *
 * onScan(code, targetElement) — if the scanner typed into an input, the caller may clear it.
 */
export function useBarcodeScanner(onScan, enabled = true) {
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buf = "";
    let last = 0;
    let gaps = [];
    const onKey = (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.scanIgnore !== undefined) return;
      const now = performance.now();
      if (e.key === "Enter") {
        const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 999;
        if (buf.length >= 4 && avg < 45 && now - last < 150) {
          e.preventDefault();
          e.stopPropagation();
          const code = buf;
          buf = "";
          gaps = [];
          cb.current(code, t);
          return;
        }
        buf = "";
        gaps = [];
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (now - last > 120) {
        buf = "";
        gaps = [];
      } else if (buf) gaps.push(now - last);
      buf += e.key;
      last = now;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}
