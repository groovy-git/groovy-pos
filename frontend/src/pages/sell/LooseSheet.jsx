import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useApp } from "../../store";
import { inr, r2, r3 } from "../../lib/format";
import { qtyInCart } from "../../lib/cart";
import { Seg, Sheet, Thumb } from "../../components/ui";

// Loose attar: pick ml (or tola) and optionally add an empty bottle in the same step.
export default function LooseSheet({ item, onClose, onAdd }) {
  const { settings, catalog, cart, toast } = useApp();
  const tolaMl = Number(settings.tola_ml) || 12;
  const [unit, setUnit] = useState("ml");
  const [val, setVal] = useState("6");
  const [bottle, setBottle] = useState(null);

  useEffect(() => {
    if (item) {
      setUnit("ml");
      setVal("6");
      setBottle(null);
    }
  }, [item]);

  const bottles = useMemo(
    () => catalog.items.filter((i) => i.active && !i.loose && i.stock > 0 && /bottle/i.test(i.category + " " + i.name)).slice(0, 8),
    [catalog],
  );

  if (!item) return null;
  const ml = r3(unit === "tola" ? (Number(val) || 0) * tolaMl : Number(val) || 0);
  const left = r3(item.stock - qtyInCart(cart.lines, item.id));
  const price = r2(ml * item.price);
  const quick = unit === "ml" ? [3, 6, 8, 12, 24] : [0.25, 0.5, 1, 2];

  const add = () => {
    if (ml <= 0) return toast("Enter the quantity", "error");
    const r = onAdd(item, ml);
    if (!r.ok) return toast(r.label, "error");
    if (bottle) {
      const rb = onAdd(bottle, 1);
      if (!rb.ok) toast(rb.label, "error");
    }
    toast(`${ml} ml ${item.name} added`, "success", 1500);
    onClose();
  };

  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title="Loose attar"
      footer={
        <button className="btn big block" onClick={add} disabled={ml <= 0}>
          Add {ml > 0 ? `${ml} ml · ${inr(price + (bottle ? bottle.price : 0))}` : ""}
        </button>
      }
    >
      <div className="row mb">
        <Thumb item={item} size={52} />
        <div className="grow">
          <div className="bold serif">{item.name}</div>
          <div className="small muted">
            {inr(item.price)}/ml · {left} ml left
          </div>
        </div>
      </div>
      <Seg
        value={unit}
        onChange={(u) => {
          setUnit(u);
          setVal(u === "ml" ? "6" : "0.5");
        }}
        options={[
          { value: "ml", label: "Millilitre (ml)" },
          { value: "tola", label: `Tola (${tolaMl} ml)` },
        ]}
      />
      <div className="chips mt">
        {quick.map((qv) => (
          <button key={qv} className={"chip" + (Number(val) === qv ? " active" : "")} onClick={() => setVal(String(qv))}>
            {qv} {unit}
          </button>
        ))}
      </div>
      <div className="field mt">
        <label>Quantity in {unit}</label>
        <input className="input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ""))} />
        {unit === "tola" && ml > 0 && <div className="hint">= {ml} ml</div>}
        {ml > left && <div className="err">Only {left} ml in stock</div>}
      </div>

      {bottles.length > 0 && (
        <>
          <div className="section-label">Add a bottle?</div>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            <button className={"chip" + (!bottle ? " active" : "")} onClick={() => setBottle(null)}>
              No bottle
            </button>
            {bottles.map((b) => (
              <button key={b.id} className={"chip" + (bottle && bottle.id === b.id ? " active" : "")} onClick={() => setBottle(b)}>
                {bottle && bottle.id === b.id && <Check size={14} />} {b.name} {b.size} · {inr(b.price)}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
