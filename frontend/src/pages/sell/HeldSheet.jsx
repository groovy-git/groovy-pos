import { useEffect, useState } from "react";
import { Clock, Trash2 } from "lucide-react";
import { useApp } from "../../store";
import { api } from "../../lib/api";
import { runBusy } from "../../lib/busy";
import { fmtDateTime } from "../../lib/format";
import { Empty, Sheet, SkeletonList, useConfirm } from "../../components/ui";

export default function HeldSheet({ open, onClose }) {
  const { cart, setCart, toast, catalog } = useApp();
  const [list, setList] = useState(null);
  const [confirm, confirmNode] = useConfirm();

  useEffect(() => {
    if (!open) return;
    setList(null);
    api("listHeld")
      .then((r) => setList(r.data))
      .catch((e) => {
        toast(e.message, "error");
        setList([]);
      });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const resume = async (h) => {
    if (cart.lines.length && !(await confirm({ title: "Replace current bill?", text: "The items in the current bill will be removed.", okText: "Replace" }))) return;
    const lines = (h.cart.lines || []).filter((l) => catalog.byVariant.has(l.variant_id));
    setCart({ ...h.cart, lines, held_id: h.id, client_ref: null });
    toast("Held bill loaded", "success");
    onClose();
  };

  const remove = async (h) => {
    if (!(await confirm({ title: "Delete held bill?", text: h.label, okText: "Delete", danger: true }))) return;
    try {
      await runBusy("Deleting held bill…", () => api("deleteHeld", { id: h.id }));
      setList((l) => l.filter((x) => x.id !== h.id));
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Held bills">
      {!list ? (
        <SkeletonList rows={3} />
      ) : list.length === 0 ? (
        <Empty icon={Clock} title="No held bills" text="Use “Hold” in the bill to park a sale and serve the next customer." />
      ) : (
        <div className="list">
          {list.map((h) => (
            <div key={h.id} className="list-item" onClick={() => resume(h)}>
              <div className="avatar gold">
                <Clock size={18} />
              </div>
              <div className="grow">
                <div className="title">{h.label}</div>
                <div className="sub">
                  {(h.cart.lines || []).length} items · {fmtDateTime(h.at)} · {h.user_name}
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(h);
                }}
                aria-label="Delete held bill"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      {confirmNode}
    </Sheet>
  );
}
