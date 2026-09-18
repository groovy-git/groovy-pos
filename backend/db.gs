/**
 * Table helpers — every sheet is read at most once per request and cached here.
 * Records are plain objects keyed by header name, plus `_r` (1-based sheet row).
 */

let REQ_CACHE_ = {};

function resetReqCache_() {
    REQ_CACHE_ = {};
}

function ss_() {
    if (!REQ_CACHE_.__ss) {
        const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
        REQ_CACHE_.__ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    }
    return REQ_CACHE_.__ss;
}

function sheet_(name) {
    const sh = ss_().getSheetByName(name);
    if (!sh) throw new AppError_("Sheet '" + name + "' missing. Run Setup from the Groovy POS menu.");
    return sh;
}

function cols_(name) {
    return Object.keys(SCHEMA[name]);
}

// coerce a raw cell into the schema type
function fromCell_(v, type) {
    if (type === "n") {
        if (v === "" || v === null) return 0;
        const n = typeof v === "number" ? v : parseFloat(v);
        return isNaN(n) ? 0 : n;
    }
    if (v instanceof Date) return fmtDateTime_(v);
    if (type === "j") {
        if (!v) return null;
        try {
            return JSON.parse(v);
        } catch (e) {
            return null;
        }
    }
    return v === null || v === undefined ? "" : String(v);
}

function toCell_(v, type) {
    if (type === "n") {
        if (v === "" || v === null || v === undefined) return "";
        const n = Number(v);
        return isNaN(n) ? "" : n;
    }
    if (type === "j") return v === null || v === undefined ? "" : JSON.stringify(v);
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (s.charAt(0) === "=") s = "'" + s; // no formula injection
    return s;
}

function readTable_(name) {
    if (REQ_CACHE_[name]) return REQ_CACHE_[name];
    const sh = sheet_(name);
    const schema = SCHEMA[name];
    const keys = Object.keys(schema);
    // header + data in one read; a missing/renamed last column means Setup hasn't run after an update
    const outdated = () => new AppError_("The app was updated — open the Google Sheet and run Groovy POS → 1. Setup / repair sheets.", "SETUP");
    let vals;
    try {
        vals = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), keys.length).getValues();
    } catch (e) {
        throw outdated(); // sheet has fewer columns than this version needs
    }
    if (String(vals[0][keys.length - 1]) !== keys[keys.length - 1]) throw outdated();
    const rows = [];
    for (let i = 1; i < vals.length; i++) {
        const raw = vals[i];
        if (raw[0] === "" && raw.every((c) => c === "")) continue;
        const o = { _r: i + 1 };
        for (let k = 0; k < keys.length; k++) o[keys[k]] = fromCell_(raw[k], schema[keys[k]]);
        rows.push(o);
    }
    const t = { name, sh, keys, rows };
    REQ_CACHE_[name] = t;
    return t;
}

function rows_(name) {
    return readTable_(name).rows;
}

function indexBy_(rows, key) {
    const m = {};
    for (let i = 0; i < rows.length; i++) m[rows[i][key]] = rows[i];
    return m;
}

function findBy_(name, key, val) {
    const rows = rows_(name);
    for (let i = 0; i < rows.length; i++) if (rows[i][key] == val) return rows[i];
    return null;
}

function nextId_(name) {
    const rows = rows_(name);
    let max = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i].id > max) max = rows[i].id;
    return max + 1;
}

function rowArray_(name, obj) {
    const schema = SCHEMA[name];
    return Object.keys(schema).map((k) => toCell_(obj[k], schema[k]));
}

// [start,len] runs of 1-based text (non-numeric) column positions
function textColRuns_(name) {
    const schema = SCHEMA[name];
    const keys = Object.keys(schema);
    const runs = [];
    keys.forEach((k, i) => {
        if (schema[k] === "n") return;
        const last = runs[runs.length - 1];
        if (last && last[0] + last[1] === i + 1) last[1]++;
        else runs.push([i + 1, 1]);
    });
    return runs;
}

// plain-text format keeps leading zeros in barcodes/phones and stops date auto-parsing
function formatTextCols_(sh, name, startRow, numRows) {
    textColRuns_(name).forEach(([c, len]) => sh.getRange(startRow, c, numRows, len).setNumberFormat("@"));
}

