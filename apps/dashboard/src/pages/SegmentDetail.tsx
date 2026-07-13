import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getUser } from "../api";

interface Condition {
  field: string;
  op: string;
  value: unknown;
}

interface Segment {
  id: string;
  name: string;
  propertyId: string;
  property: { id: string; name: string };
  criteria: { all?: Condition[]; manual_include?: string[]; manual_exclude?: string[] };
  cachedCount: number | null;
  createdAt: string;
}

interface Member {
  id: string;
  utmCampaign: string | null;
  utmSource: string | null;
  device: string | null;
  browser: string | null;
  country: string | null;
  city: string | null;
  pushesReceived: number;
  pushesClicked: number;
  lastPushAt: string | null;
  subscribedAt: string;
  manuallyAdded: boolean;
}

interface ActivityRow {
  key: string;
  label: string;
  sent: number;
  clicked: number;
  failed: number;
  expired: number;
  queued: number;
  ctr: number | null;
}

const FIELDS = [
  "subscribed_at", "last_push_at", "last_click_at", "utm_source", "utm_medium", "utm_campaign",
  "landing_url", "country", "city", "device", "browser", "os", "language", "timezone",
  "pushes_received", "pushes_clicked",
];
const OPS = ["eq", "neq", "in", "nin", "between", "gte", "lte", "contains", "older_than_days", "newer_than_days"];

function parseValue(op: string, raw: string): unknown {
  if (op === "in" || op === "nin") return raw.split(",").map((s) => s.trim());
  if (op === "between") return raw.split(",").map((s) => s.trim()).slice(0, 2);
  return raw.trim();
}
function valueToString(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : String(v ?? "");
}

