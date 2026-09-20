/**
 * End-to-end backend scenarios against the in-memory Apps Script mock.
 * Run: node backend/dev/e2e.js
 */
const { createEnv } = require("./mock-gas");

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
    if (cond) passed++;
    else {
        failed++;
        console.log("FAIL:", name, extra !== undefined ? JSON.stringify(extra) : "");
    }
}
function ok(res, name) {
    check(name + " → " + (res.message || ""), res.success, res);
    return res.data;
}

const env = createEnv();
const { ctx, call } = env;

// ---- setup + self tests ----
ctx.setupSheets();
const setupMsg = env.alerts.pop();
const pwd = /Password: (\S+)/.exec(setupMsg)[1];
check("setup created admin", !!pwd, setupMsg);
ctx.setupSheets(); // idempotent
check("setup rerun ok", /already existed/.test(env.alerts.pop()));
const testMsg = ctx.runTests();
check("unit tests", /All \d+ tests passed/.test(testMsg), testMsg);

// ---- auth ----
check("no token rejected", call("getCatalog", {}).code === "AUTH_EXPIRED");
check("bad password", !call("login", { email: "owner@groovy.test", password: "nope" }).success);
const login = ok(call("login", { email: "OWNER@groovy.test", password: pwd }), "admin login");
const T = login.token;
check("admin role", login.user.role === "admin");

// ---- users ----
ok(call("saveUser", { name: "Sameer", email: "sameer@x.in", role: "salesman", password: "secret1" }, T), "add salesman");
ok(call("saveUser", { name: "Ayesha", email: "ayesha@x.in", role: "salesman", password: "secret2" }, T), "add salesman 2");
ok(call("saveUser", { name: "Imran", email: "imran@x.in", role: "manager", password: "secret3" }, T), "add manager");
const S1 = ok(call("login", { email: "sameer@x.in", password: "secret1" }), "salesman login").token;
const S2 = ok(call("login", { email: "ayesha@x.in", password: "secret2" }), "salesman2 login").token;
const M = ok(call("login", { email: "imran@x.in", password: "secret3" }), "manager login").token;
check("salesman cannot list users", call("listUsers", {}, S1).code === "FORBIDDEN");
check("salesman cannot add product", call("saveProduct", {}, S1).code === "FORBIDDEN");

// ---- catalog ----
const boot = ok(call("bootstrap", {}, T), "bootstrap");
const cat = (n) => boot.catalog.categories.find((c) => c.name === n).id;
const bc = ok(call("generateBarcode", {}, T), "gen barcode").barcode;
check("barcode format", /^GF\d{6}$/.test(bc), bc);
const asad = ok(
    call("saveProduct", {
        name: "Asad EDP", brand_name: "Lattafa", category_id: cat("Eau De Parfum"), gender: "men", hsn: "3303", gst_rate: 18,
        variants: [{ size_label: "100ml", size_ml: 100, barcode: "0628113420084", mrp: 3500, sell_price: 1950, cost: 1400, opening_stock: 2 }],
    }, T),
    "add product with leading-zero barcode",
);
check("dup barcode rejected", !call("saveProduct", {
    name: "X", category_id: cat("Eau De Parfum"), variants: [{ size_label: "5ml", sell_price: 10, barcode: "0628113420084" }],
}, T).success);
check("price above MRP rejected", !call("saveProduct", {
    name: "Y", category_id: cat("Eau De Parfum"), variants: [{ size_label: "5ml", mrp: 100, sell_price: 110 }],
}, T).success);
ok(call("saveProduct", {
    name: "White Musk (Loose)", brand_name: "Groovy", category_id: cat("Loose Attar"), sale_type: "loose", hsn: "3303", gst_rate: 18,
    variants: [{ size_label: "", mrp: 30, sell_price: 25, cost: 12, opening_stock: 100, barcode: bc }],
}, T), "add loose attar");
ok(call("saveProduct", {
    name: "Crystal Bottle", brand_name: "Groovy", category_id: cat("Fancy Bottles"), gst_rate: 18,
    variants: [{ size_label: "6ml", mrp: 60, sell_price: 50, cost: 20, opening_stock: 10, barcode: "GF900001" }],
}, T), "add bottle");
let catg = ok(call("getCatalog", {}, T), "catalog");
const vAsad = catg.variants.find((v) => v.barcode === "0628113420084");
const vMusk = catg.variants.find((v) => v.barcode === bc);
const vBottle = catg.variants.find((v) => v.barcode === "GF900001");
check("leading zero kept", !!vAsad, catg.variants.map((v) => v.barcode));
check("loose unit ml", vMusk.unit === "ml" && vMusk.size_label === "Loose (per ml)");
check("salesman catalog hides cost", call("getCatalog", {}, S1).data.variants.every((v) => v.avg_cost === undefined));

// ---- stock in (repeat scans merge) ----
const si = ok(call("stockIn", {
    supplier_note: "Lattafa distributor", bill_ref: "B-77",
    lines: [{ variant_id: vAsad.id, qty: 1, unit_cost: 1500 }, { variant_id: vAsad.id, qty: 1, unit_cost: 1500 }, { variant_id: vAsad.id, qty: 1, unit_cost: 1500 }],
}, M), "stock in x3 same item");
check("stock in merged to 5", si.stock.find((s) => s.id === vAsad.id).stock_qty === 5, si);
catg = ok(call("getCatalog", {}, T), "catalog after stock in");
check("weighted avg cost", catg.variants.find((v) => v.id === vAsad.id).avg_cost === 1460, catg.variants.find((v) => v.id === vAsad.id));
check("salesman cannot stock in", call("stockIn", { lines: [{ variant_id: vAsad.id, qty: 1 }] }, S1).code === "FORBIDDEN");

// ---- sale: scanned twice + loose 6ml + bottle, bill discount, split cash+upi ----
const saleReq = {
    client_ref: "abc-1",
    lines: [
        { variant_id: vAsad.id, qty: 1 }, { variant_id: vAsad.id, qty: 1 },
        { variant_id: vMusk.id, qty: 6 }, { variant_id: vBottle.id, qty: 1 },
    ],
    bill_disc: 100,
    customer: { phone: "+91 98765 43210", name: "Rahul" },
    payments: [{ method: "cash", amount: 1000 }, { method: "upi", amount: 3100, reference: "UPI123" }],
    // tampered client price must be ignored
    price_hack: 1,
};
saleReq.lines[0].price = 1;
const sale = ok(call("completeSale", saleReq, S1), "sale by salesman");
const s = sale.sale;
check("invoice format", /^GF\/\d\d-\d\d\/00001$/.test(s.invoice_no), s.invoice_no);
check("gross = 1950*2 + 25*6 + 50", s.gross === 4100, s);
check("grand = 4000", s.grand_total === 4000, s);
check("salesman attributed", s.salesman_name === "Sameer");
check("change 100 from cash", s.change === 100, s);
check("merged into 3 lines", sale.items.length === 3 && sale.items[0].qty === 2);
check("payments cash net of change", sale.payments.find((p) => p.method === "cash").amount === 900, sale.payments);
check("tax adds up", Math.abs(s.cgst + s.sgst + s.taxable - s.grand_total + s.round_off) < 0.02, s);
const again = ok(call("completeSale", saleReq, S1), "retry same client_ref");
check("idempotent retry", again.sale.id === s.id);
catg = ok(call("getCatalog", {}, T), "catalog after sale");
check("stock reduced", catg.variants.find((v) => v.id === vAsad.id).stock_qty === 3);
check("loose ml reduced", catg.variants.find((v) => v.id === vMusk.id).stock_qty === 94);

// ---- salesman rules ----
const sArgs = (o) => Object.assign({ client_ref: "x" + Math.random(), lines: [{ variant_id: vBottle.id, qty: 1 }], payments: [{ method: "cash", amount: 50 }] }, o);
check("salesman cannot sell as another", !call("completeSale", sArgs({ salesman_id: 3 }), S1).success);
check("salesman discount cap", /Discount limit/.test(call("completeSale", sArgs({ bill_disc: 20, payments: [{ method: "cash", amount: 30 }] }), S1).message));
check("short payment rejected", /short/.test(call("completeSale", sArgs({ payments: [{ method: "cash", amount: 40 }] }), S1).message));
check("upi over bill rejected", !call("completeSale", sArgs({ payments: [{ method: "upi", amount: 60 }] }), S1).success);
check("out of stock rejected", /in stock/.test(call("completeSale", sArgs({ lines: [{ variant_id: vAsad.id, qty: 9 }], payments: [{ method: "cash", amount: 99999 }] }), S1).message));
const users = ok(call("listSellers", {}, M), "sellers");
const ayesha = users.find((u) => u.name === "Ayesha");
const mSale = ok(call("completeSale", sArgs({ salesman_id: ayesha.id }), M), "manager bills for Ayesha").sale;
check("manager sold-by other", mSale.salesman_name === "Ayesha" && mSale.created_by !== ayesha.id);

