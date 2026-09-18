/** Catalog: brands, categories, products, size variants, barcodes, CSV import, images. */

const GST_RATES = [0, 5, 12, 18, 28];

function isStaffManager_(ctx) {
    return ctx.user.role === "admin" || ctx.user.role === "manager";
}

function apiGetCatalog_(p, ctx) {
    const showCost = isStaffManager_(ctx);
    const stock = stockMap_(ctx.branch_id); // 0 = all branches → totals
    const byBranch = stockByBranch_();
    return {
        data: {
            version: num_(setting_("catalog_version"), 1),
            brands: rows_("Brands").map((b) => ({ id: b.id, name: b.name, active: b.active })),
            categories: rows_("Categories").map((c) => ({
                id: c.id, name: c.name, default_hsn: c.default_hsn, default_gst: c.default_gst,
                sort: c.sort, active: c.active,
            })),
            products: rows_("Products").map((x) => ({
                id: x.id, name: x.name, brand_id: x.brand_id, category_id: x.category_id,
                gender: x.gender, sale_type: x.sale_type, hsn: x.hsn, gst_rate: x.gst_rate,
                image: x.image, description: x.description, active: x.active,
            })),
            variants: rows_("Variants").map((v) => {
                const o = {
                    id: v.id, product_id: v.product_id, sku: v.sku, barcode: v.barcode,
                    size_label: v.size_label, size_ml: v.size_ml, unit: v.unit, mrp: v.mrp,
                    sell_price: v.sell_price, stock_qty: stock[v.id] || 0, stock_by_branch: byBranch[v.id] || {}, reorder_level: v.reorder_level,
                    active: v.active,
                };
                if (showCost) o.avg_cost = v.avg_cost;
                return o;
            }),
        },
    };
}

/* ---------- brands & categories ---------- */

function ensureBrand_(name) {
    const n = str_(name);
    if (!n) return 0;
    const ex = rows_("Brands").find((b) => b.name.toLowerCase() === n.toLowerCase());
    if (ex) return ex.id;
    const id = nextId_("Brands");
    appendRows_("Brands", [{ id, name: n, active: 1, created_at: nowStr_() }]);
    return id;
}

function apiSaveBrand_(p, ctx) {
    const name = str_(p.name);
    if (!name) fail_("Brand name is required");
    return withLock_(() => {
        const dup = rows_("Brands").find((b) => b.name.toLowerCase() === name.toLowerCase());
        if (p.id) {
            const b = findBy_("Brands", "id", Number(p.id));
            if (!b) fail_("Brand not found");
            if (dup && dup.id !== b.id) fail_("Brand already exists");
            b.name = name;
            if (p.active !== undefined) b.active = p.active ? 1 : 0;
            updateRows_("Brands", [b]);
            bumpCatalogVersion_();
            log_(ctx, "UPDATE", "Brands", b.id, name);
            return { message: "Brand saved", data: { id: b.id } };
        }
        if (dup) fail_("Brand already exists");
        const id = ensureBrand_(name);
        bumpCatalogVersion_();
        log_(ctx, "CREATE", "Brands", id, name);
        return { message: "Brand added", data: { id } };
    });
}

function apiSaveCategory_(p, ctx) {
    const name = str_(p.name);
    if (!name) fail_("Category name is required");
    const gst = num_(p.default_gst, 18);
    if (GST_RATES.indexOf(gst) < 0) fail_("GST rate must be one of " + GST_RATES.join(", "));
    return withLock_(() => {
        const dup = rows_("Categories").find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (p.id) {
            const c = findBy_("Categories", "id", Number(p.id));
            if (!c) fail_("Category not found");
            if (dup && dup.id !== c.id) fail_("Category already exists");
            Object.assign(c, {
                name, default_hsn: str_(p.default_hsn), default_gst: gst,
                sort: num_(p.sort, c.sort), active: p.active === undefined ? c.active : p.active ? 1 : 0,
            });
            updateRows_("Categories", [c]);
            bumpCatalogVersion_();
            log_(ctx, "UPDATE", "Categories", c.id, name);
            return { message: "Category saved", data: { id: c.id } };
        }
        if (dup) fail_("Category already exists");
        const id = nextId_("Categories");
        appendRows_("Categories", [
            { id, name, default_hsn: str_(p.default_hsn), default_gst: gst, sort: num_(p.sort, id), active: 1, created_at: nowStr_() },
        ]);
        bumpCatalogVersion_();
        log_(ctx, "CREATE", "Categories", id, name);
        return { message: "Category added", data: { id } };
    });
}

