/**
 * Invoice PDFs in Google Drive:  <folder of the Sheet>/Sales_Invoices/FY 2026-27/09/GST/GF-26-27-00001.pdf
 *   - GST folder = bills printed as TAX INVOICE (GST shown and the shop's GSTIN set); the rest go to Non-GST,
 *     so the accountant can take just the GST folder;
 *   - made here on the server from the saved bill (the phone only asks), so the app stays light;
 *   - every 15 min a timer saves PDFs for new bills and credit notes (checkout is never slowed down);
 *   - "Save PDF to Drive" on a bill does it at once; a voided bill's PDF is renamed …-VOID.pdf.
 * Files stay private to the shop account.
 */

const PDF_FN_ = "savePendingInvoicePdfs";
const PDF_ROOT_ = "Sales_Invoices";
const PDF_VOID_MARK_ = "#void"; // appended to pdf_url once the file carries the -VOID name

function pdfName_(docNo, voided) {
    return String(docNo).replace(/[\/\\]/g, "-") + (voided ? "-VOID" : "") + ".pdf";
}

function pdfFileId_(url) {
    const m = /\/d\/([A-Za-z0-9_-]+)/.exec(String(url || "")) || /[?&]id=([A-Za-z0-9_-]+)/.exec(String(url || ""));
    return m ? m[1] : "";
}

// Sales_Invoices inside the folder that holds the Sheet (My Drive root if it isn't in a folder)
function invoiceRoot_() {
    const props = PropertiesService.getScriptProperties();
    const cached = props.getProperty("pdf_root_id");
    if (cached) {
        try {
            const f = DriveApp.getFolderById(cached);
            if (!f.isTrashed()) return f;
        } catch (e) {
            /* deleted → find or make it again */
        }
    }
    const parents = DriveApp.getFileById(ss_().getId()).getParents();
    const home = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    const it = home.getFoldersByName(PDF_ROOT_);
    const root = it.hasNext() ? it.next() : home.createFolder(PDF_ROOT_);
    props.setProperty("pdf_root_id", root.getId());
    return root;
}

// "FY 2026-27" — April to March, like the invoice numbers (GF/26-27/…)
function fyFolderName_(dateStr) {
    const y = parseInt(String(dateStr).slice(0, 4), 10);
    const start = parseInt(String(dateStr).slice(5, 7), 10) >= 4 ? y : y - 1;
    return "FY " + start + "-" + pad_((start + 1) % 100, 2);
}

function subFolder_(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
}

// a bill is a tax invoice when it shows GST and the shop has a GSTIN — the same rule as the PDF's title
function isTaxInvoice_(sale) {
    return !!sale && !sale.gst_hidden && !!str_(setting_("gstin"));
}

// Sales_Invoices/FY 2026-27/09/GST — the folder id is remembered so a PDF needs one Drive lookup
function invoiceFolder_(dateStr, gst) {
    const date = String(dateStr || todayStr_());
    const kind = gst ? "GST" : "Non-GST";
    const key = "pdf_dir_" + date.slice(0, 7) + "_" + (gst ? "gst" : "nongst");
    const props = PropertiesService.getScriptProperties();
    const cached = props.getProperty(key);
    if (cached) {
        try {
            const f = DriveApp.getFolderById(cached);
            if (!f.isTrashed()) return f;
        } catch (e) {
            /* deleted → find or make it again */
        }
    }
    const month = subFolder_(subFolder_(invoiceRoot_(), fyFolderName_(date)), date.slice(5, 7));
    const folder = subFolder_(month, kind);
    props.setProperty(key, folder.getId());
    return folder;
}

/**
 * PDFs saved before the FY layout sit in Sales_Invoices/yyyy-MM. Move them into FY …/MM (same file ids,
 * so every link on a bill keeps working) and bin the empty old folder. Time-boxed; the next run continues.
 */