function ensureRows_(sh, needLast) {
    const max = sh.getMaxRows();
    if (needLast > max) sh.insertRowsAfter(max, needLast - max + 200);
}

/** Append objects (ids must already be set). Updates the request cache. */
function appendRows_(name, objs) {
    if (!objs.length) return;
    const t = readTable_(name);
    const start = t.sh.getLastRow() + 1;
    ensureRows_(t.sh, start + objs.length - 1);
    formatTextCols_(t.sh, name, start, objs.length);
    t.sh.getRange(start, 1, objs.length, t.keys.length).setValues(objs.map((o) => rowArray_(name, o)));
    objs.forEach((o, i) => {
        const copy = Object.assign({}, o, { _r: start + i });
        t.keys.forEach((k) => {
            if (copy[k] === undefined) copy[k] = SCHEMA[name][k] === "n" ? 0 : "";
        });
        t.rows.push(copy);
    });
}

/** Write back full records that carry `_r`. */
function updateRows_(name, objs) {
    const t = readTable_(name);
    objs.forEach((o) => {
        if (!o._r) throw new Error("updateRows_ needs _r");
        t.sh.getRange(o._r, 1, 1, t.keys.length).setValues([rowArray_(name, o)]);
    });
}

/** Update single columns for many records: [{_r, ...fields}] — one call per cell. */
function updateFields_(name, obj, fields) {
    const t = readTable_(name);
    fields.forEach((f) => {
        const c = t.keys.indexOf(f);
        if (c < 0) throw new Error("Unknown column " + f);
        t.sh.getRange(obj._r, c + 1).setValue(toCell_(obj[f], SCHEMA[name][f]));
    });
}

/**
 * Batch-write one numeric column for several records in as few calls as possible
 * (contiguous row runs are written together).
 */
function writeColumn_(name, records, field) {
    if (!records.length) return;
    const t = readTable_(name);
    const c = t.keys.indexOf(field) + 1;
    const sorted = records.slice().sort((a, b) => a._r - b._r);
    let run = [sorted[0]];
    const flush = () => {
        t.sh.getRange(run[0]._r, c, run.length, 1).setValues(run.map((r) => [toCell_(r[field], SCHEMA[name][field])]));
    };
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]._r === run[run.length - 1]._r + 1) run.push(sorted[i]);
        else {
            flush();
            run = [sorted[i]];
        }
    }
    flush();
}

function deleteRow_(name, obj) {
    const t = readTable_(name);
    t.sh.deleteRow(obj._r);
    delete REQ_CACHE_[name]; // row numbers shifted
}

function withLock_(fn) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new AppError_("Server busy, please try again.");
    try {
        // re-read fresh data inside the lock
        const ss = REQ_CACHE_.__ss;
        REQ_CACHE_ = {};
        if (ss) REQ_CACHE_.__ss = ss;
        return fn();
    } finally {
        SpreadsheetApp.flush();
        lock.releaseLock();
    }
}

/* ---------- dates (IST) ---------- */

function fmtDateTime_(d) {
    return Utilities.formatDate(d || new Date(), APP.TZ, "yyyy-MM-dd HH:mm:ss");
}

function fmtDate_(d) {
    return Utilities.formatDate(d || new Date(), APP.TZ, "yyyy-MM-dd");
}

function nowStr_() {
    return fmtDateTime_(new Date());
}

function todayStr_() {
    return fmtDate_(new Date());
}

// "yyyy-MM-dd" n days before today (IST)
function daysAgoStr_(n) {
    return fmtDate_(new Date(Date.now() - n * 86400000));
}

/* ---------- misc ---------- */

function AppError_(message, code) {
    this.message = message;
    this.code = code || "ERROR";
    this.isAppError = true;
}

function fail_(message, code) {
    throw new AppError_(message, code);
}

function r2_(x) {
    return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

function r3_(x) {
    return Math.round((Number(x) + Number.EPSILON) * 1000) / 1000;
}

function str_(v) {
    return v === null || v === undefined ? "" : String(v).trim();
}

function num_(v, def) {
    const n = parseFloat(v);
    return isNaN(n) ? (def === undefined ? 0 : def) : n;
}

function pad_(n, len) {
    let s = String(n);
    while (s.length < len) s = "0" + s;
    return s;
}

function uuid_() {
    return Utilities.getUuid().replace(/-/g, "");
}
