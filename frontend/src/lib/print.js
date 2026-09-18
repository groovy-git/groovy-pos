import { inr, fmtDateTime, qtyLabel, METHOD_LABEL, r2 } from "./format";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function gstByRate(items) {
  const m = {};
  items.forEach((i) => {
    const r = (m[i.gst_rate] = m[i.gst_rate] || { rate: i.gst_rate, taxable: 0, tax: 0 });
    r.taxable = r2(r.taxable + i.taxable);
    r.tax = r2(r.tax + i.tax);
  });
  return Object.values(m).sort((a, b) => a.rate - b.rate);
}

function savings(d) {
  const mrpTotal = d.items.reduce((s, i) => s + (i.mrp || i.price) * i.qty, 0);
  return Math.max(0, r2(mrpTotal - d.sale.grand_total));
}

function payLines(d) {
  return d.payments.filter((p) => p.amount > 0 && !p.return_id);
}

// loose attar shows just the name; the ml quantity says the rest
// shop details for this bill: branch name, and the branch's own address/phone when set
function shopFor(d, s) {
  const b = d.branch;
  return {
    ...s,
    address: (b && b.address) || s.address,
    phone: (b && b.phone) || s.phone,
    branch_name: s.multi_branch && b ? b.name : "",
  };
}

const itemName = (i) => `${i.product_name}${i.size && i.unit !== "ml" ? " " + i.size : ""}`;