// ---- visibility ----
const s1List = ok(call("listSales", {}, S1), "salesman list").sales;
check("salesman sees only own", s1List.length === 1 && s1List[0].salesman_name === "Sameer", s1List);
check("salesman cannot open other bill", !call("getSale", { id: mSale.id }, S1).success);
check("admin sees all", ok(call("listSales", {}, T), "admin list").sales.length === 2);

// ---- returns + void ----
const vAsadItem = sale.items.find((i) => i.variant_id === vAsad.id);
check("salesman cannot return", call("returnItems", { sale_id: s.id }, S1).code === "FORBIDDEN");
const ret = ok(call("returnItems", { sale_id: s.id, items: [{ sale_item_id: vAsadItem.id, qty: 1, restock: true }], refund_method: "cash", reason: "Wrong size" }, M), "partial return");
check("credit note no", /^GF\/CN\/\d\d-\d\d\/0001$/.test(ret.returns[0].credit_note_no), ret.returns[0]);
check("status part_returned", ret.sale.status === "part_returned");
check("over-return rejected", !call("returnItems", { sale_id: s.id, items: [{ sale_item_id: vAsadItem.id, qty: 2 }], refund_method: "cash", reason: "x" }, M).success);
const voided = ok(call("voidSale", { id: mSale.id, reason: "Customer changed mind" }, M), "void");
check("voided", voided.sale.status === "voided");
check("void twice rejected", !call("voidSale", { id: mSale.id, reason: "x" }, M).success);
catg = ok(call("getCatalog", {}, T), "catalog after return/void");
check("asad restocked", catg.variants.find((v) => v.id === vAsad.id).stock_qty === 4);
check("bottle restored by void", catg.variants.find((v) => v.id === vBottle.id).stock_qty === 9);

// ---- reports ----
const dash = ok(call("dashboard", {}, T), "dashboard");
check("dash today net = 4000 - refund", Math.abs(dash.today.net - (4000 - ret.returns[0].total)) < 0.01, dash.today);
check("leaderboard has Sameer", dash.leaderboard.today.some((r) => r.name === "Sameer"));
const dc = ok(call("report", { type: "day_close" }, T), "day close");
// items sold (for refilling): net of returns, voided bills excluded, current stock shown
const dcItem = (id) => dc.items.find((i) => i.variant_id === id);
check("day close lists Asad net of return", dcItem(vAsad.id) && dcItem(vAsad.id).qty === 1 && dcItem(vAsad.id).stock_left === 4, dcItem(vAsad.id));
check("day close lists loose ml", dcItem(vMusk.id) && dcItem(vMusk.id).qty === 6 && dcItem(vMusk.id).unit === "ml", dcItem(vMusk.id));
check("voided bill items excluded", dcItem(vBottle.id) && dcItem(vBottle.id).qty === 1, dcItem(vBottle.id));
check("salesman day close items own only", call("report", { type: "day_close" }, S2).data.items.length === 0);
const payNet = Object.values(dc.methods).reduce((a, m) => a + m.net, 0);
check("day close payments = net", Math.abs(payNet - dc.net) < 0.01, dc);
check("salesman day close own only", ok(call("report", { type: "day_close" }, S2), "salesman2 day close").bills === 0);
check("salesman no gst report", call("report", { type: "gst_summary" }, S1).success === false);
const gst = ok(call("report", { type: "gst_summary" }, T), "gst");
check("gst totals", Math.abs(gst.totals.total - 4000) < 0.01, gst.totals);
const pr = ok(call("report", { type: "profit" }, T), "profit");
check("profit computed", pr.revenue_ex_gst > 0 && pr.cost_of_goods > 0, pr);
ok(call("report", { type: "salesman_performance", from: "2020-01-01" }, T), "salesman perf");
ok(call("report", { type: "product_sales", group: "brand" }, T), "product sales");
ok(call("report", { type: "stock_valuation" }, T), "stock valuation");
ok(call("report", { type: "sales_register" }, T), "register");
ok(call("saveExpense", { title: "Tea", amount: 60, category: "Tea & Snacks", method: "cash" }, M), "expense");
check("day close expected cash", ok(call("report", { type: "day_close" }, T), "day close 2").cash_expenses === 60);

// ---- GST hidden on bill: same totals/tax, still in GST report ----
const gstBefore = ok(call("report", { type: "gst_summary" }, T), "gst before").totals;
const hid = ok(call("completeSale", sArgs({ gst_hidden: true, lines: [{ variant_id: vBottle.id, qty: 1 }], payments: [{ method: "cash", amount: 50 }] }), M), "sale with GST hidden").sale;
check("gst_hidden stored", hid.gst_hidden === 1, hid);
check("gst hidden: total unchanged", hid.grand_total === 50 && hid.taxable === 42.37 && Math.abs(hid.cgst + hid.sgst - 7.63) < 0.001, hid);
const gstAfter = ok(call("report", { type: "gst_summary" }, T), "gst after").totals;
check("gst hidden sale still in GST report", Math.abs(gstAfter.total - gstBefore.total - 50) < 0.01, { gstBefore, gstAfter });
check("default gst shown", mSale.gst_hidden === 0 && s.gst_hidden === 0);

// ---- A) day-close email from the app ----
env.mails.length = 0;
let em = call("emailDayClose", {}, S1);
check("salesman can email day close", em.success, em);
let mail = env.mails.pop();
check("no list → goes to admins", mail && mail.to === "owner@groovy.test", mail && mail.to);
check("salesman mail is own figures", /\(Sameer\)/.test(mail.subject) && /Your sales/.test(mail.htmlBody) && !/Cash in drawer/.test(mail.htmlBody), mail.subject);
check("reply-to is the sender", mail.replyTo === "sameer@x.in");
ok(call("emailDayClose", { copy_me: true }, M), "manager emails whole shop with copy");
mail = env.mails.pop();
check("manager mail is whole shop", /Whole shop/.test(mail.htmlBody) && /Cash in drawer/.test(mail.htmlBody) && mail.cc === "imran@x.in", mail.cc);
check("mail lists items sold with stock left", /Items sold/.test(mail.htmlBody) && /Asad EDP/.test(mail.htmlBody) && /Stock left/.test(mail.htmlBody) && /Items sold:/.test(mail.body), mail.body);
check("bad report email rejected", !call("saveSettings", { settings: { report_emails: "owner@x.in, not-an-email" } }, T).success);
check("salesman cannot see report emails", call("getSettings", {}, S1).data.report_emails === undefined);
for (let i = 0; i < 4; i++) call("emailDayClose", {}, S1);
check("manual emails limited per day", /already sent 5/.test(call("emailDayClose", {}, S1).message));

// ---- B) nightly email on/off ----
ok(call("saveSettings", { settings: { report_emails: "Owner@X.in; accountant@x.in", nightly_report: "yes", nightly_report_hour: "22" } }, T), "turn nightly on");
const nightlyTriggers = () => env.triggers.filter((x) => x.fn === "sendNightlyReport");
check("one trigger at 22:00 IST", nightlyTriggers().length === 1 && nightlyTriggers()[0].hour === 22 && nightlyTriggers()[0].tz === "Asia/Kolkata", nightlyTriggers());
check("emails normalised", call("getSettings", {}, T).data.report_emails === "owner@x.in, accountant@x.in");
ok(call("saveSettings", { settings: { nightly_report_hour: "21" } }, T), "change hour");
check("still one trigger, new hour", nightlyTriggers().length === 1 && nightlyTriggers()[0].hour === 21);
env.mails.length = 0;
check("nightly sends when on", /: sent$/.test(ctx.sendNightlyReport()) && env.mails.length === 1 && env.mails[0].to === "owner@x.in,accountant@x.in");
const offRes = call("saveSettings", { settings: { nightly_report: "no" } }, T);
check("turn nightly off", offRes.success && /OFF/.test(offRes.message), offRes.message);
check("trigger removed when off", nightlyTriggers().length === 0);
check("nightly does nothing when off", ctx.sendNightlyReport() === "disabled" && env.mails.length === 1);
check("unrelated save keeps trigger state", ok(call("saveSettings", { settings: { tagline: "Smell Of Perfection" } }, T), "unrelated save") !== undefined && nightlyTriggers().length === 0);