// only an empty category (e.g. made by mistake) can be deleted; one in use can only be hidden
function apiDeleteCategory_(p, ctx) {
    return withLock_(() => {
        const c = findBy_("Categories", "id", Number(p.id));
        if (!c) fail_("Category not found");
        const used = rows_("Products").filter((x) => x.category_id === c.id).length;
        if (used) fail_("Used by " + used + (used === 1 ? " product" : " products") + " — hide it instead.");
        if (rows_("Categories").length <= 1) fail_("Keep at least one category.");
        deleteRow_("Categories", c);
        bumpCatalogVersion_();
        log_(ctx, "DELETE", "Categories", c.id, c.name);
        return { message: "Category deleted" };
    });
}

/* ---------- products + variants ---------- */

function normBarcode_(b) {
    return str_(b).replace(/\s+/g, "");
}

// throws if any barcode is used by another variant (or twice in the list)
function assertBarcodesUnique_(list) {
    const byCode = {};
    rows_("Variants").forEach((v) => {
        if (v.barcode) byCode[v.barcode] = v;
    });
    const seen = {};
    list.forEach((x) => {
        if (!x.barcode) return;
        if (seen[x.barcode]) fail_("Barcode " + x.barcode + " is repeated");
        seen[x.barcode] = true;
        const ex = byCode[x.barcode];
        if (ex && ex.id !== Number(x.id || 0)) {
            const prod = findBy_("Products", "id", ex.product_id);
            fail_("Barcode " + x.barcode + " already belongs to " + (prod ? prod.name : "another item") + " " + ex.size_label);
        }
    });
}

function cleanVariant_(v, saleType) {
    const loose = saleType === "loose";
    const out = {
        id: Number(v.id || 0),
        size_label: str_(v.size_label) || (loose ? "Loose (per ml)" : ""),
        size_ml: num_(v.size_ml),
        unit: loose ? "ml" : "pcs",
        barcode: normBarcode_(v.barcode),
        sku: str_(v.sku),
        mrp: r2_(num_(v.mrp)),
        sell_price: r2_(num_(v.sell_price)),
        reorder_level: num_(v.reorder_level),
        active: v.active === undefined ? 1 : v.active ? 1 : 0,
        opening_stock: num_(v.opening_stock),
        cost: r2_(num_(v.cost)),
    };
    if (!out.size_label) fail_("Size is required for every variant (e.g. 100ml)");
    if (out.sell_price <= 0) fail_("Selling price is required for " + out.size_label);
    if (out.mrp > 0 && out.sell_price > out.mrp) fail_("Selling price cannot be more than MRP (" + out.size_label + ")");
    if (out.mrp <= 0) out.mrp = out.sell_price;
    if (out.opening_stock < 0) fail_("Opening stock cannot be negative");
    return out;
}

