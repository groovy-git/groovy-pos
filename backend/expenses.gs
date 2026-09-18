/** Shop expenses (rent, salary, tea, packaging…). */

function apiListExpenses_(p, ctx) {
    const from = str_(p.from) || todayStr_().slice(0, 8) + "01";
    const to = str_(p.to) || todayStr_();
    const users = indexBy_(rows_("Users"), "id");
    let rows = rows_("Expenses").filter((e) => e.date >= from && e.date <= to && inBranch_(ctx, e.branch_id));
    if (p.category) rows = rows.filter((e) => e.category === p.category);
    const list = rows
        .slice()
        .sort((a, b) => (b.date + pad_(b.id, 8)).localeCompare(a.date + pad_(a.id, 8)))
        .map((e) => ({
            id: e.id, date: e.date, category: e.category, title: e.title, amount: e.amount, method: e.method,
            notes: e.notes, user_name: users[e.user_id] ? users[e.user_id].name : "", branch_name: branchName_(bid_(e.branch_id)),
        }));
    return { data: { expenses: list, total: r2_(list.reduce((a, e) => a + e.amount, 0)) } };
}

function apiSaveExpense_(p, ctx) {
    const title = str_(p.title);
    const amount = r2_(num_(p.amount));
    const date = str_(p.date) || todayStr_();
    if (!title) fail_("What was the expense for?");
    if (amount <= 0) fail_("Enter the amount");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail_("Invalid date");
    if (date > todayStr_()) fail_("Date cannot be in the future");
    const method = PAYMENT_METHODS.indexOf(p.method) >= 0 ? p.method : "cash";
    if (!p.id) requireBranch_(ctx); // new expenses belong to the branch you are working at
    return withLock_(() => {
        if (p.id) {
            const e = findBy_("Expenses", "id", Number(p.id));
            if (!e) fail_("Expense not found");
            assertExpenseBranch_(ctx, e);
            Object.assign(e, { date, category: str_(p.category) || "Other", title, amount, method, notes: str_(p.notes) });
            updateRows_("Expenses", [e]);
            log_(ctx, "UPDATE", "Expenses", e.id, title + " ₹" + amount);
            return { message: "Expense saved" };
        }
        const id = nextId_("Expenses");
        appendRows_("Expenses", [
            { id, date, category: str_(p.category) || "Other", title, amount, method, notes: str_(p.notes), user_id: ctx.user.id, created_at: nowStr_(), branch_id: ctx.branch_id },
        ]);
        log_(ctx, "CREATE", "Expenses", id, title + " ₹" + amount);
        return { message: "Expense added", data: { id } };
    });
}

function apiDeleteExpense_(p, ctx) {
    return withLock_(() => {
        const e = findBy_("Expenses", "id", Number(p.id));
        if (!e) fail_("Expense not found");
        assertExpenseBranch_(ctx, e);
        deleteRow_("Expenses", e);
        log_(ctx, "DELETE", "Expenses", e.id, e.title + " ₹" + e.amount);
        return { message: "Expense deleted" };
    });
}

function assertExpenseBranch_(ctx, e) {
    if (ctx.user.role !== "admin" && allowedBranchIds_(ctx.user).indexOf(bid_(e.branch_id)) < 0) fail_("This expense belongs to another branch");
}
