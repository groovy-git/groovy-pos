import { useEffect, useMemo, useState } from "react";
import { Plus, PackagePlus, Upload, Pencil, History, SlidersHorizontal, Boxes, Download, ArrowRightLeft } from "lucide-react";
import { useApp } from "../store";
import { api } from "../lib/api";
import { navigate, useRoute } from "../lib/router";
import { searchItems, lookupBarcode } from "../lib/catalog";
import { inr, fmtDateTime, qtyLabel, r3, plural } from "../lib/format";
import { beepError, beepOk } from "../lib/feedback";
import { parseCSV, downloadText, IMPORT_TEMPLATE } from "../lib/files";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import TopBar from "../components/TopBar";
import CameraScanner from "../components/CameraScanner";
import { Button, Chips, Empty, Field, SearchBar, Seg, Sheet, SkeletonList, StockBadge, Thumb, useConfirm } from "../components/ui";

export default function Stock({ tab }) {
  const { isManager, multiBranch } = useApp();
  const t = isManager && (tab === "batches" || (tab === "transfers" && multiBranch)) ? tab : "products";
  return (
    <>
      <TopBar title={isManager ? "Stock" : "Products"} />
      <div className="page">
        {isManager && (
          <div className="mb">
            <Seg
              value={t}
              onChange={(v) => navigate(v === "products" ? "stock" : "stock/" + v, { replace: true })}
              options={[
                { value: "products", label: "Products" },
                { value: "batches", label: multiBranch ? "Stock In" : "Stock In history" },
                ...(multiBranch ? [{ value: "transfers", label: "Transfers" }] : []),
              ]}
            />
          </div>
        )}
        {t === "products" ? <Products /> : t === "transfers" ? <Transfers /> : <Batches />}
      </div>
    </>
  );
}