function apiSaveProduct_(p, ctx) {
    const name = str_(p.name);
    if (!name) fail_("Product name is required");
    const saleType = p.sale_type === "loose" ? "loose" : "packed";
    const gst = num_(p.gst_rate, 18);
    if (GST_RATES.indexOf(gst) < 0) fail_("GST rate must be one of " + GST_RATES.join(", "));
    const variantsIn = (p.variants || []).map((v) => cleanVariant_(v, saleType));
    if (!variantsIn.length) fail_("Add at least one size");
    // opening stock is counted at the branch you're working at
    if (variantsIn.some((v) => !v.id && v.opening_stock > 0)) requireBranch_(ctx);

    return withLock_(() => {
        if (!findBy_("Categories", "id", Number(p.category_id))) fail_("Please choose a category");
        assertBarcodesUnique_(variantsIn);
        const now = nowStr_();
        const brandId = p.brand_id ? Number(p.brand_id) : ensureBrand_(p.brand_name);

        let prod;
        if (p.id) {
            prod = findBy_("Products", "id", Number(p.id));
            if (!prod) fail_("Product not found");
            Object.assign(prod, {
                name, brand_id: brandId, category_id: Number(p.category_id), gender: str_(p.gender),
                sale_type: saleType, hsn: str_(p.hsn), gst_rate: gst, image: str_(p.image),
                description: str_(p.description), active: p.active === undefined ? prod.active : p.active ? 1 : 0,
                updated_at: now,
            });
            updateRows_("Products", [prod]);
        } else {
            prod = {
                id: nextId_("Products"), name, brand_id: brandId, category_id: Number(p.category_id),
                gender: str_(p.gender), sale_type: saleType, hsn: str_(p.hsn), gst_rate: gst,
                image: str_(p.image), description: str_(p.description), active: 1,
                created_by: ctx.user.id, created_at: now, updated_at: now,
            };
            appendRows_("Products", [prod]);
        }

        const newRows = [];
        const moves = [];
        let nextVid = nextId_("Variants");
        let nextMid = nextId_("Stock_Movements");
        variantsIn.forEach((v) => {
            if (v.id) {
                const ex = findBy_("Variants", "id", v.id);
                if (!ex || ex.product_id !== prod.id) fail_("Variant not found");
                Object.assign(ex, {
                    size_label: v.size_label, size_ml: v.size_ml, unit: v.unit, barcode: v.barcode,
                    sku: v.sku, mrp: v.mrp, sell_price: v.sell_price, reorder_level: v.reorder_level,
                    active: v.active, updated_at: now,
                });
                if (v.cost > 0) ex.avg_cost = v.cost;
                updateRows_("Variants", [ex]);
                return;
            }
            const row = {
                id: nextVid++, product_id: prod.id, sku: v.sku, barcode: v.barcode, size_label: v.size_label,
                size_ml: v.size_ml, unit: v.unit, mrp: v.mrp, sell_price: v.sell_price, avg_cost: v.cost,
                stock_qty: 0, reorder_level: v.reorder_level, active: v.active,
                created_at: now, updated_at: now,
            };
            newRows.push(row);
            if (v.opening_stock > 0)
                moves.push({
                    id: nextMid++, variant_id: row.id, type: "opening", qty: v.opening_stock, unit_cost: v.cost,
                    balance: v.opening_stock, ref_type: "product", ref_id: String(prod.id), note: "Opening stock", branch_id: ctx.branch_id,
                    user_id: ctx.user.id, at: now,
                });
        });
        appendRows_("Variants", newRows);
        appendRows_("Stock_Movements", moves);
        addStock_(moves.map((m) => ({ variant_id: m.variant_id, branch_id: ctx.branch_id, delta: m.qty })));
        bumpCatalogVersion_();
        log_(ctx, p.id ? "UPDATE" : "CREATE", "Products", prod.id, name + " (" + variantsIn.length + " sizes)");
        return { message: p.id ? "Product saved" : "Product added", data: { id: prod.id } };
    });
}

function apiToggleProduct_(p, ctx) {
    return withLock_(() => {
        const prod = findBy_("Products", "id", Number(p.id));
        if (!prod) fail_("Product not found");
        prod.active = prod.active ? 0 : 1;
        prod.updated_at = nowStr_();
        updateRows_("Products", [prod]);
        bumpCatalogVersion_();
        log_(ctx, prod.active ? "ACTIVATE" : "DEACTIVATE", "Products", prod.id, prod.name);
        return { message: prod.active ? "Product is active" : "Product hidden from sale" };
    });
}

/**
 * Permanently delete a product added by mistake (admin). Only allowed while nothing refers to it:
 * no bills, returns, stock-in, adjustments or transfers (opening stock is fine) and no held bill.
 * Anything already used must be hidden instead, so bills and GST records stay complete.
 */
