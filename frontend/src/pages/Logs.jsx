import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useApp } from "../store";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import TopBar from "../components/TopBar";
import { Empty, SearchBar, SkeletonList } from "../components/ui";

export default function Logs() {
  const { toast } = useApp();
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api("listLogs", { q, limit: 300 })
          .then((r) => setList(r.data))
          .catch((e) => {
            toast(e.message, "error");
            setList([]);
          }),
      q ? 350 : 0,
    );
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <TopBar title="Activity log" back="more" />
      <div className="page">
        <SearchBar value={q} onChange={setQ} placeholder="Search name, action, bill no" />
        {!list ? (
          <div className="mt"><SkeletonList /></div>
        ) : list.length === 0 ? (
          <Empty icon={History} title="Nothing found" />
        ) : (
          <div className="list mt">
            {list.map((l) => (
              <div key={l.id} className="list-item" style={{ cursor: "default" }}>
                <div className="grow">
                  <div className="title small">
                    <span className="badge">{l.action}</span> {l.details || l.entity}
                  </div>
                  <div className="sub">
                    {l.user_name} · {fmtDateTime(l.at)} · {l.entity}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