function migratePdfFolders_(inTime) {
    const folders = invoiceRoot_().getFolders();
    let moved = 0;
    while (folders.hasNext() && inTime()) {
        const old = folders.next();
        if (!/^\d{4}-\d{2}$/.test(old.getName())) continue;
        const target = subFolder_(subFolder_(invoiceRoot_(), fyFolderName_(old.getName() + "-01")), old.getName().slice(5, 7));
        const files = old.getFiles();
        while (files.hasNext() && inTime()) {
            files.next().moveTo(target);
            moved++;
        }
        if (!old.getFiles().hasNext() && !old.getFolders().hasNext()) old.setTrashed(true);
    }
    return moved;
}

function makePdf_(html, name, folder) {
    const pdf = Utilities.newBlob(html, "text/html", name.replace(/\.pdf$/, ".html")).getAs("application/pdf").setName(name);
    return folder.createFile(pdf).getUrl();
}

function trashPdf_(url) {
    try {
        DriveApp.getFileById(pdfFileId_(url)).setTrashed(true);
    } catch (e) {
        console.warn("trashPdf_", e);
    }
}

/* ---------- document HTML (tables + inline styles: Google's PDF converter ignores flex/grid) ---------- */

const PDF_MONTHS_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PDF_LOGO_ = "data:image/png;base64,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";

function pdfDate_(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(String(s || ""));
    if (!m) return escHtml_(s);
    let out = Number(m[3]) + " " + PDF_MONTHS_[Number(m[2]) - 1] + " " + m[1];
    if (m[4] !== undefined) {
        const h = Number(m[4]);
        out += ", " + (h % 12 || 12) + ":" + m[5] + (h < 12 ? " am" : " pm");
    }
    return out;
}

function pdfShop_(branchId) {
    const s = settingsMap_();
    const b = branchById_(bid_(branchId));
    return {
        name: s.business_name, tagline: s.tagline, email: s.email, gstin: s.gstin, state_name: s.state_name, state_code: s.state_code,
        footer: s.receipt_footer,
        address: (b && b.address) || s.address,
        phone: (b && b.phone) || s.phone,
        branch: activeBranches_().length > 1 && b ? b.name : "",
    };
}

/** Shared page frame: letterhead, title band, body, notes + signature. */
function pdfPage_(shop, title, stamp, body, notes) {
    const e = escHtml_;
    return (
        '<html><head><meta charset="utf-8"><style>' +
        // one sans face for the whole document — a serif heading over a sans table looked like two papers
        "body{font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#2b2520;margin:0}" +
        "table{border-collapse:collapse;width:100%}td,th{vertical-align:top}" +
        ".muted{color:#8a7f75}.small{font-size:10px}.b{font-weight:bold}.n{text-align:right;white-space:nowrap}" +
        ".sub{font-size:9px;color:#8a7f75}" +
        ".lbl{font-size:8.5px;letter-spacing:.6px;text-transform:uppercase;color:#8a7f75}" +
        // every table on the page is the same grid: bordered cells, 10px values, small uppercase headers
        ".items th{background:#654321;color:#ffffff;border:1px solid #654321;padding:4px 6px;font-size:8.5px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;text-align:left}" +
        ".items td{border:1px solid #e7ded2;padding:4px 6px;font-size:10px}" +
        ".items tbody tr{page-break-inside:avoid}.items td.mid{vertical-align:middle}" +
        ".box{border:1px solid #e7ded2;background:#faf7f2}" +
        ".gst td,.gst th{border:1px solid #e7ded2;padding:4px 6px;font-size:10px;text-align:right}" +
        ".gst th{background:#f3ece2;font-size:8.5px;letter-spacing:.4px;text-transform:uppercase;color:#6b6157}" +
        ".tot td{border:1px solid #e7ded2;padding:4px 6px;font-size:10px}.tot td.v{text-align:right;white-space:nowrap}" +
        ".grand td{background:#f5bf03;color:#2b2520;border:1px solid #f5bf03;font-size:11.5px;font-weight:bold;padding:6px}" +
        "</style></head><body>" +
        // letterhead
        '<table><tr>' +
        '<td style="width:52px;padding-right:10px"><img src="' + PDF_LOGO_ + '" width="52" height="52" alt=""></td>' +
        "<td>" +
        '<div style="font-size:20px;font-weight:bold;color:#654321">' + e(shop.name) + (shop.branch ? " · " + e(shop.branch) : "") + "</div>" +
        (shop.tagline ? '<div style="font-style:italic;color:#8a7f75">' + e(shop.tagline) + "</div>" : "") +
        '<div class="small" style="margin-top:3px">' + e(shop.address || "") + "</div>" +
        '<div class="small">' + e([shop.phone, shop.email].filter(Boolean).join(" · ")) + "</div>" +
        (shop.gstin ? '<div class="small b">GSTIN: ' + e(shop.gstin) + " · State: " + e(shop.state_name || "") + " (" + e(shop.state_code || "") + ")</div>" : "") +
        "</td></tr></table>" +
        '<div style="border-bottom:3px solid #f5bf03;margin:10px 0 12px"></div>' +
        // the document's name heads the page across its full width
        '<div style="background:#654321;color:#fff;font-size:12px;font-weight:bold;letter-spacing:3px;padding:6px;text-align:center;margin-bottom:12px">' + e(title) + "</div>" +
        (stamp ? '<div style="color:#c62828;font-weight:bold;font-size:14px;text-align:center;margin:-6px 0 12px">' + e(stamp) + "</div>" : "") +
        body +
        // notes + signature
        '<table style="margin-top:18px"><tr>' +
        '<td class="small muted">' + (notes ? notes + "<br>" : "") + e(shop.footer || "") + "<br>This is a computer generated document." + "</td>" +
        '<td style="width:210px;text-align:center;padding-left:16px">' +
        '<div class="small" style="margin-bottom:34px">For ' + e(shop.name) + "</div>" +
        '<div style="border-top:1px solid #8a7f75;padding-top:4px" class="small muted">Authorised Signatory</div>' +
        "</td></tr></table>" +
        "</body></html>"
    );
}