// ---- held bills, customers, logs ----
const held = ok(call("holdBill", { label: "Rahul", cart: { lines: [{ variant_id: vAsad.id, qty: 1 }] } }, S1), "hold");
check("held listed", ok(call("listHeld", {}, S1), "list held").length === 1);
ok(call("deleteHeld", { id: held.id }, S1), "delete held");
check("customer created", ok(call("findCustomer", { phone: "9876543210" }, S2), "find cust").name === "Rahul");
check("logs admin only", call("listLogs", {}, M).code === "FORBIDDEN" && ok(call("listLogs", {}, T), "logs").length > 5);

// ---- deactivate kills session ----
ok(call("toggleUser", { id: ayesha.id }, T), "deactivate ayesha");
check("deactivated session rejected", call("getCatalog", {}, S2).code === "AUTH_EXPIRED");
check("cannot delete user with sales", !call("deleteUser", { id: 2 }, T).success);

// ---- password reset via OTP ----
ok(call("forgotPassword", { email: "sameer@x.in" }), "forgot");
const otp = /code is: (\d{6})/.exec(env.mails[env.mails.length - 1].body)[1];
check("wrong otp", !call("resetPassword", { email: "sameer@x.in", otp: "000000", password: "newpass1" }).success);
ok(call("resetPassword", { email: "sameer@x.in", otp, password: "newpass1" }), "reset");
check("old session ended", call("getCatalog", {}, S1).code === "AUTH_EXPIRED");
ok(call("login", { email: "sameer@x.in", password: "newpass1" }), "login new pwd");

// ---- lost replies: retries with the same req_id never save twice ----
const rqStock = () => call("getCatalog", {}, T, 1).data.variants.find((v) => v.id === vBottle.id).stock_qty;
const rq0 = rqStock();
const rqA = call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 2, unit_cost: 40 }] }, T, 1, "req-test-0001");
const rqA2 = call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 2, unit_cost: 40 }] }, T, 1, "req-test-0001");
check("retry with same req_id: saved once", rqA.success && rqStock() === rq0 + 2, { rq0, now: rqStock() });
check("retry with same req_id: same reply", JSON.stringify(rqA2) === JSON.stringify(rqA));
call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 2, unit_cost: 40 }] }, T, 1, "req-test-0002");
check("new req_id: saved again", rqStock() === rq0 + 4);
env.cache.set("rq_req-test-0003", "PENDING");
check("still running → IN_PROGRESS", call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 1 }] }, T, 1, "req-test-0003").code === "IN_PROGRESS" && rqStock() === rq0 + 4);
const rqBad = call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 0 }] }, T, 1, "req-test-0004");
const rqBad2 = call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 3 }] }, T, 1, "req-test-0004");
check("failed try is not remembered", !rqBad.success && rqBad2.success && rqStock() === rq0 + 7, { rqBad, rqBad2 });
const rqR1 = call("getCatalog", {}, T, 1, "req-test-0005");
call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 1 }] }, T, 1, "req-test-0006");
const rqR2 = call("getCatalog", {}, T, 1, "req-test-0005");
check("reads are never replayed", rqR2.data.variants.find((v) => v.id === vBottle.id).stock_qty === rqR1.data.variants.find((v) => v.id === vBottle.id).stock_qty + 1);
check("no req_id works as before", call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 1 }] }, T, 1).success && rqStock() === rq0 + 9);
check("bad req_id ignored", call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 1 }] }, T, 1, "x").success && rqStock() === rq0 + 10);