function Products() {
  const { catalog, isManager, toast, multiBranch } = useApp();
  const route = useRoute();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(route.params.get("filter") || "all");
  const [scan, setScan] = useState(false);
  const [open, setOpen] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, confirmNode] = useConfirm();

  const list = useMemo(() => {
    let l = catalog.items;
    if (filter === "low") l = l.filter((i) => i.active && (i.stock <= 0 || (i.reorder > 0 && i.stock <= i.reorder)));
    else if (filter === "out") l = l.filter((i) => i.active && i.stock <= 0);
    else if (filter === "hidden") l = l.filter((i) => !i.active);
    else l = l.filter((i) => i.active);
    return searchItems(l, q);
  }, [catalog, q, filter]);

  const onCode = (code) => {
    const it = lookupBarcode(catalog, code);
    if (it) {
      setOpen(it);
      setScan(false);
      return { ok: true, label: `${it.name} ${it.size}` };
    }
    setScan(false);
    if (isManager)
      confirm({ title: "New barcode", text: `No product has barcode ${code}. Create a new product with it?`, okText: "Create product" }).then(
        (yes) => yes && navigate(`stock/product/new?barcode=${encodeURIComponent(code)}`),
      );
    return { ok: false, label: `Barcode ${code} not found` };
  };

  useBarcodeScanner((code, target) => {
    if (target && target.tagName === "INPUT") setQ("");
    const r = onCode(code);
    r.ok ? beepOk() : beepError();
    if (!r.ok && !isManager) toast(r.label, "error");
  }, !scan && !open && !importOpen);

  return (
    <>
      <SearchBar value={q} onChange={setQ} placeholder="Search products or barcode" onScan={() => setScan(true)} />
      <div className="mt">
        <Chips
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All (${catalog.items.filter((i) => i.active).length})` },
            { value: "low", label: "Low stock" },
            { value: "out", label: "Out of stock" },
            ...(isManager ? [{ value: "hidden", label: "Hidden" }] : []),
          ]}
        />
      </div>
      {isManager && (
        <div className="row mt">
          <button className="btn dark grow" onClick={() => navigate("stock/in")}>
            <PackagePlus size={18} /> Stock In
          </button>
          {multiBranch && (
            <button className="btn secondary" onClick={() => navigate("stock/transfer")} aria-label="Transfer stock to another branch">
              <ArrowRightLeft size={18} /> Transfer
            </button>
          )}
          <button className="btn secondary" onClick={() => setImportOpen(true)} aria-label="Import products from CSV">
            <Upload size={18} /> Import
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <Empty icon={Boxes} title="No products" text={q ? "Nothing matches your search." : isManager ? "Add your first product with the + button." : ""} />
      ) : (
        <div className="list mt">
          {list.slice(0, 300).map((it) => (
            <button key={it.id} className="list-item" onClick={() => setOpen(it)}>
              <Thumb item={it} />
              <div className="grow">
                <div className="title ellipsis">{it.name}</div>
                <div className="sub ellipsis">
                  {[it.brand, it.size].filter(Boolean).join(" · ")} · {inr(it.price)}
                  {it.unit === "ml" ? "/ml" : ""}
                </div>
              </div>
              <StockBadge item={it} />
            </button>
          ))}
        </div>
      )}

      {isManager && (
        <button className="fab" onClick={() => navigate("stock/product/new")}>
          <Plus size={20} /> Add product
        </button>
      )}
      <CameraScanner open={scan} onClose={() => setScan(false)} onCode={onCode} continuous={false} title="Scan to find product" />
      <ItemSheet item={open} onClose={() => setOpen(null)} />
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      {confirmNode}
    </>
  );
}

function ItemSheet({ item, onClose }) {
  const { isManager, catalog, multiBranch, branches, branchId } = useApp();
  const [adjust, setAdjust] = useState(false);
  const [moves, setMoves] = useState(null);
  const live = item ? catalog.byVariant.get(item.id) || item : null;

  useEffect(() => {
    setMoves(null);
  }, [item]);

  if (!item) return null;
  const loadMoves = async () => {
    setMoves("loading");
    try {
      const r = await api("movements", { variant_id: item.id, limit: 50 });
      setMoves(r.data);
    } catch {
      setMoves([]);
    }
  };
  return (
    <Sheet open onClose={onClose} title={live.name}>
      <div className="row mb">
        <Thumb item={live} size={64} />
        <div className="grow">
          <div className="brand-label">{live.brand}</div>
          <div className="bold">{live.size}</div>
          <StockBadge item={live} />
        </div>
      </div>
      <div className="card">
        <div className="kv"><span className="k">Selling price</span><b>{inr(live.price)}{live.unit === "ml" ? " /ml" : ""}</b></div>
        <div className="kv"><span className="k">MRP</span><span>{inr(live.mrp)}</span></div>
        {isManager && live.cost !== undefined && <div className="kv"><span className="k">Avg cost</span><span>{inr(live.cost, { paise: true })}</span></div>}
        <div className="kv"><span className="k">{multiBranch && branchId ? "In stock here" : "In stock"}</span><b>{qtyLabel(live.stock, live.unit)}</b></div>
        {multiBranch && (
          <div className="kv">
            <span className="k">{branchId ? "Other branches" : "By branch"}</span>
            <span className="right small">
              {branches
                .filter((b) => b.id !== branchId)
                .map((b) => `${b.name} ${qtyLabel(live.stockBy[b.id] || 0, live.unit)}`)
                .join(" · ")}
            </span>
          </div>
        )}
        <div className="kv"><span className="k">Barcode</span><span className="money">{live.barcode || "—"}</span></div>
        <div className="kv"><span className="k">Category</span><span>{live.category}</span></div>
        <div className="kv"><span className="k">GST</span><span>{live.gst}% · HSN {live.hsn || "—"}</span></div>
      </div>
      {isManager && (
        <div className="grid-2 mt">
          <button className="btn secondary" onClick={() => navigate(`stock/product/${live.product_id}`)}>
            <Pencil size={17} /> Edit
          </button>
          <button className="btn secondary" onClick={() => setAdjust(true)} disabled={multiBranch && !branchId} title={multiBranch && !branchId ? "Choose a branch first" : undefined}>
            <SlidersHorizontal size={17} /> Adjust stock
          </button>
        </div>
      )}
      <button className="btn ghost block mt" onClick={loadMoves}>
        <History size={17} /> Stock history
      </button>
      {moves === "loading" && <SkeletonList rows={3} height={44} />}
      {Array.isArray(moves) && (moves.length === 0 ? <div className="muted small center">No movements yet</div> : (
        <div className="list">
          {moves.map((m) => (
            <div key={m.id} className="list-item" style={{ minHeight: 50, cursor: "default" }}>
              <div className="grow">
                <div className="title small">{MOVE_LABEL[m.type] || m.type} {m.note ? <span className="muted">· {m.note}</span> : null}</div>
                <div className="sub">{fmtDateTime(m.at)} · {m.user_name}{multiBranch ? " · " + m.branch_name : ""}</div>
              </div>
              <div className="right">
                <b className={m.qty < 0 ? "bad-text" : "ok-text"}>{m.qty > 0 ? "+" : ""}{m.qty}</b>
                <div className="tiny muted">bal {m.balance}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
      <AdjustSheet open={adjust} item={live} onClose={() => setAdjust(false)} />
    </Sheet>
  );
}

const MOVE_LABEL = {
  opening: "Opening stock", stock_in: "Stock in", sale: "Sold", return: "Returned", void: "Bill voided", adjust: "Adjusted",
  damage: "Damaged", tester: "Tester use", transfer_out: "Sent to branch", transfer_in: "Received from branch",
};

function AdjustSheet({ open, item, onClose }) {
  const { patchStock, toast } = useApp();
  const [mode, setMode] = useState("remove");
  const [reason, setReason] = useState("damage");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setMode("remove");
      setReason("damage");
      setQty("");
      setNote("");
    }
  }, [open]);
  if (!item) return null;
  const n = Number(qty) || 0;
  const after = mode === "set" ? n : mode === "add" ? r3(item.stock + n) : r3(item.stock - n);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("adjustStock", { variant_id: item.id, mode, qty: n, reason: mode === "set" ? "count" : reason, note });
      patchStock([{ id: item.id, stock_qty: r.data.stock_qty }]);
      toast(r.message, "success");
      onClose();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Adjust stock"
      footer={
        <Button className="block big" loading={busy} disabled={qty === "" || (mode !== "set" && n <= 0)} onClick={save}>
          Save · new stock {after}
        </Button>
      }
    >
      <div className="small muted mb">
        {item.name} {item.size} · now <b>{qtyLabel(item.stock, item.unit)}</b>
      </div>
      <Seg
        value={mode}
        onChange={setMode}
        options={[
          { value: "remove", label: "Remove" },
          { value: "add", label: "Add" },
          { value: "set", label: "Set count" },
        ]}
      />
      {mode === "remove" && (
        <div className="chips mt">
          {[
            ["damage", "Damaged / leaked"],
            ["tester", "Used as tester"],
            ["other", "Other"],
          ].map(([v, l]) => (
            <button key={v} className={"chip" + (reason === v ? " active" : "")} onClick={() => setReason(v)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <Field label={mode === "set" ? `Actual count on shelf (${item.unit})` : `Quantity (${item.unit})`} hint={mode === "set" ? "Use after a physical stock count" : ""}>
        <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} autoFocus />
      </Field>
      <Field label="Note (optional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function ImportSheet({ open, onClose }) {
  const { refreshCatalog, toast } = useApp();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setRows(null);
      setResult(null);
    }
  }, [open]);
  const pick = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const parsed = parseCSV(String(rd.result));
      setRows(parsed);
      setResult(null);
    };
    rd.readAsText(f);
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await api("importCatalog", { rows });
      setResult(r.data);
      toast(r.message, r.data.errors.length ? "warn" : "success", 4000);
      refreshCatalog();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Import products (CSV)"
      footer={
        rows && !result ? (
          <Button className="block big" loading={busy} onClick={run} disabled={!rows.length}>
            Import {rows.length} rows
          </Button>
        ) : null
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        One row per size. Rows with the same brand + product become sizes of one product. Leave barcode empty and generate codes later if needed. For loose attar use sale_type
        “loose” and prices per ml.
      </p>
      <button className="btn secondary block" onClick={() => downloadText("groovy-products-template.csv", IMPORT_TEMPLATE)}>
        <Download size={18} /> Download template
      </button>
      <div className="field mt">
        <label>Choose CSV file (from Excel / Google Sheets: File → Download → CSV)</label>
        <input className="input" type="file" accept=".csv,text/csv" onChange={pick} />
      </div>
      {rows && !result && (
        <div className="card">
          <b>{rows.length} rows found.</b>
          <div className="small muted">First row: {rows[0] ? `${rows[0].brand || ""} ${rows[0].product || ""} ${rows[0].size_label || ""}` : "—"}</div>
        </div>
      )}
      {result && (
        <div className="card">
          <b>
            Added {result.variants} sizes in {result.products} new products.
          </b>
          {result.errors.length > 0 && (
            <>
              <div className="bad-text small mt">{result.errors.length} rows skipped:</div>
              {result.errors.slice(0, 50).map((e) => (
                <div key={e.row} className="small">
                  Row {e.row}: {e.message}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Batches() {
  const { toast, multiBranch } = useApp();
  const [list, setList] = useState(null);
  useEffect(() => {
    api("stockInBatches")
      .then((r) => setList(r.data))
      .catch((e) => {
        toast(e.message, "error");
        setList([]);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <SkeletonList />;
  return (
    <>
      <button className="btn dark block mb" onClick={() => navigate("stock/in")}>
        <PackagePlus size={18} /> New Stock In
      </button>
      {list.length === 0 ? (
        <Empty icon={PackagePlus} title="No stock received yet" text="Use Stock In to scan and add new stock." />
      ) : (
        <div className="list">
          {list.map((b) => (
            <div key={b.id} className="list-item" style={{ cursor: "default" }}>
              <div className="grow">
                <div className="title">{b.supplier_note || "Stock In #" + b.id}</div>
                <div className="sub">
                  {fmtDateTime(b.at)} · {b.user_name} {b.bill_ref ? "· Bill " + b.bill_ref : ""}
                  {multiBranch ? " · " + b.branch_name : ""}
                </div>
              </div>
              <div className="right">
                <b>{b.total_qty} units</b>
                <div className="tiny muted">{b.lines} items{b.total_cost ? " · " + inr(b.total_cost) : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Transfers() {
  const { toast, catalog } = useApp();
  const [list, setList] = useState(null);
  useEffect(() => {
    api("listTransfers")
      .then((r) => setList(r.data))
      .catch((e) => {
        toast(e.message, "error");
        setList([]);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <SkeletonList />;
  return (
    <>
      <button className="btn dark block mb" onClick={() => navigate("stock/transfer")}>
        <ArrowRightLeft size={18} /> New transfer
      </button>
      {list.length === 0 ? (
        <Empty icon={ArrowRightLeft} title="No transfers yet" text="Send stock from this branch to another with New transfer." />
      ) : (
        <div className="list">
          {list.map((t) => (
            <div key={t.id} className="list-item" style={{ cursor: "default", alignItems: "flex-start" }}>
              <div className="grow">
                <div className="title">
                  {t.from_name} → {t.to_name}
                </div>
                <div className="sub">
                  {t.transfer_no} · {fmtDateTime(t.at)} · {t.user_name}
                  {t.note ? " · " + t.note : ""}
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {t.items
                    .map((i) => {
                      const it = catalog.byVariant.get(i.variant_id);
                      return it ? `${it.name} ${it.unit === "ml" ? "" : it.size} × ${qtyLabel(i.qty, it.unit)}` : "";
                    })
                    .filter(Boolean)
                    .join(", ")}
                </div>
              </div>
              <b className="nowrap">{plural("unit", t.total_qty)}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