/** Four label/value cells in a bordered strip. */
function pdfMeta_(cells) {
    const e = escHtml_;
    const cell = (c) => '<td style="width:25%;padding:4px 6px;border:1px solid #e7ded2;font-size:10px"><div class="lbl">' + e(c[0]) + "</div>" + c[1] + "</td>";
    return '<table class="box">' + "<tr>" + cells.map(cell).join("") + "</tr></table>";
}

function invoicePdfHtml_(d) {
    const e = escHtml_;
    const sale = d.sale;
    const shop = pdfShop_(sale.branch_id);
    const showGst = !sale.gst_hidden;
    const name = (i) => i.product_name + (i.size && i.unit !== "ml" ? " " + i.size : "");
    const qty = (i) => (i.unit === "ml" ? r3_(i.qty) + " ml" : String(i.qty));
    const rates = {};
    d.items.forEach((i) => {
        const r = (rates[i.gst_rate] = rates[i.gst_rate] || { rate: i.gst_rate, taxable: 0, tax: 0 });
        r.taxable = r2_(r.taxable + i.taxable);
        r.tax = r2_(r.tax + i.tax);
    });
    const rows = d.items
        .map((i, n) => {
            const bg = n % 2 ? ' style="background:#faf7f2"' : "";
            return "<tr" + bg + '><td class="muted">' + (n + 1) + "</td><td><b>" + e(name(i)) + "</b>" +
                (i.brand ? '<div class="sub">' + e(i.brand) + "</div>" : "") + "</td>" +
                (showGst ? '<td class="small mid">' + e(i.hsn || "") + "</td>" : "") +
                '<td class="n mid">' + qty(i) + '</td><td class="n mid muted">' + inrText_(i.mrp) + '</td><td class="n mid">' + inrText_(i.price) + "</td>" +
                '<td class="n mid">' + (r2_(i.discount + (i.bill_disc_share || 0)) > 0 ? "-" + inrText_(r2_(i.discount + (i.bill_disc_share || 0))) : "—") + "</td>" +
                (showGst ? '<td class="n mid">' + i.gst_rate + '%</td><td class="n mid">' + Number(i.taxable).toFixed(2) + "</td>" : "") +
                '<td class="n mid b">' + inrText_(i.line_total) + "</td></tr>";
        })
        .join("");
    const head =
        '<tr><th style="width:22px">#</th><th>Item</th>' + (showGst ? '<th style="width:52px">HSN</th>' : "") +
        '<th class="n" style="width:38px">Qty</th><th class="n" style="width:54px">MRP</th><th class="n" style="width:54px">Rate</th>' +
        '<th class="n" style="width:50px">Disc</th>' +
        (showGst ? '<th class="n" style="width:38px">GST</th><th class="n" style="width:62px">Taxable</th>' : "") +
        '<th class="n" style="width:70px">Amount</th></tr>';

    const gstTable = showGst
        ? '<div class="lbl" style="margin-bottom:4px">GST summary (prices include GST)</div><table class="gst" style="width:auto">' +
          '<tr><th>Rate</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>Total tax</th></tr>' +
          Object.keys(rates).map((k) => rates[k]).sort((a, b) => a.rate - b.rate)
              .map((r) => "<tr><td>" + r.rate + "%</td><td>" + r.taxable.toFixed(2) + "</td><td>" + (r.tax / 2).toFixed(2) + "</td><td>" + (r.tax - r2_(r.tax / 2)).toFixed(2) + "</td><td>" + r.tax.toFixed(2) + "</td></tr>")
              .join("") + "</table>"
        : "";

    const line = (l, v, cls) => '<tr class="' + (cls || "") + '"><td>' + l + '</td><td class="v">' + v + "</td></tr>";
    const disc = r2_(sale.item_disc + sale.bill_disc);
    const pays = d.payments.filter((p) => p.amount > 0 && !p.return_id);
    const paid = r2_(pays.reduce((s, p) => s + p.amount, 0));
    const balance = r2_(sale.grand_total - paid);
    const saved = r2_(d.items.reduce((s, i) => s + (i.mrp || i.price) * i.qty, 0) - sale.grand_total);
    const totals =
        '<table class="tot">' + line("Items total", inrText_(sale.gross)) +
        (disc > 0 ? line("Discount", "-" + inrText_(disc)) : "") +
        (showGst ? line("Taxable value", inrText_(sale.taxable)) + line("CGST", inrText_(sale.cgst)) + line("SGST", inrText_(sale.sgst)) : "") +
        (sale.round_off ? line("Round off", inrText_(sale.round_off)) : "") +
        '</table><table class="tot" style="margin-top:2px"><tr class="grand"><td>Grand Total</td><td class="v">' + inrText_(sale.grand_total) + "</td></tr></table>" +
        '<table class="tot">' +
        pays.map((p) => line("Paid · " + (METHOD_NAME_[p.method] || e(p.method)), inrText_(p.amount))).join("") +
        (balance > 0 ? line("<b>Balance due</b>", "<b>" + inrText_(balance) + "</b>") : balance < 0 ? line("Change given", inrText_(-balance)) : "") +
        (d.returns || []).map((r) => line("Credit note " + e(r.credit_note_no), "-" + inrText_(r.total))).join("") +
        "</table>" +
        (saved > 0 ? '<div style="margin-top:6px;text-align:right;color:#2e7d32;font-weight:bold">You saved ' + inrText_(saved) + " on MRP!</div>" : "");

    const body =
        pdfMeta_([
            ["Invoice No", "<b>" + e(sale.invoice_no) + "</b>"],
            ["Date", '<span style="white-space:nowrap">' + pdfDate_(sale.date) + "</span>"],
            ["Bill To", e(sale.customer_name || "Walk-in customer") + (sale.customer_phone ? "<br>" + e(sale.customer_phone) : "") + (sale.customer_gstin ? "<br>GSTIN: " + e(sale.customer_gstin) : "")],
            ["Served By", e(sale.salesman_name)],
        ]) +
        '<table class="items" style="margin-top:12px"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table>" +
        '<table style="margin-top:14px"><tr><td style="padding-right:16px">' + gstTable + '</td><td style="width:265px">' + totals + "</td></tr></table>";
    return pdfPage_(shop, showGst && shop.gstin ? "TAX INVOICE" : "INVOICE", sale.status === "voided" ? "VOIDED" : "", body, "");
}

