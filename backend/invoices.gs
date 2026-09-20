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
        // Google's HTML→PDF converter paints text, borders and images — never a background. So every
        // heading here is coloured text over a rule, and each fill is only a bonus where it does render
        // (the browser): all of them sit under dark text, which reads the same with or without them.
        ".items td,.items th{border:1px solid #e7ded2;padding:4px 6px;font-size:10px}" +
        ".items th{background:#f3ece2;color:#654321;border-bottom:2px solid #654321;font-size:8.5px;font-weight:bold;letter-spacing:.4px;text-transform:uppercase;text-align:left}" +
        ".items tbody tr{page-break-inside:avoid}.items td.mid{vertical-align:middle}" +
        ".box{background:#faf7f2}" +
        ".gst td,.gst th{border:1px solid #e7ded2;padding:4px 6px;font-size:10px;text-align:right}" +
        ".gst th{background:#f3ece2;font-size:8.5px;letter-spacing:.4px;text-transform:uppercase;color:#6b6157}" +
        ".tot td{border:1px solid #e7ded2;padding:4px 6px;font-size:10px}.tot td.v{text-align:right;white-space:nowrap}" +
        ".grand td{background:#f5bf03;color:#2b2520;border-top:2px solid #654321;border-bottom:2px solid #654321;font-size:11.5px;font-weight:bold;padding:6px}" +
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
        // the document's name heads the page: brown bold text between two rules, which is the strongest
        // the PDF converter can render — a filled band would come out blank there
        '<table style="margin-bottom:12px"><tr><td style="border-top:2px solid #654321;border-bottom:2px solid #654321;color:#654321;font-size:13px;font-weight:bold;letter-spacing:3px;padding:7px;text-align:center">' + e(title) + "</td></tr></table>" +
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
    const cell = (c) => '<td  style="width:25%;padding:4px 6px;border:1px solid #e7ded2;font-size:10px"><div class="lbl">' + e(c[0]) + "</div>" + c[1] + "</td>";
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
    // one table, not three: separate tables size their own columns, which left Grand Total's divider
    // sitting at a different place from the CGST/SGST rows above it
    const totals =
        '<table class="tot">' + line("Items total", inrText_(sale.gross)) +
        (disc > 0 ? line("Discount", "-" + inrText_(disc)) : "") +
        (showGst ? line("Taxable value", inrText_(sale.taxable)) + line("CGST", inrText_(sale.cgst)) + line("SGST", inrText_(sale.sgst)) : "") +
        (sale.round_off ? line("Round off", inrText_(sale.round_off)) : "") +
        line("Grand Total", inrText_(sale.grand_total), "grand") +
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
        line("Refund", inrText_(r.total), "grand") +
        line("Refunded by", e(METHOD_NAME_[r.refund_method] || r.refund_method || "")) + "</table>";
    const body =
        pdfMeta_([
            ["Credit Note No", "<b>" + e(r.credit_note_no) + "</b>"],
            ["Date", '<span style="white-space:nowrap">' + pdfDate_(r.at) + "</span>"],
            ["Against Invoice", e(r.invoice_no) + (sale.date ? "<br>" + pdfDate_(String(sale.date).slice(0, 10)) : "")],
            ["Customer", e(sale.customer_name || "Walk-in customer") + (sale.customer_phone ? "<br>" + e(sale.customer_phone) : "")],
        ]) +
        '<table class="items" style="margin-top:12px"><thead><tr><th style="width:22px">#</th><th>Item returned</th>' +
        '<th class="n" style="width:46px">Qty</th><th class="n" style="width:66px">Taxable</th>' +
        '<th class="n" style="width:58px">GST</th><th class="n" style="width:74px">Amount</th>' +
        "</tr></thead><tbody>" + rows2 + "</tbody></table>" +
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
