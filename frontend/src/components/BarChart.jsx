import { useState } from "react";
import { inr, fmtDate } from "../lib/format";

// Small dependency-free bar chart; tap a bar to see its value.
export default function BarChart({ data, height = 150 }) {
  const [sel, setSel] = useState(data.length - 1);
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  const cur = data[sel] || data[data.length - 1];
  return (
    <div>
      {cur && (
        <div className="row between small mb">
          <span className="muted">{fmtDate(cur.label)}</span>
          <b className="money">{inr(Math.round(cur.value))}</b>
        </div>
      )}
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" style={{ width: "100%", height }} role="img" aria-label="Daily sales for the last 30 days">
        {data.map((d, i) => {
          const h = (Math.max(0, d.value) / max) * (height / 3 - 1);
          return (
            <rect
              key={d.label}
              x={i * w + w * 0.15}
              y={height / 3 - h}
              width={w * 0.7}
              height={Math.max(h, 0.4)}
              rx={0.6}
              fill={i === sel ? "var(--brown)" : "var(--gold)"}
              onClick={() => setSel(i)}
              style={{ cursor: "pointer" }}
            >
              <title>
                {d.label}: {inr(d.value)}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="row between tiny muted">
        <span>{data[0] && fmtDate(data[0].label).replace(/ \d{4}$/, "")}</span>
        <span>Today</span>
      </div>
    </div>
  );
}