function creditNoteHtml_(r) {
    const e = escHtml_;
    const sale = findBy_("Sales", "id", r.sale_id) || {};
    const saleItems = indexBy_(rows_("Sale_Items").filter((i) => i.sale_id === r.sale_id), "id");
    const items = rows_("Return_Items").filter((x) => x.return_id === r.id);
    const rows2 = items
        .map((x, n) => {
            const si = saleItems[x.sale_item_id] || {};
            const nm = (si.product_name || "Item") + (si.size && si.unit !== "ml" ? " " + si.size : "");
            const bg = n % 2 ? ' style="background:#faf7f2"' : "";
            return "<tr" + bg + '><td class="muted">' + (n + 1) + "</td><td><b>" + e(nm) + '</b></td><td class="n">' + (si.unit === "ml" ? r3_(x.qty) + " ml" : x.qty) +
                '</td><td class="n">' + Number(x.taxable).toFixed(2) + '</td><td class="n">' + Number(x.tax).toFixed(2) + '</td><td class="n b">' + inrText_(x.amount) + "</td></tr>";
        })
        .join("");
    const line = (l, v, cls) => '<tr class="' + (cls || "") + '"><td>' + l + '</td><td class="v">' + v + "</td></tr>";
    const totals =
        '<table class="tot">' + line("Taxable value", inrText_(r.taxable)) + line("GST", inrText_(r.tax)) +
        '</table><table class="tot" style="margin-top:2px"><tr class="grand"><td>Refund</td><td class="v">' + inrText_(r.total) + "</td></tr></table>" +
        '<table class="tot">' + line("Refunded by", e(METHOD_NAME_[r.refund_method] || r.refund_method || "")) + "</table>";
    const body =
        pdfMeta_([
            ["Credit Note No", "<b>" + e(r.credit_note_no) + "</b>"],
            ["Date", '<span style="white-space:nowrap">' + pdfDate_(r.at) + "</span>"],
            ["Against Invoice", e(r.invoice_no) + (sale.date ? "<br>" + pdfDate_(String(sale.date).slice(0, 10)) : "")],
            ["Customer", e(sale.customer_name || "Walk-in customer") + (sale.customer_phone ? "<br>" + e(sale.customer_phone) : "")],
        ]) +
        '<table class="items" style="margin-top:12px"><thead><tr><th style="width:22px">#</th><th>Item returned</th><th class="n" style="width:46px">Qty</th>' +
        '<th class="n" style="width:66px">Taxable</th><th class="n" style="width:58px">GST</th><th class="n" style="width:74px">Amount</th></tr></thead><tbody>' + rows2 + "</tbody></table>" +
        '<table style="margin-top:14px"><tr><td style="padding-right:16px">' + (r.reason ? '<div class="lbl">Reason</div><div class="small">' + e(r.reason) + "</div>" : "") +
        '</td><td style="width:265px">' + totals + "</td></tr></table>";
    return pdfPage_(pdfShop_(r.branch_id), "CREDIT NOTE", "", body, "");
}

