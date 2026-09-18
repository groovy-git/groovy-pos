/**
 * One-time setup, run from the spreadsheet menu "Groovy POS" (or the Apps Script editor).
 * setupSheets() is safe to run again: it only creates what is missing.
 */

function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu("Groovy POS")
        .addItem("1. Setup / repair sheets", "setupSheets")
        .addItem("2. Load demo data (test copy only)", "seedDemo")
        .addSeparator()
        .addItem("Email today's day close now", "emailDayCloseNow")
        .addItem("Run self-tests", "runTests")
        .addItem("Show web app URL", "showWebAppUrl")
        .addToUi();
}

function alert_(msg) {
    try {
        SpreadsheetApp.getUi().alert(msg);
    } catch (e) {
        console.log(msg); // run from the editor
    }
}

function setupSheets() {
    resetReqCache_();
    const ss = ss_();
    const created = [];
    const kept = []; // tabs where the owner added their own columns (left untouched)
    Object.keys(SCHEMA).forEach((name) => {
        const keys = Object.keys(SCHEMA[name]);
        let sh = ss.getSheetByName(name);
        if (!sh) {
            sh = ss.insertSheet(name);
            created.push(name);
        }
        if (sh.getMaxColumns() < keys.length) sh.insertColumnsAfter(sh.getMaxColumns(), keys.length - sh.getMaxColumns());
        const lastCol = sh.getLastColumn();
        const header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
        if (!header.length || header.every((h) => !h)) {
            sh.getRange(1, 1, 1, keys.length).setValues([keys]);
        } else {
            // columns added in later versions are appended at the end — fill in their headers
            const added = [];
            keys.forEach((k, i) => {
                if (header[i] === k) return;
                if (!header[i] && header.slice(i).every((h) => !h)) {
                    sh.getRange(1, i + 1).setValue(k);
                    added.push(k);
                    return;
                }
                throw new Error("Sheet '" + name + "' column " + (i + 1) + " should be '" + k + "' but is '" + (header[i] || "") + "'. Fix the header row and run setup again.");
            });
            if (added.length) created.push(name + " (+" + added.join(", ") + ")");
        }
        sh.getRange(1, 1, 1, keys.length).setFontWeight("bold").setBackground("#654321").setFontColor("#FFFFFF");
        sh.setFrozenRows(1);
        // tidy away unused columns — but never delete a column that has anything in it
        const extra = sh.getMaxColumns() - keys.length;
        if (extra > 0) {
            const vals = sh.getRange(1, keys.length + 1, Math.max(1, sh.getLastRow()), extra).getValues();
            if (vals.every((row) => row.every((c) => c === "" || c === null))) sh.deleteColumns(keys.length + 1, extra);
            else kept.push(name);
        }
        if (sh.getMaxRows() < 500) sh.insertRowsAfter(sh.getMaxRows(), 500 - sh.getMaxRows());
        formatTextCols_(sh, name, 2, sh.getMaxRows() - 1);
    });

    // remove the blank default sheet
    ["Sheet1", "Sheet 1"].forEach((n) => {
        const sh = ss.getSheetByName(n);
        if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
    });

    resetReqCache_();
    const have = indexBy_(rows_("Settings"), "key");
    const now = nowStr_();
    const missing = Object.keys(DEFAULT_SETTINGS)
        .filter((k) => !have[k])
        .map((k) => ({ key: k, value: DEFAULT_SETTINGS[k], updated_by: 0, updated_at: now }));
    appendRows_("Settings", missing);

    if (!rows_("Categories").length) {
        appendRows_(
            "Categories",
            DEFAULT_CATEGORIES.map((c, i) => ({ id: i + 1, name: c[0], default_hsn: c[1], default_gst: c[2], sort: i + 1, active: 1, created_at: now })),
        );
    }

    // branches: the existing shop becomes branch 1 (blank code keeps the GF/26-27/00001 bill series)
    if (!rows_("Branches").length) {
        const s = settingsMap_();
        appendRows_("Branches", [
            { id: 1, name: "Main branch", code: "", address: s.address, phone: s.phone, report_emails: "", active: 1, created_at: now },
        ]);
        created.push("Branch 1 “Main branch” (rename it in Settings → Branches)");
    }
    // stock counted before branches existed moves to branch 1
    if (!rows_("Branch_Stock").length) {
        const moved = rows_("Variants")
            .filter((v) => v.stock_qty)
            .map((v) => ({ variant_id: v.id, branch_id: 1, qty: v.stock_qty }));
        appendRows_("Branch_Stock", moved);
    }

    let adminMsg = "";
    if (!rows_("Users").length) {
        let email = "";
        try {
            email = Session.getEffectiveUser().getEmail();
        } catch (e) {}
        email = (email || "admin@groovyfragrances.in").toLowerCase();
        const pwd = "groovy@" + Math.floor(1000 + Math.random() * 9000);
        const salt = newSalt_();
        appendRows_("Users", [
            { id: 1, name: "Owner", email, phone: "", role: "admin", pwd_hash: hashPwd_(pwd, salt), salt, active: 1, otp: "", otp_exp: "", created_at: now, updated_at: now },
        ]);
        adminMsg = "\n\nAdmin login created:\nEmail: " + email + "\nPassword: " + pwd + "\n\nWrite this down and change the password after first login.";
    }
    SpreadsheetApp.flush();
    const msg =
        "Setup complete." +
        (created.length ? "\nCreated sheets: " + created.join(", ") : "\nAll sheets already existed.") +
        (kept.length ? "\nKept your extra columns in: " + kept.join(", ") + " (no data was removed)." : "") +
        adminMsg;
    alert_(msg);
    return msg;
}