// ---- CSV import ----
const imp = ok(call("importCatalog", { rows: [
    { brand: "Armaf", product: "Club De Nuit", category: "Eau De Parfum", size_label: "105ml", mrp: 3300, sell_price: 2499, cost: 1800, opening_stock: 3, barcode: "6294015152225" },
    { brand: "Armaf", product: "Club De Nuit", category: "Eau De Parfum", size_label: "30ml", mrp: 1200, sell_price: 899, opening_stock: 2 },
    { brand: "X", product: "", category: "EDP", size_label: "1", sell_price: 1 },
    { brand: "Y", product: "Dup", category: "Eau De Parfum", size_label: "5ml", sell_price: 5, barcode: "6294015152225" },
] }, T), "import");
check("import grouped sizes", imp.products === 1 && imp.variants === 2, imp);
check("import errors reported", imp.errors.length === 2, imp.errors);
// re-upload = update, never duplicate
const cdnRows = () => [
    { brand: "Armaf", product: "Club De Nuit", category: "Eau De Parfum", size_label: "105ml", mrp: 3300, sell_price: 2499, cost: 1800, opening_stock: 3, barcode: "6294015152225" },
    { brand: "Armaf", product: "Club De Nuit", category: "Eau De Parfum", size_label: "30ml", mrp: 1200, sell_price: 899, opening_stock: 2 },
];
const cdnSizes = () => call("getCatalog", {}, T).data.variants.filter((v) => /^(105ml|30ml)$/.test(v.size_label) && call("getCatalog", {}, T).data.products.find((x) => x.id === v.product_id).name === "Club De Nuit");
const cdn105 = () => cdnSizes().find((v) => v.size_label === "105ml");
const cdn30 = () => cdnSizes().find((v) => v.size_label === "30ml");
const stock105 = cdn105().stock_qty;
const reImp = ok(call("importCatalog", { rows: cdnRows() }, T), "re-import same file");
check("re-import: nothing added or updated", reImp.variants === 0 && reImp.products === 0 && reImp.updated === 0 && reImp.unchanged === 2, reImp);
check("re-import: no duplicate sizes", cdnSizes().length === 2, cdnSizes().map((v) => v.size_label));
check("re-import: opening stock ignored + reported", cdn105().stock_qty === stock105 && reImp.stock_ignored === 2, reImp);
const impUpd = ok(call("importCatalog", { rows: [{ brand: "armaf", product: "club de nuit", size_label: "105 ML", sell_price: 2399, opening_stock: 9 }] }, T), "import price change");
check("import update: price saved", impUpd.updated === 1 && cdn105().sell_price === 2399, impUpd);
check("import update: blank cells kept", cdn105().mrp === 3300 && cdn105().stock_qty === stock105);
ok(call("importCatalog", { rows: [{ brand: "Armaf", product: "Club De Nuit", size_label: "30ml", barcode: "6294015100001" }] }, T), "import adds barcode");
check("import update: barcode set on existing size", cdn30().barcode === "6294015100001" && cdnSizes().length === 2);
const clash2 = ok(call("importCatalog", { rows: [
    { brand: "Armaf", product: "Club De Nuit", size_label: "30ml", barcode: "6294015199999" },
    { brand: "Someone", product: "Else", category: "Eau De Parfum", size_label: "10ml", sell_price: 100, barcode: "6294015152225" },
    { brand: "Armaf", product: "Club De Nuit", size_label: "30ml", sale_type: "loose" },
    { brand: "Armaf", product: "Club De Nuit", category: "Eau De Parfum", size_label: "200ml", sell_price: 3999 },
    { brand: "Armaf", product: "Club De Nuit", category: "Eau De Parfum", size_label: "200ml", sell_price: 3999 },
] }, T), "import conflicts");
const impMsgs = clash2.errors.map((e) => e.row + ":" + e.message).join(" | ");
check("import: size already has other barcode", /2:Size 30ml already has barcode/.test(impMsgs), impMsgs);
check("import: barcode of another product", /3:Barcode 6294015152225 belongs to Armaf Club De Nuit/.test(impMsgs), impMsgs);
check("import: packed/loose change refused", /4:Can't change packed\/loose/.test(impMsgs), impMsgs);
check("import: new size added once, repeat refused", clash2.variants === 1 && /6:Repeats an earlier row/.test(impMsgs), clash2);

// SKU works as a key like the barcode (website exports carry SKU-0001 …)
const skuVar = (sku) => call("getCatalog", {}, T).data.variants.find((v) => String(v.sku).toUpperCase() === sku.toUpperCase());
const prodNameOf = (v) => call("getCatalog", {}, T).data.products.find((x) => x.id === v.product_id).name;
const skuNew = ok(call("importCatalog", { rows: [
    { brand: "Groovy Fragrances", product: "Flora Inspired Perfume | Unisex", new_category: "Eau De Parfum", size_label: "30ml", size_ml: 30, sell_price: 350, mrp: 350, sku: "SKU-0001", barcode: "2220631", opening_stock: 47, gst_rate: 18 },
    { brand: "Groovy Fragrances", product: "Chocolate Musk Roll-On Attar", new_category: "Packed Attar", size_label: "12ml", sell_price: 400, sku: "SKU-0020", barcode: "800006" },
] }, T, 1), "import with SKUs and new_category");
check("new products use new_category", skuNew.products === 2 && call("getCatalog", {}, T).data.categories.find((c) => c.id === call("getCatalog", {}, T).data.products.find((x) => x.name === "Chocolate Musk Roll-On Attar").category_id).name === "Packed Attar");
check("SKU stored, opening stock for the new size", skuVar("SKU-0001") && skuVar("SKU-0001").stock_qty === 47);
// rename in the app, then re-import by SKU with the website name and a new price
const floraVar = skuVar("SKU-0001");
const floraProd = call("getCatalog", {}, T).data.products.find((x) => x.id === floraVar.product_id);
ok(call("saveProduct", Object.assign({}, floraProd, { name: "Flora 30", brand_name: "Groovy Fragrances", variants: [{ id: floraVar.id, size_label: "30ml", barcode: floraVar.barcode, sell_price: 350, mrp: 350 }] }), T, 1), "rename product in app (old app: no sku sent)");
check("saving without sku keeps the SKU", skuVar("SKU-0001") && skuVar("SKU-0001").id === floraVar.id);
const bySkuUpd = ok(call("importCatalog", { rows: [
    { brand: "Groovy Fragrances", product: "Flora Inspired Perfume | Unisex", size_label: "30ML", sell_price: 375, mrp: 400, sku: "sku-0001", opening_stock: 999, new_category: "Packed Attar" },
] }, T, 1), "re-import by SKU, other name");
check("SKU match updates price, keeps app name, ignores stock", bySkuUpd.updated === 1 && skuVar("SKU-0001").sell_price === 375 && prodNameOf(skuVar("SKU-0001")) === "Flora 30" && skuVar("SKU-0001").stock_qty === 47, bySkuUpd);
check("new_category never changes an existing product", call("getCatalog", {}, T).data.products.find((x) => x.id === floraVar.product_id).category_id === floraProd.category_id);
// SKU filled in on a size found by brand + product + size
ok(call("importCatalog", { rows: [{ brand: "Armaf", product: "Club De Nuit", size_label: "105ml", sku: "SKU-CDN-105" }] }, T), "fill SKU by name+size");
check("SKU filled on matched size", skuVar("SKU-CDN-105") && prodNameOf(skuVar("SKU-CDN-105")) === "Club De Nuit");
const skuConf = ok(call("importCatalog", { rows: [
    { brand: "Armaf", product: "Club De Nuit", size_label: "105ml", sku: "SKU-OTHER" },
    { brand: "X", product: "Y", size_label: "30ml", sell_price: 5, barcode: "2220631", sku: "SKU-0020" },
    { brand: "Nope", product: "Wrong Name", size_label: "30ml", sell_price: 5, barcode: "6294015152225" },
    { brand: "Nope", product: "Wrong Name", size_label: "12ml", sell_price: 410, mrp: 450, barcode: "800006", sku: "SKU-0020" },
] }, T, 1), "SKU conflicts");
const skuMsgs = skuConf.errors.map((e) => e.row + ":" + e.message).join(" | ");
check("size already has another SKU", /2:Size 105ml already has SKU SKU-CDN-105/.test(skuMsgs), skuMsgs);
check("barcode and SKU of different items", /3:Barcode 2220631 and SKU SKU-0020 belong to different items/.test(skuMsgs), skuMsgs);
check("barcode + other name without SKU still refused", /4:Barcode 6294015152225 belongs to/.test(skuMsgs), skuMsgs);
check("barcode + other name allowed when SKU agrees", skuConf.updated === 1 && skuVar("SKU-0020").sell_price === 410 && prodNameOf(skuVar("SKU-0020")) === "Chocolate Musk Roll-On Attar", skuConf);
const skuAgain = ok(call("importCatalog", { rows: [{ brand: "Groovy Fragrances", product: "Flora Inspired Perfume | Unisex", size_label: "30ML", sell_price: 375, mrp: 400, sku: "SKU-0001" }] }, T, 1), "same SKU row again");
check("same SKU file again: unchanged, no duplicate", skuAgain.unchanged === 1 && skuAgain.variants === 0 && call("getCatalog", {}, T).data.variants.filter((v) => String(v.sku).toUpperCase() === "SKU-0001").length === 1);
// saveProduct: duplicate SKU refused, explicit SKU edit saved
const dupSku = call("saveProduct", { name: "Dup Sku", brand_name: "X", category_id: cat("Eau De Parfum"), gst_rate: 18, variants: [{ size_label: "10ml", sell_price: 100, sku: "sku-0001" }] }, T, 1);
check("saveProduct refuses a duplicate SKU", !dupSku.success && /SKU sku-0001 already belongs to/.test(dupSku.message), dupSku);
ok(call("saveProduct", Object.assign({}, floraProd, { name: "Flora 30", brand_name: "Groovy Fragrances", variants: [{ id: floraVar.id, size_label: "30ml", barcode: floraVar.barcode, sell_price: 375, mrp: 400, sku: "SKU-0001-B" }] }), T, 1), "edit SKU in app");
check("SKU edited in app", skuVar("SKU-0001-B") && skuVar("SKU-0001-B").id === floraVar.id);

// ---- setup upgrades an older sheet that lacks a newly added trailing column ----
const salesSh = env.ss.getSheetByName("Sales");
const lastCol = require("vm").runInContext("Object.keys(SCHEMA.Sales).length", ctx);
salesSh.getRange(1, lastCol).setValue(""); // simulate sheet created before gst_hidden existed
salesSh.deleteColumns(lastCol, 1);
ctx.setupSheets();
const upMsg = env.alerts.pop();
const lastKey = require("vm").runInContext("Object.keys(SCHEMA.Sales).pop()", ctx);
check("setup migration adds column", salesSh.getRange(1, lastCol).getValues()[0][0] === lastKey && upMsg.indexOf(lastKey) >= 0, upMsg);
check("sales readable after migration", ok(call("listSales", {}, T), "list after migration").sales.length > 0);

// ================= multiple branches =================
const branchesErr = (r) => r.code === "BRANCH";
check("prefix+code over 4 chars rejected", !call("saveBranch", { name: "X", code: "KNX" }, T).success);
check("second blank code rejected", !call("saveBranch", { name: "Blank" }, T).success);
const KN = ok(call("saveBranch", { name: "Kalyani Nagar", code: "kn", report_emails: "kn@x.in" }, T), "add branch KN").id;
ok(call("saveBranch", { id: 1, name: "Kondhwa", code: "" }, T), "rename branch 1");
check("code with bills can't change", !call("saveBranch", { id: 1, name: "Kondhwa", code: "KD" }, T).success);

// staff: Ravi works anywhere (home Kondhwa), Kiran only at KN, Meena manages KN only
ok(call("saveUser", { name: "Ravi", email: "ravi@x.in", role: "salesman", password: "secret4", branch_id: 1 }, T), "add Ravi");
ok(call("saveUser", { name: "Kiran", email: "kiran@x.in", role: "salesman", password: "secret5", branch_id: KN, branch_ids: [KN] }, T), "add Kiran");
ok(call("saveUser", { name: "Meena", email: "meena@x.in", role: "manager", password: "secret6", branch_id: KN, branch_ids: [KN] }, T), "add Meena");
const RAVI = ok(call("login", { email: "ravi@x.in", password: "secret4" }), "Ravi login");
const KIRAN = ok(call("login", { email: "kiran@x.in", password: "secret5" }), "Kiran login");
const MEENA = ok(call("login", { email: "meena@x.in", password: "secret6" }), "Meena login").token;
check("Ravi may use both branches", RAVI.user.branch_ids.length === 2 && RAVI.user.home_branch_id === 1, RAVI.user);
check("Kiran limited to KN", KIRAN.user.branch_ids.join() === String(KN) && KIRAN.user.home_branch_id === KN, KIRAN.user);

// transfer Kondhwa → KN
const stockAt = (b, vid) => call("getCatalog", {}, T, b).data.variants.find((v) => v.id === vid).stock_qty;
const kdBottleBefore = stockAt(1, vBottle.id);
const tr = ok(call("transferStock", { to_branch_id: KN, lines: [{ variant_id: vBottle.id, qty: 2 }, { variant_id: vBottle.id, qty: 1 }] }, T, 1), "transfer 3 to KN");
check("transfer no", /^TR\d{5}$/.test(tr.transfer_no), tr);
check("stock moved out of Kondhwa", stockAt(1, vBottle.id) === kdBottleBefore - 3);
check("stock moved into KN", stockAt(KN, vBottle.id) === 3);
check("all-branches total", stockAt(0, vBottle.id) === kdBottleBefore);
check("stock_by_branch in catalog", call("getCatalog", {}, T, KN).data.variants.find((v) => v.id === vBottle.id).stock_by_branch[KN] === 3);
check("over-transfer rejected", /Only/.test(call("transferStock", { to_branch_id: KN, lines: [{ variant_id: vBottle.id, qty: 999 }] }, T, 1).message));
check("salesman cannot transfer", call("transferStock", { to_branch_id: 1, lines: [{ variant_id: vBottle.id, qty: 1 }] }, KIRAN.token).code === "FORBIDDEN");
check("KN manager cannot transfer out of Kondhwa", branchesErr(call("transferStock", { to_branch_id: KN, lines: [{ variant_id: vBottle.id, qty: 1 }] }, MEENA, 1)));
check("transfer listed", ok(call("listTransfers", {}, MEENA), "transfers at KN").some((t) => t.id === tr.id && t.items.length === 1 && t.items[0].qty === 3));

// sales per branch
const sellArgs = (o) => Object.assign({ client_ref: "br" + Math.random(), lines: [{ variant_id: vBottle.id, qty: 1 }], payments: [{ method: "cash", amount: 50 }] }, o);
const kSale = ok(call("completeSale", sellArgs({}), KIRAN.token), "Kiran sells at KN (home)").sale;
check("KN bill series", /^GFKN\/\d\d-\d\d\/00001$/.test(kSale.invoice_no) && kSale.branch_id === KN, kSale.invoice_no);
check("sale took KN stock only", stockAt(KN, vBottle.id) === 2 && stockAt(1, vBottle.id) === kdBottleBefore - 3);
check("Kiran can't sell at Kondhwa", branchesErr(call("completeSale", sellArgs({}), KIRAN.token, 1)));
const rKN = ok(call("completeSale", sellArgs({}), RAVI.token, KN), "Ravi sells at KN").sale;
const rKD = ok(call("completeSale", sellArgs({}), RAVI.token, 1), "Ravi switches to Kondhwa and sells").sale;
check("Ravi KN bill in KN series", /^GFKN\/\d\d-\d\d\/00002$/.test(rKN.invoice_no), rKN.invoice_no);
check("Ravi Kondhwa bill in main series", /^GF\/\d\d-\d\d\/\d{5}$/.test(rKD.invoice_no) && rKD.branch_id === 1, rKD.invoice_no);
const raviList = ok(call("listSales", {}, RAVI.token, 1), "Ravi's sales").sales;
check("salesman sees own bills from both branches", raviList.length === 2 && raviList.some((x) => x.branch_name === "Kalyani Nagar") && raviList.some((x) => x.branch_name === "Kondhwa"), raviList);
const sellersKN = ok(call("listSellers", {}, T, KN), "sellers at KN");
const sellersKD = ok(call("listSellers", {}, T, 1), "sellers at KD");
check("sold-by list is per branch", sellersKN.some((u) => u.name === "Kiran") && sellersKN.some((u) => u.name === "Sameer") && sellersKD.every((u) => u.name !== "Kiran" && u.name !== "Meena"));
check("seller must work at the branch", /does not work at/.test(call("completeSale", sellArgs({ salesman_id: KIRAN.user.id }), T, 1).message));

// returns & voids only at the selling branch
const kItem = ok(call("getSale", { id: kSale.id }, MEENA), "KN manager opens KN bill").items[0];
check("return refused at another branch", /made at Kalyani Nagar/.test(call("returnItems", { sale_id: kSale.id, items: [{ sale_item_id: kItem.id, qty: 1 }], refund_method: "cash", reason: "x" }, T, 1).message));
const kRet = ok(call("returnItems", { sale_id: kSale.id, items: [{ sale_item_id: kItem.id, qty: 1 }], refund_method: "cash", reason: "Leaked" }, MEENA), "return at KN");
check("KN credit note series", /^GFKNC\/\d\d-\d\d\/0001$/.test(kRet.returns[0].credit_note_no), kRet.returns[0].credit_note_no);
check("returned stock back at KN", stockAt(KN, vBottle.id) === 2);
check("void refused at another branch", /made at Kalyani Nagar/.test(call("voidSale", { id: rKN.id, reason: "x" }, T, 1).message));
ok(call("voidSale", { id: rKN.id, reason: "Test" }, T, KN), "void at KN");
check("KN manager can't open a Kondhwa bill", !call("getSale", { id: rKD.id }, MEENA).success);

// admin "All branches"
check("no selling on All branches", branchesErr(call("completeSale", sellArgs({}), T, 0)));
check("no stock in on All branches", branchesErr(call("stockIn", { lines: [{ variant_id: vBottle.id, qty: 1 }] }, T, 0)));
const dashAll = ok(call("dashboard", {}, T, 0), "dashboard all branches");
check("dashboard per-branch rows", dashAll.by_branch && dashAll.by_branch.length === 2 && dashAll.by_branch.some((b) => b.name === "Kalyani Nagar" && b.bills >= 1), dashAll.by_branch);
const dcKN = ok(call("report", { type: "day_close" }, T, KN), "day close KN");
check("KN day close only KN bills", dcKN.bills === 1 && dcKN.branch_name === "Kalyani Nagar", { bills: dcKN.bills });
const dcAll = ok(call("report", { type: "day_close" }, T, 0), "day close all");
check("all-branches day close has breakdown", dcAll.by_branch.length === 2 && Math.abs(dcAll.by_branch.reduce((a, b) => a + b.net, 0) - dcAll.net) < 0.01, dcAll.by_branch);
check("salesman can't use All", branchesErr(call("dashboard", {}, RAVI.token, 999)));

// expenses & held bills stay with their branch
ok(call("saveExpense", { title: "KN tea", amount: 40, method: "cash" }, MEENA), "KN expense");
check("KN expense not in Kondhwa list", !ok(call("listExpenses", {}, T, 1), "KD expenses").expenses.some((e) => e.title === "KN tea"));
check("KN expense in KN list", ok(call("listExpenses", {}, T, KN), "KN expenses").expenses.some((e) => e.title === "KN tea" && e.branch_name === "Kalyani Nagar"));
ok(call("holdBill", { label: "KN hold", cart: { lines: [{ variant_id: vBottle.id, qty: 1 }] } }, KIRAN.token), "hold at KN");
check("held bill not visible at Kondhwa", !ok(call("listHeld", {}, T, 1), "held KD").some((h) => h.label === "KN hold"));

// nightly email: one per branch, branch list + owner list
ok(call("saveSettings", { settings: { nightly_report: "yes", nightly_report_skip_empty: "no" } }, T), "nightly on for branch test");
env.mails.length = 0;
const nightly = ctx.sendNightlyReport();
check("one nightly email per branch", env.mails.length === 2 && /Kondhwa: sent/.test(nightly) && /Kalyani Nagar: sent/.test(nightly), nightly);
const knMail = env.mails.find((m) => /Kalyani Nagar/.test(m.subject));
check("KN email to KN list + owner list", knMail && knMail.to.split(",")[0] === "kn@x.in" && knMail.to.indexOf("owner@x.in") > 0, knMail && knMail.to);
ok(call("saveSettings", { settings: { nightly_report: "no" } }, T), "nightly off again");

// migration: stock counted before branches existed moves to branch 1
const envM = createEnv();
envM.ctx.setupSheets();
require("vm").runInContext(`appendRows_("Variants", [{ id: 1, product_id: 1, sku: "", barcode: "OLD1", size_label: "100ml", size_ml: 100, unit: "pcs", mrp: 10, sell_price: 10, avg_cost: 5, stock_qty: 7, reorder_level: 0, active: 1 }]);`, envM.ctx);
envM.ctx.setupSheets();
check("old stock moved to branch 1", require("vm").runInContext("stockOf_(1, 1)", envM.ctx) === 7);

// ================= final-review fixes =================
const vmRun = (code, c = ctx) => require("vm").runInContext(code, c);
// day close money is per branch
const methodsNet = (d) => Object.values(d.methods).reduce((a, m) => a + m.net, 0);
const dcKN2 = ok(call("report", { type: "day_close" }, T, KN), "day close KN (money)");
const dcKD2 = ok(call("report", { type: "day_close" }, T, 1), "day close KD (money)");
const dcAll2 = ok(call("report", { type: "day_close" }, T, 0), "day close all (money)");
check("KN money only KN", Math.abs(methodsNet(dcKN2) - dcKN2.net) < 0.01, { money: methodsNet(dcKN2), net: dcKN2.net });
check("KD money only KD", Math.abs(methodsNet(dcKD2) - dcKD2.net) < 0.01, { money: methodsNet(dcKD2), net: dcKD2.net });
check("branch money adds up to all", Math.abs(methodsNet(dcKN2) + methodsNet(dcKD2) - methodsNet(dcAll2)) < 0.01);
// cost prices hidden from salesmen in bill details
const rSale = ok(call("getSale", { id: rKD.id }, RAVI.token, 1), "salesman opens own bill");
check("salesman bill detail has no cost", rSale.items.every((i) => i.unit_cost === undefined));
check("manager bill detail keeps cost", ok(call("getSale", { id: kSale.id }, MEENA), "manager bill").items.every((i) => i.unit_cost !== undefined));
// expenses: KN-only manager can't touch a Kondhwa expense
const kdExp = ok(call("saveExpense", { title: "KD rent", amount: 100, method: "cash" }, T, 1), "KD expense").id;
check("KN manager can't delete KD expense", /another branch/.test(call("deleteExpense", { id: kdExp }, MEENA).message));
check("KN manager can't edit KD expense", /another branch/.test(call("saveExpense", { id: kdExp, title: "x", amount: 1 }, MEENA).message));
// staff whose only branch is closed can't fall into "all branches"
const TMP = ok(call("saveBranch", { name: "Temp", code: "TP" }, T), "temp branch").id;
ok(call("saveUser", { name: "Tina", email: "tina@x.in", role: "salesman", password: "secret7", branch_id: TMP, branch_ids: [TMP] }, T), "add Tina");
const TINA = ok(call("login", { email: "tina@x.in", password: "secret7" }), "Tina login").token;
ok(call("saveBranch", { id: TMP, name: "Temp", code: "TP", active: 0 }, T), "close temp branch");
check("staff with no active branch refused", branchesErr(call("dashboard", {}, TINA)) && branchesErr(call("listSales", {}, TINA, 0)));
// old sessions are cleaned up at login
vmRun(`appendRows_("Sessions", [{ token: "x".repeat(64), user_id: ${RAVI.user.id}, created_at: "2020-01-01 00:00:00", expires_at: "2020-02-01 00:00:00", device: "old" }]);`);
ok(call("login", { email: "ravi@x.in", password: "secret4" }), "Ravi logs in again");
check("expired sessions removed", !vmRun(`resetReqCache_(); rows_("Sessions").some((s) => s.device === "old")`));
// sheet not upgraded after a code update → clear message, not a crash
envM.ss.getSheetByName("Sales").getRange(1, schemaColsOf("Sales", envM)).setValue("");
check("outdated sheet gives Setup message", vmRun(`resetReqCache_(); (() => { try { rows_("Sales"); return "no error"; } catch (e) { return e.code; } })()`, envM.ctx) === "SETUP");
envM.ctx.setupSheets(); // repairs it again
function schemaColsOf(name, e) {
    return require("vm").runInContext(`Object.keys(SCHEMA.${name}).length`, e.ctx);
}

// ---- setup never deletes the owner's own columns ----
const salesTab = env.ss.getSheetByName("Sales");
const schemaCols = require("vm").runInContext("Object.keys(SCHEMA.Sales).length", ctx);
const before = ok(call("listSales", { from: "2000-01-01" }, T, 0), "sales before own column").summary;
salesTab.insertColumnsAfter(salesTab.getMaxColumns(), 1);
salesTab.getRange(1, schemaCols + 1).setValue("Remarks");
salesTab.getRange(2, schemaCols + 1).setValue("VIP customer");
ctx.setupSheets();
const keptMsg = env.alerts.pop();
check("own column kept by setup", salesTab.getRange(2, schemaCols + 1).getValues()[0][0] === "VIP customer" && /Kept your extra columns in: Sales/.test(keptMsg), keptMsg);
const after = ok(call("listSales", { from: "2000-01-01" }, T, 0), "sales with own column").summary;
check("app unaffected by own column", after.bills === before.bills && after.net === before.net, { before, after });
check("empty spare columns still trimmed on new sheets", envM.ss.getSheetByName("Sales").getMaxColumns() === schemaCols);

// ---- delete a product added by mistake (admin, never used) ----
const mistake = ok(call("saveProduct", {
    name: "Typo Oud", brand_name: "Lattafa", category_id: cat("Eau De Parfum"), hsn: "3303", gst_rate: 18,
    variants: [{ size_label: "50ml", barcode: "DEL0001", mrp: 900, sell_price: 800, cost: 500, opening_stock: 3 }],
}, T, 1), "add mistaken product").id;
const mistakeVid = () => vmRun(`resetReqCache_(); (rows_("Variants").find((v) => v.barcode === "DEL0001") || {}).id || 0`);
const mVid = mistakeVid();
check("manager cannot delete product", call("deleteProduct", { id: mistake }, M, 1).code === "FORBIDDEN");
const RAVI2 = ok(call("login", { email: "ravi@x.in", password: "secret4" }), "Ravi login for delete test").token;
const sDel = call("deleteProduct", { id: mistake }, RAVI2, 1);
check("salesman cannot delete product", sDel.code === "FORBIDDEN", sDel);
const heldDel = ok(call("holdBill", { label: "del test", cart: { lines: [{ variant_id: mVid, qty: 1 }] } }, T, 1), "hold mistaken product");
check("held bill blocks delete", /held bill/.test(call("deleteProduct", { id: mistake }, T, 1).message || ""));
ok(call("deleteHeld", { id: heldDel.id }, T, 1), "drop held bill");
ok(call("deleteProduct", { id: mistake }, T, 1), "admin deletes unused product");
check("product rows gone", vmRun(`resetReqCache_(); !rows_("Products").some((p) => p.id === ${mistake}) && !rows_("Variants").some((v) => v.id === ${mVid}) && !rows_("Branch_Stock").some((b) => b.variant_id === ${mVid}) && !rows_("Stock_Movements").some((m) => m.variant_id === ${mVid})`));
check("gone from catalog", !call("getCatalog", {}, T, 1).data.variants.some((v) => v.barcode === "DEL0001"));
check("delete logged", vmRun(`resetReqCache_(); rows_("Activity_Logs").some((l) => l.action === "DELETE" && l.entity === "Products" && /Typo Oud/.test(l.details))`));
ok(call("saveProduct", {
    name: "Real Oud", brand_name: "Lattafa", category_id: cat("Eau De Parfum"), hsn: "3303", gst_rate: 18,
    variants: [{ size_label: "50ml", barcode: "DEL0001", mrp: 900, sell_price: 800 }],
}, T, 1), "barcode reusable after delete");
const usedDel = call("deleteProduct", { id: asad.id }, T, 1);
check("sold product cannot be deleted", !usedDel.success && /hide it instead/.test(usedDel.message), usedDel);
check("sold product still there", call("getCatalog", {}, T, 1).data.variants.some((v) => v.barcode === "0628113420084"));

// ---- delete an empty category (admin) ----
const tempCat = ok(call("saveCategory", { name: "Temp Cat", default_hsn: "3307", default_gst: 18 }, T), "add temp category").id;
check("manager cannot delete category", call("deleteCategory", { id: tempCat }, M).code === "FORBIDDEN");
ok(call("deleteCategory", { id: tempCat }, T), "admin deletes empty category");
check("category gone from catalog", !call("getCatalog", {}, T, 1).data.categories.some((c) => c.id === tempCat));
check("category delete logged", vmRun(`resetReqCache_(); rows_("Activity_Logs").some((l) => l.action === "DELETE" && l.entity === "Categories" && l.details === "Temp Cat")`));
const usedCat = call("deleteCategory", { id: cat("Eau De Parfum") }, T);
check("category in use refused", !usedCat.success && /hide it instead/.test(usedCat.message), usedCat);
const hidCat = ok(call("saveCategory", { name: "Hidden Only", default_gst: 18 }, T), "add category for hidden product").id;
const hidProd = ok(call("saveProduct", { name: "Hidden Thing", brand_name: "Groovy", category_id: hidCat, hsn: "3307", gst_rate: 18,
    variants: [{ size_label: "1 pc", sell_price: 10 }] }, T, 1), "product in that category").id;
ok(call("toggleProduct", { id: hidProd }, T), "hide that product");
check("category with only a hidden product refused", /Used by 1 product /.test(call("deleteCategory", { id: hidCat }, T).message || ""));
const envC = createEnv();
envC.ctx.setupSheets();
const cPwd = /Password: (\S+)/.exec(envC.alerts.pop())[1];
const CT = envC.call("login", { email: "owner@groovy.test", password: cPwd }).data.token;
const allCats = envC.call("getCatalog", {}, CT).data.categories;
allCats.slice(1).forEach((c) => envC.call("deleteCategory", { id: c.id }, CT));
const lastCat = envC.call("deleteCategory", { id: allCats[0].id }, CT);
check("last category kept", !lastCat.success && /at least one/.test(lastCat.message) && envC.call("getCatalog", {}, CT).data.categories.length === 1, lastCat);

// ---- invoice PDFs in Drive ----
const gpFolder = env.drive.root.createFolder("Groovy POS");
env.drive.sheetFile.parent = gpFolder; // the owner moved the Sheet into "Groovy POS"
const pdfFiles = () => env.drive.files().filter((f) => !f.trashed && /\.pdf$/.test(f.name));
const pathOf = (f) => { const p = []; let x = f.parent; while (x) { p.unshift(x.name); x = x.parent; } return p.join("/"); };
check("PDF timer installed every 15 min", env.triggers.some((x) => x.fn === "savePendingInvoicePdfs" && x.minutes === 15), env.triggers);
const pdfSaleReq = { client_ref: "pdf-1", lines: [{ variant_id: vBottle.id, qty: 1 }], customer: { phone: "9876500001", name: "<b>Evil</b> & Co" }, payments: [{ method: "cash", amount: 50 }] };
const pdfSale = ok(call("completeSale", pdfSaleReq, T, 1), "sale for PDF").sale;
const pdf1 = ok(call("saveInvoicePdf", { id: pdfSale.id }, T, 1), "save PDF manually");
const pdfFile = pdfFiles().find((f) => f.name === pdfSale.invoice_no.replace(/\//g, "-") + ".pdf");
const fyDir = (d) => require("vm").runInContext("fyFolderName_(" + JSON.stringify(String(d)) + ")", ctx);
const monthDir = (d) => "My Drive/Groovy POS/Sales_Invoices/" + fyDir(d) + "/" + String(d).slice(5, 7);
check("PDF saved in Sales_Invoices/FY yyyy-yy/MM/<kind>", !!pdfFile && pathOf(pdfFile) === monthDir(pdfSale.date) + "/Non-GST", pdfFile && pathOf(pdfFile));
check("FY folder names", fyDir("2026-09-19") === "FY 2026-27" && fyDir("2027-02-10") === "FY 2026-27" && fyDir("2026-03-31") === "FY 2025-26" && fyDir("2099-12-01") === "FY 2099-00");
const febFolder = require("vm").runInContext('invoiceFolder_("2026-02-15", false)', ctx);
check("Feb bill goes to FY 2025-26/02", pathOf({ parent: febFolder }) === "My Drive/Groovy POS/Sales_Invoices/FY 2025-26/02/Non-GST", pathOf({ parent: febFolder }));

// GST bills go to the accountant's folder; bills without GST (or with no GSTIN set) go next door
ok(call("saveSettings", { settings: { gstin: "27ABCDE1234F1Z5" } }, T), "set GSTIN");
const gstSale = ok(call("completeSale", { client_ref: "pdf-gst", lines: [{ variant_id: vBottle.id, qty: 1 }], payments: [{ method: "cash", amount: 50 }] }, T, 1), "GST bill").sale;
ok(call("saveInvoicePdf", { id: gstSale.id }, T, 1), "save GST bill PDF");
const gstFile = pdfFiles().find((f) => f.name.startsWith(gstSale.invoice_no.replace(/[/]/g, "-")));
check("bill with GST → GST folder", gstFile && pathOf(gstFile) === monthDir(gstSale.date) + "/GST", gstFile && pathOf(gstFile));
const noGstSale = ok(call("completeSale", { client_ref: "pdf-nogst", gst_hidden: true, lines: [{ variant_id: vBottle.id, qty: 1 }], payments: [{ method: "cash", amount: 50 }] }, T, 1), "bill without GST shown").sale;
ok(call("saveInvoicePdf", { id: noGstSale.id }, T, 1), "save non-GST bill PDF");
const noGstFile = pdfFiles().find((f) => f.name.startsWith(noGstSale.invoice_no.replace(/[/]/g, "-")));
check("bill with GST hidden → Non-GST folder", noGstFile && pathOf(noGstFile) === monthDir(noGstSale.date) + "/Non-GST", noGstFile && pathOf(noGstFile));
// a credit note is filed with its bill
const gstDetail = ok(call("getSale", { id: gstSale.id }, T, 1), "GST bill detail");
ok(call("returnItems", { sale_id: gstSale.id, items: [{ sale_item_id: gstDetail.items[0].id, qty: 1, restock: true }], refund_method: "cash", reason: "test" }, T, 1), "return on the GST bill");
ctx.savePendingInvoicePdfs();
const cnFile = pdfFiles().filter((f) => /C-|CN-/.test(f.name)).pop();
check("credit note filed with its bill", cnFile && pathOf(cnFile).endsWith("/GST"), cnFile && pathOf(cnFile));
ok(call("saveSettings", { settings: { gstin: "" } }, T), "clear GSTIN again");
check("pdf_url stored on the bill", !!pdf1.pdf_url && ok(call("getSale", { id: pdfSale.id }, T, 1), "bill detail").sale.pdf_url === pdf1.pdf_url);
check("PDF html escapes customer name", pdfFile && pdfFile.html.includes("&lt;b&gt;Evil&lt;/b&gt; &amp; Co") && !pdfFile.html.includes("<b>Evil"));
const pdfCount = pdfFiles().length;
const pdf2 = ok(call("saveInvoicePdf", { id: pdfSale.id }, T, 1), "save PDF again");
check("second press: already saved, no duplicate file", pdf2.already === true && pdfFiles().length === pdfCount);
const RAVI3 = ok(call("login", { email: "ravi@x.in", password: "secret4" }), "Ravi login for PDF").token;
check("salesman can't save someone else's bill PDF", call("saveInvoicePdf", { id: pdfSale.id }, RAVI3, 1).code === "FORBIDDEN");
// GST hidden → plain INVOICE without HSN/GST columns
const hidSale = ok(call("completeSale", Object.assign({}, pdfSaleReq, { client_ref: "pdf-2", gst_hidden: true, customer: {} }), T, 1), "gst-hidden sale").sale;
ok(call("saveInvoicePdf", { id: hidSale.id }, T, 1), "save gst-hidden PDF");
const hidFile = pdfFiles().find((f) => f.name.startsWith(hidSale.invoice_no.replace(/\//g, "-")));
check("GST hidden: no HSN / tax columns", hidFile && !hidFile.html.includes(">HSN<") && !hidFile.html.includes("TAX INVOICE") && hidFile.html.includes("INVOICE"));
// void after the PDF exists → timer renames it -VOID
ok(call("voidSale", { id: pdfSale.id, reason: "test" }, T, 1), "void PDF sale");
require("vm").runInContext("resetReqCache_()", ctx);
const jobDone = ctx.savePendingInvoicePdfs();
check("timer: renames voided bill's PDF", pdfFile.name === pdfSale.invoice_no.replace(/\//g, "-") + "-VOID.pdf", pdfFile.name);
const pdfLeft = require("vm").runInContext('resetReqCache_(); rows_("Sales").filter((s) => !s.pdf_url).length + rows_("Returns").filter((r) => !r.pdf_url).length', ctx);
check("timer: every bill and credit note now has a PDF", jobDone > 0 && pdfLeft === 0, { jobDone, pdfLeft });
check("credit notes saved as PDFs", require("vm").runInContext('rows_("Returns").every((r) => r.pdf_url)', ctx) &&
    pdfFiles().some((f) => /C-|CN-/.test(f.name) && f.html.includes("CREDIT NOTE")));
// old yyyy-MM folders (before the FY layout) are moved into FY …/MM by the timer; links stay the same
let pdfRootF = pdfFile.parent; // walk up to Sales_Invoices
while (pdfRootF && pdfRootF.name !== "Sales_Invoices") pdfRootF = pdfRootF.parent;
const oldDir = pdfRootF.createFolder("2026-08");
const oldPdf = oldDir.createFile({ name: "GF-26-27-OLD01.pdf", mime: "application/pdf", html: "old" });
const oldUrl = oldPdf.getUrl();
ctx.savePendingInvoicePdfs();
check("old month folder: PDF moved to FY 2026-27/08, same id and link", pathOf(oldPdf) === "My Drive/Groovy POS/Sales_Invoices/FY 2026-27/08" && oldPdf.getUrl() === oldUrl, pathOf(oldPdf));
check("old month folder binned", oldDir.trashed === true);
const pdfTotal = pdfFiles().length;
check("timer again: nothing new to do", ctx.savePendingInvoicePdfs() === 0 && pdfFiles().length === pdfTotal);
// turning it off removes the timer and stops the job
ok(call("saveSettings", { settings: { invoice_pdfs: "no" } }, T), "PDFs off");
check("PDFs off: timer removed", !env.triggers.some((x) => x.fn === "savePendingInvoicePdfs"));
ok(call("completeSale", Object.assign({}, pdfSaleReq, { client_ref: "pdf-3", customer: {} }), T, 1), "sale while PDFs off");
check("PDFs off: job does nothing", ctx.savePendingInvoicePdfs() === undefined && pdfFiles().length === pdfTotal);
ok(call("saveSettings", { settings: { invoice_pdfs: "yes" } }, T), "PDFs on");
check("PDFs on: timer back", env.triggers.filter((x) => x.fn === "savePendingInvoicePdfs").length === 1);

// Generate SKU continues the website series (SKU-0001 …); numbers are never handed out twice
const genSku = () => call("generateSku", {}, T, 1);
const skuHigh = Math.max(...call("getCatalog", {}, T).data.variants.map((v) => (/^SKU-(\d+)$/i.exec(v.sku || "") || [0, 0])[1]).map(Number));
const g1 = genSku().data.sku;
const g2 = genSku().data.sku;
check("generateSku: next after highest SKU-####", g1 === "SKU-" + String(skuHigh + 1).padStart(4, "0") && g2 === "SKU-" + String(skuHigh + 2).padStart(4, "0"), { skuHigh, g1, g2 });
const g3prod = ok(call("saveProduct", { name: "Gen Sku Item", brand_name: "X", category_id: cat("Eau De Parfum"), gst_rate: 18, variants: [{ size_label: "10ml", sell_price: 100, sku: genSku().data.sku }] }, T, 1), "save with generated SKU").id;
const g3sku = call("getCatalog", {}, T).data.variants.find((v) => v.product_id === g3prod).sku;
ok(call("deleteProduct", { id: g3prod }, T, 1), "delete item with the highest SKU");
check("deleted item's SKU number not reused", genSku().data.sku === "SKU-" + String(Number(g3sku.slice(4)) + 1).padStart(4, "0"), g3sku);
check("salesman can't generate SKU", call("generateSku", {}, RAVI3, 1).code === "FORBIDDEN");
check("sku counter hidden from app settings", !("sku_seq" in call("bootstrap", {}, T, 1).data.settings));

// ---- reset test data (keep setup) on a fresh env ----
const envR = createEnv();
envR.ctx.setupSheets();
const rPwd = /Password: (\S+)/.exec(envR.alerts.pop())[1];
const RT = envR.call("login", { email: "owner@groovy.test", password: rPwd }).data.token;
const rRun = (code) => require("vm").runInContext("resetReqCache_(); " + code, envR.ctx);
const rCat = envR.call("getCatalog", {}, RT).data.categories[0].id;
envR.call("saveSettings", { settings: { business_name: "Groovy Test Shop" } }, RT);
const rProd = envR.call("saveProduct", {
    name: "Reset Oud", brand_name: "Groovy", category_id: rCat, hsn: "3303", gst_rate: 18,
    variants: [{ size_label: "50ml", barcode: "RST001", mrp: 500, sell_price: 400, cost: 200, opening_stock: 5 }],
}, RT).data.id;
const rVid = envR.call("getCatalog", {}, RT).data.variants.find((v) => v.barcode === "RST001").id;
envR.call("generateBarcode", {}, RT);
check("reset: test data created",
    envR.call("stockIn", { lines: [{ variant_id: rVid, qty: 2, unit_cost: 200 }] }, RT).success &&
    envR.call("completeSale", { client_ref: "r-1", lines: [{ variant_id: rVid, qty: 1 }], customer: { phone: "9999988888", name: "Test" },
        payments: [{ method: "cash", amount: 400 }] }, RT).success &&
    envR.call("saveExpense", { title: "Tea", amount: 20, method: "cash" }, RT).success &&
    envR.call("holdBill", { cart: { lines: [{ variant_id: rVid, qty: 1 }] } }, RT).success);
const rVer = envR.call("getCatalog", {}, RT).data.version;
const rBc = String(rRun('setting_("internal_barcode_seq")'));
const rRes = envR.ctx.resetTestData_();
check("reset: day-to-day tabs empty", rRun('RESET_TABS_.filter((n) => n !== "Activity_Logs").every((n) => rows_(n).length === 0)'), rRes);
check("reset: only the reset log entry left", rRun('rows_("Activity_Logs").length === 1 && rows_("Activity_Logs")[0].action === "RESET"'));
check("reset: stock 0", rRun('rows_("Variants").every((v) => v.stock_qty === 0)'));
check("reset: setup kept", rRun(
    'rows_("Products").some((p) => p.id === ' + rProd + ') && rows_("Users").length === 1 && rows_("Branches").length >= 1 && ' +
    'rows_("Categories").length > 1 && setting_("business_name") === "Groovy Test Shop"'));
check("reset: bill counters removed, barcode counter kept",
    rRun('!rows_("Settings").some((s) => /^(inv|cn)_seq_/.test(s.key)) && String(setting_("internal_barcode_seq"))') === rBc);
check("reset: old login rejected", envR.call("getCatalog", {}, RT).code === "AUTH_EXPIRED");
const RT2 = envR.call("login", { email: "owner@groovy.test", password: rPwd }).data.token;
check("reset: catalog version bumped", envR.call("getCatalog", {}, RT2).data.version > rVer);
envR.call("stockIn", { lines: [{ variant_id: rVid, qty: 3, unit_cost: 200 }] }, RT2);
const rstSale = envR.call("completeSale", { client_ref: "r-2", lines: [{ variant_id: rVid, qty: 1 }], payments: [{ method: "cash", amount: 400 }] }, RT2);
check("reset: bill numbers restart", rstSale.success && /\/00001$/.test(rstSale.data.sale.invoice_no), rstSale);
check("reset: stock works after", envR.call("getCatalog", {}, RT2).data.variants.find((v) => v.id === rVid).stock_qty === 2);

// ---- demo seed on a fresh env ----
const env2 = createEnv();
env2.ctx.setupSheets();
env2.ctx.seedDemo();
const demoMsg = env2.alerts.pop();
check("demo seeded", /Demo data loaded/.test(demoMsg), demoMsg);
const bills = /(\d+) bills/.exec(demoMsg)[1];
const salesRows = env2.ctx.rows_("Sales").length;
check("demo sales saved", salesRows > 20, { salesRows, bills });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
