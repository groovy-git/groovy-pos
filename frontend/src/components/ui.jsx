import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, ScanLine, Minus, Plus, PackageOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { useBackClose } from "../hooks/useBackClose";
import { useApp } from "../store";
import { initials } from "../lib/format";
import { imageUrl } from "../lib/catalog";

// Rendered into <body> so a sheet opened from inside a styled container (e.g. the brown
// sidebar) never inherits that container's styles.
export function Sheet({ open, onClose, title, children, footer, full = false, headerRight }) {
  useBackClose(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={"sheet" + (full ? " full" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="handle" />
        <div className="sheet-head">
          <h2>{title}</h2>
          {headerRight}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.type}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ size = 22 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function Button({ loading, children, className = "", ...rest }) {
  return (
    <button className={"btn " + className} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner size={18} /> : children}
    </button>
  );
}

export function Empty({ icon: Icon = PackageOpen, title, text, action }) {
  return (
    <div className="empty">
      <Icon size={44} />
      <h3>{title}</h3>
      {text && <div className="small">{text}</div>}
      {action && <div className="mt">{action}</div>}
    </div>
  );
}

export function SkeletonList({ rows = 5, height = 62 }) {
  return (
    <div className="col gap-s">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder = "Search", onScan, autoFocus, inputRef }) {
  return (
    <div className="search">
      <Search size={19} color="var(--muted)" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {value && (
        <button className="icon-btn" onClick={() => onChange("")} aria-label="Clear search" style={{ width: 36, height: 36 }}>
          <X size={18} />
        </button>
      )}
      {onScan && (
        <button className="icon-btn filled" onClick={onScan} aria-label="Scan with camera" style={{ width: 40, height: 40 }}>
          <ScanLine size={20} />
        </button>
      )}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = Infinity, step = 1, decimals = 0 }) {
  const [text, setText] = useState(null);
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const commit = (raw) => {
    const n = parseFloat(raw);
    setText(null);
    if (!isNaN(n)) onChange(clamp(decimals ? Math.round(n * 10 ** decimals) / 10 ** decimals : Math.round(n)));
  };
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(value - step))} aria-label="Less">
        <Minus size={18} />
      </button>
      <input
        inputMode={decimals ? "decimal" : "numeric"}
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="Quantity"
      />
      <button type="button" onClick={() => onChange(clamp(value + step))} aria-label="More">
        <Plus size={18} />
      </button>
    </div>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

export function MoneyInput({ value, onChange, placeholder = "0", ...rest }) {
  return (
    <div className="input-wrap">
      <span className="prefix">₹</span>
      <input
        className="input"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        {...rest}
      />
    </div>
  );
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Horizontally scrolling chip row. Fades + ‹ › buttons show there is more; the mouse wheel
// scrolls sideways on computers; the selected chip is kept in view.
export function Chips({ options, value, onChange }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [options.length]);

  useEffect(() => {
    const active = ref.current && ref.current.querySelector(".chip.active");
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);

  const by = (dir) => ref.current.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: "smooth" });

  return (
    <div className="chips-wrap">
      <div className="chips" ref={ref}>
        {options.map((o) => (
          <button key={o.value} className={"chip" + (value === o.value ? " active" : "")} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {edge.left && (
        <>
          <span className="chips-fade left" />
          <button type="button" className="chips-arrow left" onClick={() => by(-1)} aria-label="Scroll left">
            <ChevronLeft size={18} />
          </button>
        </>
      )}
      {edge.right && (
        <>
          <span className="chips-fade right" />
          <button type="button" className="chips-arrow right" onClick={() => by(1)} aria-label="More options">
            <ChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  );
}

export function Thumb({ item, size = 48, radius = 10 }) {
  const [bad, setBad] = useState(false);
  const url = !bad && imageUrl(item.image, size * 3);
  return (
    <div style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", flex: "none" }}>
      {url ? (
        <img src={url} alt="" loading="lazy" onError={() => setBad(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div className="placeholder-mono" style={{ fontSize: size * 0.36 }}>
          {initials(item.brand || item.name)}
        </div>
      )}
    </div>
  );
}

export function Avatar({ name, gold }) {
  return <div className={"avatar" + (gold ? " gold" : "")}>{initials(name)}</div>;
}

export function StockBadge({ item }) {
  if (item.stock <= 0) return <span className="badge bad">Out of stock</span>;
  if (item.reorder > 0 && item.stock <= item.reorder)
    return <span className="badge gold">Low · {item.unit === "ml" ? `${item.stock} ml` : item.stock}</span>;
  return <span className="badge ok">{item.unit === "ml" ? `${item.stock} ml` : `${item.stock} in stock`}</span>;
}

// simple confirm sheet: const confirm = useConfirm(); if (await confirm({...})) ...
export function ConfirmSheet({ state, setState }) {
  if (!state) return null;
  const done = (v) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <Sheet
      open
      onClose={() => done(false)}
      title={state.title}
      footer={
        <div className="row">
          <button className="btn secondary grow" onClick={() => done(false)}>
            {state.cancelText || "Cancel"}
          </button>
          <button className={"btn grow " + (state.danger ? "danger" : "")} onClick={() => done(true)}>
            {state.okText || "OK"}
          </button>
        </div>
      }
    >
      <p style={{ marginTop: 0 }}>{state.text}</p>
    </Sheet>
  );
}

export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = (opts) => new Promise((resolve) => setState({ ...opts, resolve }));
  const node = <ConfirmSheet state={state} setState={setState} />;
  return [confirm, node];
}