function showWebAppUrl() {
    let url = "";
    try {
        url = ScriptApp.getService().getUrl();
    } catch (e) {}
    alert_(url ? "Web app URL (use as VITE_API_URL):\n" + url : "Not deployed yet. In Apps Script: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).");
}

/* ---------- demo data ---------- */

function seedDemo() {
    resetReqCache_();
    if (rows_("Products").length) {
        alert_("Products already exist — demo data is only for an empty test copy of the sheet.");
        return;
    }
    const admin = rows_("Users").find((u) => u.role === "admin");
    if (!admin) throw new Error("Run setup first");
    // demo shop with two branches: opening stock at Kondhwa, part of it transferred to Kalyani Nagar
    const ctx = { user: admin, token: "", branch_id: 1 };
    const b1 = findBy_("Branches", "id", 1);
    apiSaveBranch_({ id: 1, name: "Kondhwa", code: "", address: b1.address, phone: b1.phone }, ctx);
    const kn = apiSaveBranch_({ name: "Kalyani Nagar", code: "KN", address: "Shop 3, Kalyani Nagar, Pune 411006", phone: "" }, ctx).data.id;
    const cats = indexBy_(rows_("Categories"), "name");
    const catId = (n) => {
        if (!cats[n]) throw new Error("Missing category " + n);
        return cats[n].id;
    };

    // [brand, product, category, gender, sale_type, [[size, size_ml, mrp, price, cost, stock]], image]
    const demo = [
        ["Lattafa", "Asad Eau De Parfum", "Eau De Parfum", "men", "packed", [["100ml", 100, 3500, 1950, 1450, 6]]],
        ["Afnan", "Theoreme Pour Homme Eau De Parfum", "Eau De Parfum", "men", "packed", [["90ml", 90, 5000, 2049, 1600, 4]]],
        ["Rasasi", "Royal Blue Eau De Parfum", "Eau De Parfum", "men", "packed", [["75ml", 75, 2199, 1249, 900, 5]]],
        ["Ahmed Perfume", "Laathani Eau De Parfum", "Perfume Decants", "unisex", "packed", [["5ml decant", 5, 600, 499, 300, 10]]],
        ["Jaguar", "Classic Eau De Toilette", "Eau De Toilette", "men", "packed", [["100ml", 100, 4500, 1849, 1400, 3]]],
        ["Ramsons", "Scent of Love Eau de Parfum", "Eau De Parfum", "women", "packed", [["100ml", 100, 899, 749, 520, 6]],
            "https://cdn2.clevup.in/255755/1665945525706_RAMSONSSCENTOFLOVEEaudeParfumPerfume100mlForWomen3.jpeg?width=400&format=webp"],
        ["Naseem", "Khalifa Attar Premium Perfume Oil", "Packed Attar", "men", "packed", [["15ml", 15, 1250, 699, 480, 12]]],
        ["Naseem", "Hanayen Attar Premium Perfume Oil", "Packed Attar", "women", "packed", [["12ml", 12, 1250, 700, 480, 8]]],
        ["Al Haramain", "Musk Pure Roll-On Attar", "Packed Attar", "unisex", "packed", [["15ml", 15, 1000, 549, 380, 10]]],
        ["Al Alif", "Amber Touch Karwan Roll-On Attar", "Packed Attar", "unisex", "packed", [["10ml", 10, 450, 299, 190, 15]]],
        ["AdilQadri", "Shanaya Luxury Attar", "Packed Attar", "unisex", "packed", [["12ml", 12, 899, 599, 400, 7]]],
        ["Armaf", "Hunter Perfume Body Spray", "Deodorant Spray", "men", "packed", [["200ml", 200, 349, 296, 210, 20]]],
        ["Cristiano Ronaldo", "CR7 Origins Body Spray", "Deodorant Spray", "men", "packed", [["150ml", 150, 890, 599, 420, 8]]],
        ["Killer", "Wave Liquid Deodorant", "Deodorant Spray", "men", "packed", [["150ml", 150, 299, 125, 80, 25]]],
        ["Prathna", "Electric Bakhoor Burner", "Bakhoor & Incense Burner", "", "packed", [["1 pc", 0, 999, 599, 380, 4]]],
        ["Groovy", "Sandal Incense Sticks", "Incense Sticks", "", "packed", [["100 g", 0, 120, 99, 55, 30]]],
        ["Groovy", "White Musk Attar (Loose)", "Loose Attar", "unisex", "loose", [["Loose (per ml)", 0, 30, 25, 12, 500]]],
        ["Groovy", "Oud Royal Attar (Loose)", "Loose Attar", "men", "loose", [["Loose (per ml)", 0, 60, 50, 25, 250]]],
        ["Groovy", "Crystal Attar Bottle", "Fancy Bottles", "", "packed", [["6ml", 6, 60, 50, 20, 40], ["12ml", 12, 90, 80, 30, 30]]],
    ];

    demo.forEach((d) => {
        const variants = d[5].map((v) => ({
            size_label: v[0], size_ml: v[1], mrp: v[2], sell_price: v[3], cost: v[4], opening_stock: v[5],
            reorder_level: d[4] === "loose" ? 100 : 3, barcode: apiGenerateBarcode_({}, ctx).data.barcode,
        }));
        const cat = cats[d[2]];
        apiSaveProduct_(
            { name: d[1], brand_name: d[0], category_id: catId(d[2]), gender: d[3], sale_type: d[4], hsn: cat.default_hsn, gst_rate: cat.default_gst, image: d[6] || "", variants },
            ctx,
        );
    });

    // send ~40% of each item's stock to Kalyani Nagar
    resetReqCache_();
    const moveLines = rows_("Variants")
        .map((v) => ({ variant_id: v.id, qty: v.unit === "ml" ? Math.floor(v.stock_qty * 0.4) : Math.floor(v.stock_qty * 0.4) }))
        .filter((l) => l.qty > 0);
    apiTransferStock_({ to_branch_id: kn, lines: moveLines, note: "Opening stock for new branch" }, ctx);

    // demo staff (password demo1234): home branch, all may switch
    resetReqCache_();
    const staff = [
        ["Imran (Manager)", "manager@demo.local", "manager", 1],
        ["Sameer", "sameer@demo.local", "salesman", 1],
        ["Ayesha", "ayesha@demo.local", "salesman", kn],
    ];
    staff.forEach((s) => {
        if (!findBy_("Users", "email", s[1])) apiSaveUser_({ name: s[0], email: s[1], role: s[2], password: "demo1234", branch_id: s[3] }, ctx);
    });

    // ~3 weeks of demo bills spread across staff
    resetReqCache_();
    const sellers = rows_("Users").filter((u) => u.active);
    const phones = ["9876543210", "9822012345", "9765432109", "", "", "9890011223", ""];
    const names = ["Rahul Shah", "Fatima Khan", "Amit Patil", "", "", "Zoya Shaikh", ""];
    let n = 0;
    for (let day = 20; day >= 0; day--) {
        const bills = 1 + ((day * 7) % 3);
        for (let b = 0; b < bills; b++) {
            n++;
            resetReqCache_();
            const seller = sellers[n % sellers.length];
            const branch = seller.role === "admin" || seller.role === "manager" ? (n % 2 ? 1 : kn) : homeBranch_(seller);
            const inStock = rows_("Variants").filter((v) => stockOf_(v.id, branch) >= (v.unit === "ml" ? 12 : 2));
            if (!inStock.length) continue;
            const lines = [];
            const count = 1 + (n % 3);
            for (let k = 0; k < count; k++) {
                const v = inStock[(n * 7 + k * 5) % inStock.length];
                if (lines.some((l) => l.variant_id === v.id)) continue;
                lines.push({ variant_id: v.id, qty: v.unit === "ml" ? 6 : 1, discount: 0 });
            }
            const at = fmtDateTime_(new Date(Date.now() - day * 86400000 - (3 - b) * 3600000));
            try {
                // price first to know the total, then pay with a method mix
                const vm = indexBy_(inStock, "id");
                const grand = Math.round(lines.reduce((a, l) => a + vm[l.variant_id].sell_price * l.qty, 0));
                const method = ["cash", "upi", "upi", "card"][n % 4];
                const pays = n % 5 === 0 && grand > 400 ? [{ method: "cash", amount: 200 }, { method: "upi", amount: grand - 200 }] : [{ method, amount: grand }];
                apiCompleteSale_(
                    {
                        client_ref: "demo-" + n, lines, bill_disc: 0, salesman_id: seller.id,
                        customer: { phone: phones[n % phones.length], name: names[n % names.length] }, payments: pays, _at: at,
                    },
                    { user: seller, token: "", branch_id: branch },
                );
            } catch (e) {
                console.log("demo sale skipped: " + e.message);
            }
        }
    }

    const exp = [
        ["Rent", "Shop rent", 18000, 20],
        ["Electricity", "MSEB bill", 2350, 15],
        ["Tea & Snacks", "Tea for customers", 240, 3],
        ["Packaging", "Gift bags & boxes", 1200, 8],
        ["Transport", "Courier to Mumbai", 450, 1],
    ];
    exp.forEach((e, i) => apiSaveExpense_({ category: e[0], title: e[1], amount: e[2], method: "cash", date: daysAgoStr_(e[3]) }, Object.assign({}, ctx, { branch_id: i % 2 ? kn : 1 })));

    alert_("Demo data loaded: 2 branches (Kondhwa, Kalyani Nagar), " + demo.length + " products, " + n + " bills, 3 staff users (password demo1234).");
}