function apiDeleteProduct_(p, ctx) {
    return withLock_(() => {
        const prod = findBy_("Products", "id", Number(p.id));
        if (!prod) fail_("Product not found");
        const variants = rows_("Variants").filter((v) => v.product_id === prod.id);
        const vids = {};
        variants.forEach((v) => (vids[v.id] = true));

        const used =
            rows_("Stock_Movements").some((m) => vids[m.variant_id] && m.type !== "opening") ||
            rows_("Sale_Items").some((i) => vids[i.variant_id]) ||
            rows_("Return_Items").some((i) => vids[i.variant_id]);
        if (used) fail_("Already used in bills or stock history — hide it instead (eye icon).");
        const held = rows_("Held_Bills").some((h) => ((h.cart_json && h.cart_json.lines) || []).some((l) => vids[l.variant_id]));
        if (held) fail_("This product is in a held bill — finish or delete that bill first.");

        // bottom-up so row numbers stay valid
        const drop = (name, rows) => {
            if (!rows.length) return;
            const sh = readTable_(name).sh;
            rows.sort((a, b) => b._r - a._r).forEach((r) => sh.deleteRow(r._r));
            delete REQ_CACHE_[name];
        };
        drop("Stock_Movements", rows_("Stock_Movements").filter((m) => vids[m.variant_id]));
        drop("Branch_Stock", rows_("Branch_Stock").filter((b) => vids[b.variant_id]));
        drop("Variants", variants);
        drop("Products", [prod]);

        bumpCatalogVersion_();
        const codes = variants.map((v) => v.barcode).filter(String).join(", ");
        log_(ctx, "DELETE", "Products", prod.id, prod.name + (codes ? " (barcodes: " + codes + ")" : ""));
        return { message: "Product deleted" };
    });
}

function apiGenerateBarcode_(p, ctx) {
    return withLock_(() => {
        const used = {};
        rows_("Variants").forEach((v) => (used[v.barcode] = true));
        let code;
        do {
            code = "GF" + pad_(nextCounter_("internal_barcode_seq"), 6);
        } while (used[code]);
        return { data: { barcode: code } };
    });
}

/* ---------- images (Drive) ---------- */

function apiUploadImage_(p, ctx) {
    const data = String(p.data || "");
    if (!data) fail_("No image");
    if (data.length > 3 * 1024 * 1024) fail_("Image too large (max ~2 MB)");
    const mime = /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : "image/jpeg";
    const it = DriveApp.getFoldersByName(APP.IMAGE_FOLDER);
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder(APP.IMAGE_FOLDER);
    const blob = Utilities.newBlob(Utilities.base64Decode(data), mime, str_(p.name) || "product.jpg");
    const file = folder.createFile(blob);
    try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
        console.warn("setSharing blocked by account policy: " + e); // image may not show on other phones
    }
    return { data: { image: "drive:" + file.getId() } };
}

/* ---------- CSV bulk import ---------- */

/**
 * rows: [{brand, category, product, gender, sale_type, size_label, size_ml, barcode,
 *         mrp, sell_price, cost, opening_stock, hsn, gst_rate, reorder_level}]
 * Rows with the same brand+product become sizes of one product.
 */