/* ---------- 80mm thermal receipt ---------- */
export function receiptHtml(d, s) {
  s = shopFor(d, s);
  const sale = d.sale;
  const showGst = !sale.gst_hidden; // GST breakup can be left off the customer's bill
  const rates = gstByRate(d.items);
  const saved = savings(d);
  const rows = d.items
    .map(
      (i) => `
    <div class="it"><div class="nm">${esc(itemName(i))}</div>
      <div class="ln"><span>${qtyLabel(i.qty, i.unit)} × ${inr(i.price, { paise: i.unit === "ml" })}${i.discount ? ` <small>(-${inr(i.discount)})</small>` : ""}</span><b>${inr(r2(i.price * i.qty))}</b></div>
      ${showGst && i.hsn ? `<div class="hsn">HSN ${esc(i.hsn)} · GST ${i.gst_rate}%</div>` : ""}</div>`,
    )
    .join("");
  const pays = payLines(d)
    .map((p) => `<div class="kv"><span>${METHOD_LABEL[p.method] || p.method}${p.reference ? " (" + esc(p.reference) + ")" : ""}</span><span>${inr(p.amount)}</span></div>`)
    .join("");
  const returns = (d.returns || [])
    .map((r) => `<div class="kv"><span>Credit note ${esc(r.credit_note_no)}</span><span>-${inr(r.total)}</span></div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoice_no)}</title><style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Courier New", monospace; font-size: 12px; color: #000; width: 74mm; }
    .c { text-align: center; } .b { font-weight: 700; }
    h1 { font-family: Georgia, serif; font-size: 18px; letter-spacing: 1px; }
    .tag { font-style: italic; font-size: 11px; margin-bottom: 3px; }
    .sm { font-size: 10.5px; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .kv { display: flex; justify-content: space-between; gap: 6px; }
    .it { margin: 4px 0; } .nm { font-weight: 700; } .ln { display: flex; justify-content: space-between; }
    .hsn { font-size: 10px; color: #333; }
    .tot { font-size: 15px; font-weight: 700; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; } td, th { text-align: right; padding: 1px 0; } td:first-child, th:first-child { text-align: left; }
    .save { border: 1px dashed #000; padding: 4px; margin: 6px 0; text-align: center; font-weight: 700; }
  </style></head><body>
    <div class="c"><h1>${esc(s.business_name || "Groovy Fragrances")}</h1>
      ${s.branch_name ? `<div class="b">${esc(s.branch_name)}</div>` : ""}
      ${s.tagline ? `<div class="tag">${esc(s.tagline)}</div>` : ""}
      <div class="sm">${esc(s.address || "")}</div>
      ${s.phone ? `<div class="sm">Ph: ${esc(s.phone)}</div>` : ""}
      ${s.gstin ? `<div class="sm b">GSTIN: ${esc(s.gstin)}</div>` : ""}
    </div><hr>
    <div class="c b">${showGst && s.gstin ? "TAX INVOICE" : "BILL"}</div>
    <div class="kv"><span>No: ${esc(sale.invoice_no)}</span></div>
    <div class="kv"><span>${esc(fmtDateTime(sale.date))}</span><span>Served by: ${esc(sale.salesman_name)}</span></div>
    ${sale.customer_name || sale.customer_phone ? `<div>Customer: ${esc(sale.customer_name || "")} ${esc(sale.customer_phone || "")}</div>` : ""}
    ${sale.customer_gstin ? `<div>Cust GSTIN: ${esc(sale.customer_gstin)}</div>` : ""}
    ${sale.status === "voided" ? `<div class="c b">*** VOIDED ***</div>` : ""}
    <hr>${rows}<hr>
    <div class="kv"><span>Items total</span><span>${inr(sale.gross)}</span></div>
    ${sale.item_disc + sale.bill_disc > 0 ? `<div class="kv"><span>Discount</span><span>-${inr(r2(sale.item_disc + sale.bill_disc))}</span></div>` : ""}
    ${sale.round_off ? `<div class="kv"><span>Round off</span><span>${sale.round_off > 0 ? "+" : ""}${inr(sale.round_off, { paise: true })}</span></div>` : ""}
    <div class="kv tot"><span>TOTAL</span><span>${inr(sale.grand_total)}</span></div>
    ${pays}
    ${sale.change ? `<div class="kv"><span>Change returned</span><span>${inr(sale.change)}</span></div>` : ""}
    ${returns}
    ${showGst ? `<hr><table><tr><th>GST</th><th>Taxable</th><th>CGST</th><th>SGST</th></tr>
      ${rates.map((r) => `<tr><td>${r.rate}%</td><td>${r.taxable.toFixed(2)}</td><td>${(r.tax / 2).toFixed(2)}</td><td>${(r.tax - r2(r.tax / 2)).toFixed(2)}</td></tr>`).join("")}
    </table><div class="sm">Prices include GST.</div>` : ""}
    ${saved > 0 ? `<div class="save">You saved ${inr(saved)} on MRP!</div>` : ""}
    <hr><div class="c sm">${esc(s.receipt_footer || "Thank you for shopping with us!")}</div>
    <div class="c sm" style="margin-top:4px">groovyfragrances.in</div>
  </body></html>`;
}

/* ---------- A4 tax invoice ---------- */
export function a4InvoiceHtml(d, s) {
  s = shopFor(d, s);
  const sale = d.sale;
  const showGst = !sale.gst_hidden; // GST breakup can be left off the customer's bill
  const rates = gstByRate(d.items);
  const rows = d.items
    .map(
      (i, n) => `<tr><td>${n + 1}</td><td><b>${esc(itemName(i))}</b>${i.brand ? `<div class="sub">${esc(i.brand)}</div>` : ""}</td>
      ${showGst ? `<td>${esc(i.hsn || "")}</td>` : ""}<td class="n">${qtyLabel(i.qty, i.unit)}</td><td class="n">${inr(i.mrp, { paise: i.unit === "ml" })}</td>
      <td class="n">${inr(i.price, { paise: i.unit === "ml" })}</td><td class="n">${inr(r2(i.discount + (i.bill_disc_share || 0)))}</td>
      ${showGst ? `<td class="n">${i.gst_rate}%</td><td class="n">${i.taxable.toFixed(2)}</td>` : ""}<td class="n"><b>${inr(i.line_total)}</b></td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoice_no)}</title><style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; color: #1a1a1a; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 4px solid #F5BF03; padding-bottom: 12px; margin-bottom: 14px; }
    .brand { display: flex; gap: 12px; align-items: center; }
    .dot { width: 58px; height: 58px; border-radius: 50%; background: #F5BF03; display: grid; place-items: center; font-family: Georgia, serif; font-weight: 700; font-size: 11px; letter-spacing: .5px; }
    h1 { font-family: Georgia, serif; font-size: 24px; color: #654321; }
    .tag { font-style: italic; color: #654321; }
    .doc { text-align: right; } .doc h2 { font-family: Georgia, serif; font-size: 22px; letter-spacing: 3px; color: #654321; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #FAF7F2; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; }
    .lbl { font-size: 10px; text-transform: uppercase; color: #7a716a; letter-spacing: .5px; }
    table { width: 100%; border-collapse: collapse; }
    .items th { background: #654321; color: #fff; padding: 7px 6px; font-size: 10.5px; text-align: left; }
    .items td { padding: 7px 6px; border-bottom: 1px solid #ebe3d9; vertical-align: top; }
    .n { text-align: right; white-space: nowrap; } .items th.n { text-align: right; }
    .sub { font-size: 10px; color: #7a716a; }
    .bottom { display: flex; justify-content: space-between; gap: 20px; margin-top: 14px; }
    .gst td, .gst th { border: 1px solid #ebe3d9; padding: 4px 6px; font-size: 10.5px; text-align: right; } .gst th { background: #FAF7F2; }
    .tot { width: 280px; } .tot td { padding: 4px 6px; } .tot td:last-child { text-align: right; }
    .grand td { font-size: 15px; font-weight: 700; color: #654321; border-top: 2px solid #654321; border-bottom: 2px solid #654321; }
    .foot { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; color: #555; }
    .sign { text-align: center; border-top: 1px solid #999; padding-top: 4px; width: 200px; }
    .void { color: #c62828; font-weight: 700; font-size: 16px; }
  </style></head><body>
    <div class="head">
      <div class="brand"><div class="dot">GROOVY</div><div><h1>${esc(s.business_name)}${s.branch_name ? " · " + esc(s.branch_name) : ""}</h1>${s.tagline ? `<div class="tag">${esc(s.tagline)}</div>` : ""}
        <div>${esc(s.address || "")}</div><div>${esc([s.phone, s.email].filter(Boolean).join(" · "))}</div>
        ${s.gstin ? `<div><b>GSTIN: ${esc(s.gstin)}</b> · State: ${esc(s.state_name || "")} (${esc(s.state_code || "")})</div>` : ""}</div></div>
      <div class="doc"><h2>${showGst && s.gstin ? "TAX INVOICE" : "INVOICE"}</h2>${sale.status === "voided" ? '<div class="void">VOIDED</div>' : ""}</div>
    </div>
    <div class="meta">
      <div><div class="lbl">Invoice No</div><b>${esc(sale.invoice_no)}</b></div>
      <div><div class="lbl">Date</div>${esc(fmtDateTime(sale.date))}</div>
      <div><div class="lbl">Bill To</div>${esc(sale.customer_name || "Walk-in customer")} ${esc(sale.customer_phone || "")}${sale.customer_gstin ? `<br>GSTIN: ${esc(sale.customer_gstin)}` : ""}</div>
      <div><div class="lbl">Served By</div>${esc(sale.salesman_name)}</div>
    </div>
    <table class="items"><thead><tr><th>#</th><th>Item</th>${showGst ? "<th>HSN</th>" : ""}<th class="n">Qty</th><th class="n">MRP</th><th class="n">Rate</th><th class="n">Disc</th>${showGst ? '<th class="n">GST</th><th class="n">Taxable</th>' : ""}<th class="n">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="bottom">
      ${showGst ? `<div><div class="lbl" style="margin-bottom:4px">GST Summary (prices include GST)</div>
        <table class="gst"><tr><th>Rate</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>Total tax</th></tr>
        ${rates.map((r) => `<tr><td>${r.rate}%</td><td>${r.taxable.toFixed(2)}</td><td>${(r.tax / 2).toFixed(2)}</td><td>${(r.tax - r2(r.tax / 2)).toFixed(2)}</td><td>${r.tax.toFixed(2)}</td></tr>`).join("")}</table></div>` : "<div></div>"}
      <table class="tot">
        <tr><td>Items total</td><td>${inr(sale.gross)}</td></tr>
        ${sale.item_disc + sale.bill_disc > 0 ? `<tr><td>Discount</td><td>-${inr(r2(sale.item_disc + sale.bill_disc))}</td></tr>` : ""}
        ${showGst ? `<tr><td>Taxable value</td><td>${inr(sale.taxable, { paise: true })}</td></tr>
        <tr><td>CGST</td><td>${inr(sale.cgst, { paise: true })}</td></tr>
        <tr><td>SGST</td><td>${inr(sale.sgst, { paise: true })}</td></tr>` : ""}
        ${sale.round_off ? `<tr><td>Round off</td><td>${inr(sale.round_off, { paise: true })}</td></tr>` : ""}
        <tr class="grand"><td>Grand Total</td><td>${inr(sale.grand_total)}</td></tr>
        ${payLines(d).map((p) => `<tr><td>Paid · ${METHOD_LABEL[p.method] || p.method}</td><td>${inr(p.amount)}</td></tr>`).join("")}
        ${(d.returns || []).map((r) => `<tr><td>Credit note ${esc(r.credit_note_no)}</td><td>-${inr(r.total)}</td></tr>`).join("")}
      </table>
    </div>
    <div class="foot"><div>${esc(s.receipt_footer || "")}<br>This is a computer generated invoice.</div><div class="sign">For ${esc(s.business_name)}</div></div>
  </body></html>`;
}

export function printHtml(html) {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(f);
  const doc = f.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 60000);
  }, 350);
}

