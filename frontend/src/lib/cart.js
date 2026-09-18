import { r2, r3 } from "./format";

// Cart line: {variant_id, qty, discount}. Repeat adds merge into the same line.
export function addLine(lines, variantId, qty = 1) {
  const i = lines.findIndex((l) => l.variant_id === variantId);
  if (i >= 0) {
    const next = lines.slice();
    next[i] = { ...next[i], qty: r3(next[i].qty + qty) };
    return next;
  }
  return [...lines, { variant_id: variantId, qty: r3(qty), discount: 0 }];
}

export function setLine(lines, variantId, patch) {
  return lines.map((l) => (l.variant_id === variantId ? { ...l, ...patch } : l));
}

export function removeLine(lines, variantId) {
  return lines.filter((l) => l.variant_id !== variantId);
}

export function qtyInCart(lines, variantId) {
  const l = lines.find((x) => x.variant_id === variantId);
  return l ? l.qty : 0;
}

/**
 * Same maths as the server's computeBill_ (GST-inclusive, bill discount spread by value,
 * round to rupee). Used for live preview only — the server re-prices on save.
 */
export function computeBill(lines, billDisc, roundToRupee = true) {
  const out = lines.map((l) => {
    const gross = r2(l.price * l.qty);
    const discount = Math.min(r2(l.discount || 0), gross);
    return { ...l, gross, discount, after: r2(gross - discount) };
  });
  const sumAfter = r2(out.reduce((s, l) => s + l.after, 0));
  const bd = Math.min(r2(billDisc || 0), sumAfter);
  let left = bd;
  let lastIdx = -1;
  out.forEach((l, i) => l.after > 0 && (lastIdx = i));
  out.forEach((l, i) => {
    let share = 0;
    if (bd > 0 && sumAfter > 0) share = i === lastIdx ? left : r2((bd * l.after) / sumAfter);
    share = Math.min(share, l.after);
    left = r2(left - share);
    l.line_total = r2(l.after - share);
    l.taxable = r2((l.line_total * 100) / (100 + (l.gst_rate || 0)));
    l.tax = r2(l.line_total - l.taxable);
  });
  const sum = (f) => r2(out.reduce((s, l) => s + l[f], 0));
  const net = sum("line_total");
  const grand = roundToRupee ? Math.round(net) : net;
  const tax = sum("tax");
  return {
    lines: out,
    gross: sum("gross"),
    item_disc: sum("discount"),
    bill_disc: bd,
    taxable: sum("taxable"),
    tax,
    net,
    round_off: r2(grand - net),
    grand_total: r2(grand),
  };
}

export function newClientRef() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
