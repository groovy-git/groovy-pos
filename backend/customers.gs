/** Customers — identified by 10-digit Indian mobile number. */

function normPhone_(p) {
    let d = String(p || "").replace(/\D/g, "");
    if (d.length === 12 && d.indexOf("91") === 0) d = d.slice(2);
    if (d.length === 11 && d.charAt(0) === "0") d = d.slice(1);
    return d;
}

function validPhone_(d) {
    return /^[6-9]\d{9}$/.test(d);
}

function validGstin_(g) {
    return /^[0-9]{2}[A-Z0-9]{13}$/.test(g);
}

function customerOut_(c) {
    return {
        id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, total_spent: c.total_spent,
        bills: c.bills, last_visit: c.last_visit, created_at: c.created_at,
    };
}

function apiFindCustomer_(p, ctx) {
    const phone = normPhone_(p.phone);
    if (!validPhone_(phone)) return { data: null };
    const c = findBy_("Customers", "phone", phone);
    return { data: c ? customerOut_(c) : null };
}

function apiListCustomers_(p, ctx) {
    const q = str_(p.q).toLowerCase();
    let rows = q ? rows_("Customers") : tailRows_("Customers", 2000);
    if (q) rows = rows.filter((c) => c.name.toLowerCase().indexOf(q) >= 0 || c.phone.indexOf(q) >= 0);
    rows = rows.slice().sort((a, b) => (b.last_visit || "").localeCompare(a.last_visit || ""));
    return { data: rows.slice(0, num_(p.limit, 300)).map(customerOut_) };
}

function apiSaveCustomer_(p, ctx) {
    const phone = normPhone_(p.phone);
    if (!validPhone_(phone)) fail_("Enter a valid 10-digit mobile number");
    const gstin = str_(p.gstin).toUpperCase();
    if (gstin && !validGstin_(gstin)) fail_("GSTIN must be 15 characters");
    return withLock_(() => {
        const dup = findBy_("Customers", "phone", phone);
        if (p.id) {
            const c = findBy_("Customers", "id", Number(p.id));
            if (!c) fail_("Customer not found");
            if (dup && dup.id !== c.id) fail_("Another customer has this number");
            c.name = str_(p.name);
            c.phone = phone;
            c.gstin = gstin;
            updateRows_("Customers", [c]);
            log_(ctx, "UPDATE", "Customers", c.id, c.name + " " + phone);
            return { message: "Customer saved", data: customerOut_(c) };
        }
        if (dup) fail_("Customer with this number already exists");
        const c = {
            id: nextId_("Customers"), name: str_(p.name), phone, gstin, total_spent: 0, bills: 0,
            last_visit: "", created_at: nowStr_(),
        };
        appendRows_("Customers", [c]);
        log_(ctx, "CREATE", "Customers", c.id, c.name + " " + phone);
        return { message: "Customer added", data: customerOut_(c) };
    });
}

function apiCustomerHistory_(p, ctx) {
    const c = findById_("Customers", p.id);
    if (!c) fail_("Customer not found");
    let sales = windowRows_("Sales", "customer_id", c.id, c.id).filter((s) => s.customer_id === c.id);
    if (ctx.user.role === "salesman") sales = sales.filter((s) => s.salesman_id === ctx.user.id);
    return {
        data: {
            customer: customerOut_(c),
            sales: sales
                .slice()
                .reverse()
                .map((s) => ({
                    id: s.id, invoice_no: s.invoice_no, date: s.date, grand_total: s.grand_total,
                    refunded: s.refunded, status: s.status, items: s.items, salesman_name: s.salesman_name,
                })),
        },
    };
}

// inside lock: create/update customer from a sale; returns the record or null (walk-in)
function upsertSaleCustomer_(cust, amount, now) {
    const phone = normPhone_(cust && cust.phone);
    if (!phone) return null;
    if (!validPhone_(phone)) fail_("Customer mobile number is not valid");
    const gstin = str_(cust.gstin).toUpperCase();
    if (gstin && !validGstin_(gstin)) fail_("Customer GSTIN must be 15 characters");
    let c = findBy_("Customers", "phone", phone);
    if (c) {
        if (str_(cust.name)) c.name = str_(cust.name);
        if (gstin) c.gstin = gstin;
        c.total_spent = r2_(c.total_spent + amount);
        c.bills += 1;
        c.last_visit = now;
        updateRows_("Customers", [c]);
        return c;
    }
    c = {
        id: nextId_("Customers"), name: str_(cust.name), phone, gstin, total_spent: r2_(amount), bills: 1,
        last_visit: now, created_at: now,
    };
    appendRows_("Customers", [c]);
    return c;
}

function adjustCustomerTotals_(customerId, amountDelta, billsDelta) {
    if (!customerId) return;
    const c = findBy_("Customers", "id", customerId);
    if (!c) return;
    c.total_spent = r2_(Math.max(0, c.total_spent + amountDelta));
    c.bills = Math.max(0, c.bills + billsDelta);
    updateRows_("Customers", [c]);
}