/* ---------- WhatsApp / share ---------- */
export function billText(d, s) {
  s = shopFor(d, s);
  const sale = d.sale;
  const showGst = !sale.gst_hidden; // GST breakup can be left off the customer's bill
  const lines = d.items.map((i) => `• ${itemName(i)} × ${qtyLabel(i.qty, i.unit)} = ${inr(r2(i.price * i.qty))}`);
  const disc = r2(sale.item_disc + sale.bill_disc);
  const saved = savings(d);
  const pays = payLines(d).map((p) => `${METHOD_LABEL[p.method] || p.method} ${inr(p.amount)}`).join(", ");
  return [
    `*${s.business_name || "Groovy Fragrances"}${s.branch_name ? " · " + s.branch_name : ""}*`,
    s.tagline ? `_${s.tagline}_` : "",
    "",
    `Bill: ${sale.invoice_no}`,
    `Date: ${fmtDateTime(sale.date)}`,
    `Served by: ${sale.salesman_name}`,
    "",
    ...lines,
    "",
    disc > 0 ? `Discount: -${inr(disc)}` : "",
    `*Total: ${inr(sale.grand_total)}*${showGst ? " (incl. GST)" : ""}`,
    pays ? `Paid: ${pays}` : "",
    saved > 0 ? `You saved ${inr(saved)} on MRP 🎉` : "",
    "",
    s.receipt_footer || "Thank you for shopping with us!",
    "groovyfragrances.in",
  ]
    .filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0))
    .join("\n");
}

export function whatsappLink(phone, text) {
  const p = String(phone || "").replace(/\D/g, "");
  const to = p.length === 10 ? "91" + p : p;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
