// Photo compression (phone camera photos are huge) + CSV helpers.

export function compressImage(file, maxSize = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL("image/jpeg", quality);
      resolve({ data: dataUrl.split(",")[1], mime: "image/jpeg", preview: dataUrl });
    };
    img.onerror = () => reject(new Error("Could not read this image"));
    img.src = url;
  });
}

// RFC-4180-ish CSV parser (quotes, commas, newlines in quotes)
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

export function toCSV(rows, cols) {
  const escCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => escCell(c.label)).join(","), ...rows.map((r) => cols.map((c) => escCell(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))].join("\n");
}

export function downloadText(filename, text, mime = "text/csv") {
  const blob = new Blob(["﻿" + text], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export const IMPORT_TEMPLATE = [
  "brand,product,category,gender,sale_type,size_label,size_ml,barcode,mrp,sell_price,cost,opening_stock,reorder_level,hsn,gst_rate",
  "Lattafa,Asad Eau De Parfum,Eau De Parfum,men,packed,100ml,100,6291108735411,3500,1950,1450,6,2,3303,18",
  "Lattafa,Asad Eau De Parfum,Eau De Parfum,men,packed,30ml,30,,1200,899,600,4,2,3303,18",
  "Groovy,White Musk Attar,Loose Attar,unisex,loose,Loose (per ml),,,30,25,12,500,100,3303,18",
].join("\n");
