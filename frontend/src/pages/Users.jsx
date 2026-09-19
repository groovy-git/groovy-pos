import { useEffect, useState } from "react";
import { Plus, UserCog } from "lucide-react";
import { useApp } from "../store";
import { api } from "../lib/api";
import { runBusy } from "../lib/busy";
import { ROLE_LABEL } from "../lib/format";
import TopBar from "../components/TopBar";
import { Avatar, Button, Empty, Field, Seg, Sheet, SkeletonList, useConfirm } from "../components/ui";

export default function UsersPage() {
  const { toast, user, setSellers, branches, multiBranch } = useApp();
  const branchName = (id) => (branches.find((b) => b.id === id) || {}).name || "";
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);

  const load = () =>
    api("listUsers")
      .then((r) => {
        setList(r.data);
        setSellers(r.data.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role })));
      })
      .catch((e) => toast(e.message, "error"));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <TopBar title="Staff" back="more" />
      <div className="page">
        <p className="small muted" style={{ marginTop: 0 }}>
          Everyone can sell. Managers also handle stock, returns, expenses and reports. Only admins manage staff and settings.
        </p>
        {!list ? (
          <SkeletonList />
        ) : list.length === 0 ? (
          <Empty icon={UserCog} title="No staff" />
        ) : (
          <div className="list">
            {list.map((u) => (
              <button key={u.id} className="list-item" onClick={() => setEdit(u)} style={u.active ? null : { opacity: 0.55 }}>
                <Avatar name={u.name} gold={u.role === "admin"} />
                <div className="grow">
                  <div className="title">
                    {u.name} {u.id === user.id && <span className="muted small">(you)</span>}
                  </div>
                  <div className="sub ellipsis">
                    {u.email}
                    {multiBranch && u.role !== "admin" && u.branch_id ? " · " + branchName(u.branch_id) : ""}
                  </div>
                </div>
                <span className={"badge " + (u.active ? (u.role === "admin" ? "dark" : u.role === "manager" ? "gold" : "") : "bad")}>
                  {u.active ? ROLE_LABEL[u.role] : "Inactive"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="fab" onClick={() => setEdit({ name: "", email: "", phone: "", role: "salesman", branch_id: branches[0] ? branches[0].id : 0, works_at: [] })}>
        <Plus size={20} /> Add staff
      </button>
      <UserSheet
        u={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          load();
        }}
      />
    </>
  );
}

function UserSheet({ u, onClose, onSaved }) {
  const { toast, user, branches, multiBranch } = useApp();
  const [f, setF] = useState(u || {});
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmNode] = useConfirm();
  useEffect(() => {
    // staff added before branches existed have no home branch yet → default to the first one
    setF(u ? { ...u, branch_id: u.branch_id || (branches[0] || {}).id, works_at: u.works_at || [] } : {});
    setPwd("");
  }, [u]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!u) return null;
  const self = u.id === user.id;

  const run = async (action, payload, msg) => {
    setBusy(true);
    try {
      const r = await runBusy(action === "deleteUser" ? "Deleting staff…" : "Saving staff…", () => api(action, payload));
      toast(msg || r.message, "success");
      onSaved();
    } catch (e) {
      toast(e.message, "error", 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={u.id ? "Edit staff" : "Add staff"}
      footer={
        <Button
          className="block big"
          loading={busy}
          onClick={() => run("saveUser", { ...f, password: pwd || undefined, branch_ids: (f.works_at || []).length ? f.works_at : [] })}
        >
          Save
        </Button>
      }
    >
      <Field label="Name">
        <input className="input" value={f.name || ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoCapitalize="words" />
      </Field>
      <Field label="Email (used to log in)">
        <input className="input" type="email" inputMode="email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Mobile">
        <input className="input" type="tel" inputMode="numeric" value={f.phone || ""} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Field>
      <div className="field">
        <label>Role</label>
        <Seg
          value={f.role}
          onChange={(r) => !self && setF({ ...f, role: r })}
          options={[
            { value: "salesman", label: "Salesman" },
            { value: "manager", label: "Manager" },
            { value: "admin", label: "Admin" },
          ]}
        />
      </div>
      {multiBranch && f.role !== "admin" && (
        <>
          <Field label="Home branch" hint="Where the app opens after login">
            <select className="input" value={f.branch_id || ""} onChange={(e) => setF({ ...f, branch_id: Number(e.target.value) })}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <label>Works at (can switch to)</label>
            <label className="row small" style={{ minHeight: 36 }}>
              <input
                type="checkbox"
                checked={!(f.works_at || []).length}
                onChange={(e) => setF({ ...f, works_at: e.target.checked ? [] : [f.branch_id || branches[0].id] })}
                style={{ width: 20, height: 20, accentColor: "var(--brown)" }}
              />
              All branches
            </label>
            {(f.works_at || []).length > 0 &&
              branches.map((b) => (
                <label key={b.id} className="row small" style={{ minHeight: 36, paddingLeft: 26 }}>
                  <input
                    type="checkbox"
                    checked={f.works_at.includes(b.id) || b.id === f.branch_id}
                    disabled={b.id === f.branch_id}
                    onChange={(e) =>
                      setF({ ...f, works_at: e.target.checked ? [...f.works_at, b.id] : f.works_at.filter((x) => x !== b.id) })
                    }
                    style={{ width: 20, height: 20, accentColor: "var(--brown)" }}
                  />
                  {b.name} {b.id === f.branch_id && <span className="muted">(home)</span>}
                </label>
              ))}
          </div>
        </>
      )}
      <Field label={u.id ? "New password (leave empty to keep)" : "Password"} hint="At least 6 characters. Share it with the staff member privately.">
        <input className="input" type="text" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
      </Field>
      {u.id && !self && (
        <div className="grid-2 mt">
          <button className="btn secondary" disabled={busy} onClick={() => run("toggleUser", { id: u.id })}>
            {u.active ? "Deactivate" : "Activate"}
          </button>
          <button
            className="btn danger"
            disabled={busy || u.has_sales}
            onClick={async () => (await confirm({ title: `Delete ${u.name}?`, text: "This cannot be undone.", okText: "Delete", danger: true })) && run("deleteUser", { id: u.id })}
          >
            Delete
          </button>
        </div>
      )}
      {u.has_sales && <div className="tiny muted mt">Has sales — deactivate instead of deleting so their sales history stays.</div>}
      {confirmNode}
    </Sheet>
  );
}
