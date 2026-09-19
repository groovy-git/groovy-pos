/**
 * Invoice PDFs in Google Drive:  <folder of the Sheet>/Sales_Invoices/yyyy-MM/GF-26-27-00001.pdf
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

function monthFolder_(dateStr) {
    const root = invoiceRoot_();
    const name = String(dateStr || todayStr_()).slice(0, 7); // yyyy-MM
    const it = root.getFoldersByName(name);
    return it.hasNext() ? it.next() : root.createFolder(name);
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

function pdfPage_(shop, title, stamp, body) {
    const e = escHtml_;
    return (
        '<html><head><meta charset="utf-8"><style>' +
        "body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#1a1a1a;margin:0}" +
        "table{border-collapse:collapse;width:100%}td,th{vertical-align:top}" +
        ".items th{background:#654321;color:#ffffff;padding:6px;font-size:10px;text-align:left}" +
        ".items td{padding:6px;border-bottom:1px solid #ebe3d9}" +
        ".n{text-align:right;white-space:nowrap}.sub{font-size:9.5px;color:#7a716a}" +
        ".lbl{font-size:9px;text-transform:uppercase;color:#7a716a}" +
        ".box td{padding:6px 8px;background:#faf7f2}" +
        ".gst td,.gst th{border:1px solid #ebe3d9;padding:3px 5px;font-size:10px;text-align:right}.gst th{background:#faf7f2}" +
        ".tot td{padding:3px 6px}.tot td.v{text-align:right}" +
        ".grand td{font-size:14px;font-weight:bold;color:#654321;border-top:2px solid #654321;border-bottom:2px solid #654321}" +
        "</style></head><body>" +
        '<table style="border-bottom:4px solid #F5BF03;margin-bottom:12px"><tr>' +
        '<td style="padding-bottom:10px"><div style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#654321">' +
        e(shop.name) + (shop.branch ? " · " + e(shop.branch) : "") + "</div>" +
        (shop.tagline ? '<div style="font-style:italic;color:#654321">' + e(shop.tagline) + "</div>" : "") +
        "<div>" + e(shop.address || "") + "</div><div>" + e([shop.phone, shop.email].filter(Boolean).join(" · ")) + "</div>" +
        (shop.gstin ? "<div><b>GSTIN: " + e(shop.gstin) + "</b> · State: " + e(shop.state_name || "") + " (" + e(shop.state_code || "") + ")</div>" : "") +
        "</td>" +
        '<td style="text-align:right;padding-bottom:10px"><div style="font-family:Georgia,serif;font-size:20px;letter-spacing:2px;color:#654321">' +
        e(title) + "</div>" + (stamp ? '<div style="color:#c62828;font-weight:bold;font-size:15px">' + e(stamp) + "</div>" : "") +
        "</td></tr></table>" +
        body +
        '<table style="margin-top:24px"><tr><td style="color:#555">' + e(shop.footer || "") +
        "<br>This is a computer generated document.</td>" +
        '<td style="width:200px;text-align:center;border-top:1px solid #999;padding-top:4px">For ' + e(shop.name) + "</td></tr></table>" +
        "</body></html>"
    );
}

function pdfMeta_(cells) {
    // two rows of two label/value cells
    const e = escHtml_;
    const cell = (c) => '<td style="width:50%"><div class="lbl">' + e(c[0]) + "</div>" + c[1] + "</td>";
    return (
        '<table class="box" style="margin-bottom:12px"><tr>' + cell(cells[0]) + cell(cells[1]) + "</tr><tr>" + cell(cells[2]) + cell(cells[3]) + "</tr></table>"
    );
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
        .map(
            (i, n) =>
                "<tr><td>" + (n + 1) + "</td><td><b>" + e(name(i)) + "</b>" + (i.brand ? '<div class="sub">' + e(i.brand) + "</div>" : "") + "</td>" +
                (showGst ? "<td>" + e(i.hsn || "") + "</td>" : "") +
                '<td class="n">' + qty(i) + '</td><td class="n">' + inrText_(i.mrp) + '</td><td class="n">' + inrText_(i.price) +
                '</td><td class="n">' + inrText_(r2_(i.discount + (i.bill_disc_share || 0))) + "</td>" +
                (showGst ? '<td class="n">' + i.gst_rate + '%</td><td class="n">' + Number(i.taxable).toFixed(2) + "</td>" : "") +
                '<td class="n"><b>' + inrText_(i.line_total) + "</b></td></tr>",
        )
        .join("");
    const head =
        "<tr><th>#</th><th>Item</th>" + (showGst ? "<th>HSN</th>" : "") +
        '<th class="n">Qty</th><th class="n">MRP</th><th class="n">Rate</th><th class="n">Disc</th>' +
        (showGst ? '<th class="n">GST</th><th class="n">Taxable</th>' : "") + '<th class="n">Amount</th></tr>';
    const gstTable = showGst
        ? '<div class="lbl" style="margin-bottom:3px">GST summary (prices include GST)</div><table class="gst"><tr><th>Rate</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>Total tax</th></tr>' +
          Object.keys(rates)
              .map((k) => rates[k])
              .sort((a, b) => a.rate - b.rate)
              .map((r) => "<tr><td>" + r.rate + "%</td><td>" + r.taxable.toFixed(2) + "</td><td>" + (r.tax / 2).toFixed(2) + "</td><td>" + (r.tax - r2_(r.tax / 2)).toFixed(2) + "</td><td>" + r.tax.toFixed(2) + "</td></tr>")
              .join("") +
          "</table>"
        : "";
    const line = (l, v) => "<tr><td>" + l + '</td><td class="v">' + v + "</td></tr>";
    const disc = r2_(sale.item_disc + sale.bill_disc);
    const totals =
        '<table class="tot">' + line("Items total", inrText_(sale.gross)) +
        (disc > 0 ? line("Discount", "-" + inrText_(disc)) : "") +
        (showGst ? line("Taxable value", inrText_(sale.taxable)) + line("CGST", inrText_(sale.cgst)) + line("SGST", inrText_(sale.sgst)) : "") +
        (sale.round_off ? line("Round off", inrText_(sale.round_off)) : "") +
        '<tr class="grand"><td>Grand Total</td><td class="v">' + inrText_(sale.grand_total) + "</td></tr>" +
        d.payments.filter((p) => p.amount > 0 && !p.return_id).map((p) => line("Paid · " + (METHOD_NAME_[p.method] || e(p.method)), inrText_(p.amount))).join("") +
        (d.returns || []).map((r) => line("Credit note " + e(r.credit_note_no), "-" + inrText_(r.total))).join("") +
        "</table>";
    const body =
        pdfMeta_([
            ["Invoice No", "<b>" + e(sale.invoice_no) + "</b>"],
            ["Date", pdfDate_(sale.date)],
            ["Bill To", e(sale.customer_name || "Walk-in customer") + " " + e(sale.customer_phone || "") + (sale.customer_gstin ? "<br>GSTIN: " + e(sale.customer_gstin) : "")],
            ["Served By", e(sale.salesman_name)],
        ]) +
        '<table class="items">' + head + rows + "</table>" +
        '<table style="margin-top:12px"><tr><td>' + gstTable + '</td><td style="width:280px">' + totals + "</td></tr></table>";
    return pdfPage_(shop, showGst && shop.gstin ? "TAX INVOICE" : "INVOICE", sale.status === "voided" ? "VOIDED" : "", body);
}

function creditNoteHtml_(r) {
    const e = escHtml_;
    const sale = findBy_("Sales", "id", r.sale_id) || {};
    const saleItems = indexBy_(rows_("Sale_Items").filter((i) => i.sale_id === r.sale_id), "id");
    const items = rows_("Return_Items").filter((x) => x.return_id === r.id);
    const rows = items
        .map((x, n) => {
            const si = saleItems[x.sale_item_id] || {};
            const nm = (si.product_name || "Item") + (si.size && si.unit !== "ml" ? " " + si.size : "");
            return "<tr><td>" + (n + 1) + "</td><td><b>" + e(nm) + "</b></td><td class=\"n\">" + (si.unit === "ml" ? r3_(x.qty) + " ml" : x.qty) +
                '</td><td class="n">' + Number(x.taxable).toFixed(2) + '</td><td class="n">' + Number(x.tax).toFixed(2) + '</td><td class="n"><b>' + inrText_(x.amount) + "</b></td></tr>";
        })
        .join("");
    const body =
        pdfMeta_([
            ["Credit Note No", "<b>" + e(r.credit_note_no) + "</b>"],
            ["Date", pdfDate_(r.at)],
            ["Against Invoice", e(r.invoice_no) + (sale.date ? " (" + pdfDate_(String(sale.date).slice(0, 10)) + ")" : "")],
            ["Customer", e(sale.customer_name || "Walk-in customer") + " " + e(sale.customer_phone || "")],
        ]) +
        '<table class="items"><tr><th>#</th><th>Item returned</th><th class="n">Qty</th><th class="n">Taxable</th><th class="n">GST</th><th class="n">Amount</th></tr>' + rows + "</table>" +
        '<table style="margin-top:12px"><tr><td>' + (r.reason ? '<div class="lbl">Reason</div>' + e(r.reason) : "") + '</td><td style="width:280px"><table class="tot">' +
        '<tr><td>Taxable value</td><td class="v">' + inrText_(r.taxable) + "</td></tr>" +
        '<tr><td>GST</td><td class="v">' + inrText_(r.tax) + "</td></tr>" +
        '<tr class="grand"><td>Refund</td><td class="v">' + inrText_(r.total) + "</td></tr>" +
        '<tr><td>Refunded by</td><td class="v">' + e(METHOD_NAME_[r.refund_method] || r.refund_method || "") + "</td></tr></table></td></tr></table>";
    return pdfPage_(pdfShop_(r.branch_id), "CREDIT NOTE", "", body);
}

/* ---------- saving ---------- */

// builds the PDF outside the lock (it takes a couple of seconds), then records it under a short lock
function savePdfForSale_(s) {
    const voided = s.status === "voided";
    const url = makePdf_(invoicePdfHtml_(saleDetail_(s, null)), pdfName_(s.invoice_no, voided), monthFolder_(s.date));
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
    const url = makePdf_(creditNoteHtml_(r), pdfName_(r.credit_note_no, false), monthFolder_(r.at));
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