/* ---------- saving ---------- */

// builds the PDF outside the lock (it takes a couple of seconds), then records it under a short lock
function savePdfForSale_(s) {
    const voided = s.status === "voided";
    const url = makePdf_(invoicePdfHtml_(saleDetail_(s, null)), pdfName_(s.invoice_no, voided), invoiceFolder_(s.date, isTaxInvoice_(s)));
    const stored = url + (voided ? PDF_VOID_MARK_ : "");
    return withLock_(() => {
        const fresh = findBy_("Sales", "id", s.id);
        if (!fresh) return { pdf_url: "" };
        if (fresh.pdf_url) {
            trashPdf_(url); // someone else saved it meanwhile — keep one file
            return { pdf_url: fresh.pdf_url, already: true };
        }
        fresh.pdf_url = stored;
        updateFields_("Sales", fresh, ["pdf_url"]);
        return { pdf_url: stored };
    });
}

function savePdfForReturn_(r) {
    // a credit note is filed with the bill it belongs to
    const sale = findBy_("Sales", "id", r.sale_id);
    const gst = sale ? isTaxInvoice_(sale) : !!str_(setting_("gstin"));
    const url = makePdf_(creditNoteHtml_(r), pdfName_(r.credit_note_no, false), invoiceFolder_(r.at, gst));
    withLock_(() => {
        const fresh = findBy_("Returns", "id", r.id);
        if (!fresh) return;
        if (fresh.pdf_url) return trashPdf_(url);
        fresh.pdf_url = url;
        updateFields_("Returns", fresh, ["pdf_url"]);
    });
}