export default function SegmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const readOnly = getUser()?.role === "client";
  const [segment, setSegment] = useState<Segment | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<{ field: string; op: string; value: string }[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [members, setMembers] = useState<{ rows: Member[]; total: number; manualExcludeCount: number } | null>(null);
  const [memberPage, setMemberPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [candidates, setCandidates] = useState<{ rows: any[]; total: number } | null>(null);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Segment>(`/segments/${id}`).then((s) => {
      setSegment(s);
      setName(s.name);
      setRows((s.criteria.all ?? []).map((c) => ({ field: c.field, op: c.op, value: valueToString(c.value) })));
    }).catch((e) => setError(e.message));
    api<{ count: number }>(`/segments/${id}/count`, { method: "POST" }).then((r) => setCount(r.count)).catch(() => {});
    api<ActivityRow[]>(`/segments/${id}/activity`).then(setActivity).catch(() => {});
  }, [id]);

  const loadMembers = useCallback(() => {
    api<any>(`/segments/${id}/members?page=${memberPage}`).then(setMembers).catch(() => {});
  }, [id, memberPage]);

  useEffect(load, [load]);
  useEffect(loadMembers, [loadMembers]);

  // auto-refresh activity every 15s (live blast status)
  useEffect(() => {
    const t = setInterval(() => {
      api<ActivityRow[]>(`/segments/${id}/activity`).then(setActivity).catch(() => {});
    }, 15_000);
    return () => clearInterval(t);
  }, [id]);

  async function saveCriteria() {
    setBusy(true);
    setError("");
    try {
      await api(`/segments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          criteria: {
            ...segment!.criteria,
            all: rows.filter((r) => r.value !== "").map((r) => ({ field: r.field, op: r.op, value: parseValue(r.op, r.value) })),
          },
        }),
      });
      setMsg("Saved");
      load();
      loadMembers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(subscriberId: string) {
    await api(`/segments/${id}/members/${subscriberId}`, { method: "DELETE" });
    load();
    loadMembers();
  }

  async function addMember(subscriberId: string) {
    await api(`/segments/${id}/members`, { method: "POST", body: JSON.stringify({ subscriber_id: subscriberId }) });
    load();
    loadMembers();
    loadCandidates();
  }

  const loadCandidates = useCallback(() => {
    api<any>(`/segments/${id}/candidates?search=${encodeURIComponent(search)}`).then(setCandidates).catch(() => {});
  }, [id, search]);

  useEffect(() => {
    if (showAdd) loadCandidates();
  }, [showAdd, loadCandidates]);

  async function remove() {
    if (!confirm("Delete this segment? Campaigns using it will refuse to send.")) return;
    await api(`/segments/${id}`, { method: "DELETE" });
    navigate("/segments");
  }

  if (!segment) return <div className="page-sub">{error || "Loading…"}</div>;

  const memberPages = members ? Math.max(1, Math.ceil(members.total / 25)) : 1;

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">
            <Link to="/segments" style={{ color: "var(--text-dim)" }}>Segments</Link> / {segment.name}
          </div>
          <div className="page-sub">
            {segment.property.name} · <span className="badge purple">{count === null ? "…" : `${count.toLocaleString()} leads`}</span>
          </div>
        </div>
        {!readOnly && (
          <div className="row-actions">
            <button className="btn secondary" onClick={remove}>Delete</button>
            <button className="btn" onClick={saveCriteria} disabled={busy}>Save</button>
          </div>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      {/* ---- blast activity ---- */}
      <div className="panel">
        <h3>Blast activity for these leads <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text-dim)" }}>(auto-refreshes every 15s)</span></h3>
        <table>
          <thead>
            <tr>
              <th>Window</th>
              <th>Sent</th>
              <th>Clicked</th>
              <th>CTR</th>
              <th>Failed</th>
              <th>Pruned</th>
              <th>Queued</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((w) => (
              <tr key={w.key}>
                <td><span className="commit-hash">{w.label}</span></td>
                <td>{w.sent > 0 ? <b>{w.sent}</b> : <span style={{ color: "var(--text-dim)" }}>0</span>}</td>
                <td>{w.clicked}</td>
                <td>{w.ctr === null ? "–" : `${w.ctr}%`}</td>
                <td>{w.failed}</td>
                <td>{w.expired}</td>
                <td>{w.queued > 0 ? <span className="badge amber">{w.queued}</span> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- criteria editor ---- */}
      <div className="panel">
        <h3>Filter criteria</h3>
        <fieldset disabled={readOnly} style={{ border: "none" }}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 380 }} />
          <label>Conditions (all must match)</label>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, maxWidth: 640 }}>
              <select value={r.field} style={{ width: 170 }} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                {FIELDS.map((f) => <option key={f}>{f}</option>)}
              </select>
              <select value={r.op} style={{ width: 150 }} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}>
                {OPS.map((o) => <option key={o}>{o}</option>)}
              </select>
              <input value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button type="button" className="btn secondary small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={() => setRows([...rows, { field: "device", op: "eq", value: "" }])}>
            + Add condition
          </button>
        </fieldset>
      </div>

      {/* ---- members ---- */}
      <div className="panel">
        <div className="flex-between">
          <h3>
            Leads in this segment {members && <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>({members.total.toLocaleString()})</span>}
          </h3>
          {!readOnly && (
            <button className="btn secondary small" onClick={() => setShowAdd(true)}>+ Add leads manually</button>
          )}
        </div>
        {members && members.manualExcludeCount > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>
            {members.manualExcludeCount} lead(s) manually removed from this segment.
          </div>
        )}
        {!members || members.rows.length === 0 ? (
          <div className="empty">No leads match this segment right now.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign / Source</th>
                <th>Device</th>
                <th>Location</th>
                <th>Recv / Click</th>
                <th>Last push</th>
                <th>Subscribed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.utmCampaign ?? <span style={{ color: "var(--text-dim)" }}>direct</span>}
                    {m.manuallyAdded && <span className="badge purple" style={{ marginLeft: 6 }}>manual</span>}
                    {m.utmSource && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{m.utmSource}</div>}
                  </td>
                  <td>{m.device}<div style={{ fontSize: 11, color: "var(--text-dim)" }}>{m.browser}</div></td>
                  <td>{[m.city, m.country].filter(Boolean).join(", ") || "–"}</td>
                  <td>{m.pushesReceived} / {m.pushesClicked}</td>
                  <td style={{ fontSize: 12 }}>{m.lastPushAt ? new Date(m.lastPushAt).toLocaleString() : "never"}</td>
                  <td style={{ fontSize: 12 }}>{new Date(m.subscribedAt).toLocaleDateString()}</td>
                  <td>
                    {!readOnly && (
                      <button className="btn secondary small" title="Remove from segment" onClick={() => removeMember(m.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {memberPages > 1 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <button className="btn secondary small" disabled={memberPage <= 1} onClick={() => setMemberPage(memberPage - 1)}>← Prev</button>
            <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Page {memberPage} of {memberPages}</span>
            <button className="btn secondary small" disabled={memberPage >= memberPages} onClick={() => setMemberPage(memberPage + 1)}>Next →</button>
          </div>
        )}
      </div>

      {/* ---- add leads modal ---- */}
      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
            <h2>Add leads to "{segment.name}"</h2>
            <p className="page-sub">Leads of {segment.property.name} not currently in this segment.</p>
            <input
              placeholder="Search by campaign, source, country, city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadCandidates()}
            />
            <div style={{ marginTop: 12, maxHeight: 340, overflowY: "auto" }}>
              {!candidates || candidates.rows.length === 0 ? (
                <div className="empty">No matching leads outside the segment.</div>
              ) : (
                <table>
                  <tbody>
                    {candidates.rows.map((c) => (
                      <tr key={c.id}>
                        <td>{c.utmCampaign ?? "direct"}<div style={{ fontSize: 11, color: "var(--text-dim)" }}>{c.utmSource}</div></td>
                        <td>{c.device}</td>
                        <td>{c.country ?? "–"}</td>
                        <td style={{ fontSize: 12 }}>{new Date(c.subscribedAt).toLocaleDateString()}</td>
                        <td><button className="btn small" onClick={() => addMember(c.id)}>+ Add</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {candidates && candidates.total > 25 && (
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
                Showing 25 of {candidates.total.toLocaleString()} — refine the search to find specific leads.
              </div>
            )}
            <button className="btn" style={{ marginTop: 14 }} onClick={() => setShowAdd(false)}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}