function apiImportCatalog_(p, ctx) {
    const input = p.rows || [];
    if (!input.length) fail_("Nothing to import");
    if (input.length > 2000) fail_("Import at most 2000 rows at a time");
    if (input.some((r) => num_(r.opening_stock) > 0)) requireBranch_(ctx);

    return withLock_(() => {
        const now = nowStr_();
        const errors = [];
        const cats = rows_("Categories");
        const catByName = {};
        cats.forEach((c) => (catByName[c.name.toLowerCase()] = c));
        const prods = rows_("Products");
        const brandsById = indexBy_(rows_("Brands"), "id");
        const prodKey = (brandName, prodName) => (brandName || "").toLowerCase() + "|" + prodName.toLowerCase();
        const prodByKey = {};
        prods.forEach((x) => (prodByKey[prodKey(brandsById[x.brand_id] ? brandsById[x.brand_id].name : "", x.name)] = x));
        const usedCodes = {};
        rows_("Variants").forEach((v) => {
            if (v.barcode) usedCodes[v.barcode] = true;
        });

        const newProds = [];
        const newVars = [];
        const moves = [];
        let pid = nextId_("Products");
        let vid = nextId_("Variants");
        let mid = nextId_("Stock_Movements");
        let catId = nextId_("Categories");
        const newCats = [];

        input.forEach((r, i) => {
            const rowNo = i + 2; // header is row 1
            try {
                const prodName = str_(r.product);
                if (!prodName) fail_("Product name missing");
                const catName = str_(r.category);
                if (!catName) fail_("Category missing");
                let cat = catByName[catName.toLowerCase()];
                if (!cat) {
                    cat = { id: catId++, name: catName, default_hsn: str_(r.hsn), default_gst: num_(r.gst_rate, 18), sort: 99, active: 1, created_at: now };
                    newCats.push(cat);
                    catByName[catName.toLowerCase()] = cat;
                }
                const saleType = str_(r.sale_type).toLowerCase() === "loose" ? "loose" : "packed";
                const v = cleanVariant_(
                    {
                        size_label: r.size_label, size_ml: r.size_ml, barcode: r.barcode, mrp: r.mrp,
                        sell_price: r.sell_price, reorder_level: r.reorder_level, opening_stock: r.opening_stock, cost: r.cost,
                    },
                    saleType,
                );
                if (v.barcode && usedCodes[v.barcode]) fail_("Barcode " + v.barcode + " already exists");
                const gst = r.gst_rate === "" || r.gst_rate === undefined ? cat.default_gst : num_(r.gst_rate);
                if (GST_RATES.indexOf(gst) < 0) fail_("Invalid GST rate " + r.gst_rate);

                const brandName = str_(r.brand);
                const key = prodKey(brandName, prodName);
                let prod = prodByKey[key];
                if (!prod) {
                    prod = {
                        id: pid++, name: prodName, brand_id: ensureBrand_(brandName), category_id: cat.id,
                        gender: str_(r.gender), sale_type: saleType, hsn: str_(r.hsn) || cat.default_hsn,
                        gst_rate: gst, image: str_(r.image), description: "", active: 1,
                        created_by: ctx.user.id, created_at: now, updated_at: now,
                    };
                    newProds.push(prod);
                    prodByKey[key] = prod;
                }
                const row = {
                    id: vid++, product_id: prod.id, sku: str_(r.sku), barcode: v.barcode, size_label: v.size_label,
                    size_ml: v.size_ml, unit: v.unit, mrp: v.mrp, sell_price: v.sell_price, avg_cost: v.cost,
                    stock_qty: 0, reorder_level: v.reorder_level, active: 1, created_at: now, updated_at: now,
                };
                newVars.push(row);
                if (v.barcode) usedCodes[v.barcode] = true;
                if (v.opening_stock > 0)
                    moves.push({
                        id: mid++, variant_id: row.id, type: "opening", qty: v.opening_stock, unit_cost: v.cost,
                        balance: v.opening_stock, ref_type: "import", ref_id: "", note: "Opening stock (import)", branch_id: ctx.branch_id,
                        user_id: ctx.user.id, at: now,
                    });
            } catch (e) {
                errors.push({ row: rowNo, message: e.message || String(e) });
            }
        });

        appendRows_("Categories", newCats);
        appendRows_("Products", newProds);
        appendRows_("Variants", newVars);
        appendRows_("Stock_Movements", moves);
        addStock_(moves.map((m) => ({ variant_id: m.variant_id, branch_id: ctx.branch_id, delta: m.qty })));
        if (newVars.length) bumpCatalogVersion_();
        log_(ctx, "IMPORT", "Products", "", newProds.length + " products, " + newVars.length + " sizes, " + errors.length + " errors");
        return {
            message: "Imported " + newVars.length + " sizes (" + newProds.length + " new products)" + (errors.length ? ", " + errors.length + " rows skipped" : ""),
            data: { products: newProds.length, variants: newVars.length, errors },
        };
    });
}