function apiSaveInvoicePdf_(p, ctx) {
    const s = findBy_("Sales", "id", Number(p.id));
    if (!s) fail_("Bill not found");
    if (!canSeeSale_(ctx, s)) fail_("You can't open this bill", "FORBIDDEN");
    if (s.pdf_url) return { message: "PDF already saved in Drive", data: { pdf_url: s.pdf_url, already: true } };
    const r = savePdfForSale_(s);
    log_(ctx, "PDF", "Sales", s.id, s.invoice_no);
    return { message: r.already ? "PDF already saved in Drive" : "PDF saved to Drive", data: r };
}

/** Timer (every 15 min): PDFs for new bills and credit notes, and -VOID names for voided bills. */
function savePendingInvoicePdfs() {
    resetReqCache_();
    if (setting_("invoice_pdfs") === "no") return;
    const started = Date.now();
    const inTime = () => Date.now() - started < 4 * 60 * 1000; // Apps Script stops at 6 min; the next run continues
    let done = 0;
    try {
        done += migratePdfFolders_(inTime); // one-time move from the old yyyy-MM folders
    } catch (e) {
        console.error("migratePdfFolders_: " + e);
    }
    const sales = rows_("Sales").slice().sort((a, b) => a.id - b.id);
    const returns = rows_("Returns").slice().sort((a, b) => a.id - b.id);
    for (let i = 0; i < sales.length && inTime(); i++) {
        const s = sales[i];
        try {
            if (!s.pdf_url) {
                savePdfForSale_(s);
                done++;
            } else if (s.status === "voided" && s.pdf_url.slice(-PDF_VOID_MARK_.length) !== PDF_VOID_MARK_) {
                DriveApp.getFileById(pdfFileId_(s.pdf_url)).setName(pdfName_(s.invoice_no, true));
                withLock_(() => {
                    const fresh = findBy_("Sales", "id", s.id);
                    if (fresh && fresh.pdf_url && fresh.pdf_url.slice(-PDF_VOID_MARK_.length) !== PDF_VOID_MARK_) {
                        fresh.pdf_url += PDF_VOID_MARK_;
                        updateFields_("Sales", fresh, ["pdf_url"]);
                    }
                });
                done++;
            }
        } catch (e) {
            console.error("PDF for " + s.invoice_no + ": " + e); // retried on the next run
        }
    }
    for (let i = 0; i < returns.length && inTime(); i++) {
        if (returns[i].pdf_url) continue;
        try {
            savePdfForReturn_(returns[i]);
            done++;
        } catch (e) {
            console.error("PDF for " + returns[i].credit_note_no + ": " + e);
        }
    }
    return done;
}

function syncPdfTrigger_() {
    ScriptApp.getProjectTriggers()
        .filter((t) => t.getHandlerFunction() === PDF_FN_)
        .forEach((t) => ScriptApp.deleteTrigger(t));
    if (setting_("invoice_pdfs") === "no") return false;
    ScriptApp.newTrigger(PDF_FN_).timeBased().everyMinutes(15).create();
    return true;
}
