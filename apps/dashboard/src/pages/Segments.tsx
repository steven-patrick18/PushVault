import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

interface Segment {
  id: string;
  propertyId: string;
  name: string;
  criteria: { all: Condition[] };
  cachedCount: number | null;
  cachedAt: string | null;
  createdAt: string;
}

interface Condition {
  field: string;
  op: string;
  value: unknown;
}

interface Property {
  id: string;
  name: string;
}

const FIELDS = [
  "subscribed_at",
  "last_push_at",
  "last_click_at",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "landing_url",
  "country",
  "city",
  "device",
  "browser",
  "os",
  "language",
  "timezone",
  "pushes_received",
  "pushes_clicked",
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

export default function Segments() {
  const navigate = useNavigate();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [rows, setRows] = useState<{ field: string; op: string; value: string }[]>([
    { field: "utm_campaign", op: "eq", value: "" },
  ]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<Segment[]>("/segments").then(setSegments).catch((e) => setError(e.message));
    api<Property[]>("/properties").then((p) => {
      setProperties(p);
      if (p.length && !propertyId) setPropertyId(p[0].id);
    });
  };
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId) {
      setError("Pick a property first");
      return;
    }
    // block conditions with a blank value instead of silently dropping them
    // (a dropped condition would make the segment match everyone/nobody)
    const blank = rows.findIndex((r) => r.value.trim() === "");
    if (blank !== -1) {
      setError(`Condition ${blank + 1} has no value — fill it in or remove it`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/segments", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          name,
          criteria: { all: rows.map((r) => ({ field: r.field, op: r.op, value: parseValue(r.op, r.value) })) },
        }),
      });
      setShowCreate(false);
      setName("");
      setRows([{ field: "utm_campaign", op: "eq", value: "" }]);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function count(id: string) {
    try {
      const res = await api<{ count: number }>(`/segments/${id}/count`, { method: "POST" });
      setCounts((c) => ({ ...c, [id]: res.count }));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this segment?")) return;
    try {
      await api(`/segments/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Segments</div>
          <div className="page-sub">Saved audience filters, evaluated live at send time</div>
        </div>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + New segment
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="panel">
        {segments.length === 0 ? (
          <div className="empty">No segments yet. A campaign without a segment targets all active subscribers.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Criteria</th>
                <th>Audience</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/segments/${s.id}`)}>
                  <td>
                    <span style={{ color: "var(--accent-hover)", fontWeight: 600 }}>{s.name}</span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {(s.criteria?.all ?? []).map((c, i) => (
                      <div key={i}>
                        <span className="commit-hash">{c.field}</span> {c.op} {valueToString(c.value)}
                      </div>
                    ))}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {counts[s.id] ?? s.cachedCount ?? "–"}
                    <button className="btn secondary small" style={{ marginLeft: 8 }} onClick={() => count(s.id)}>
                      Count
                    </button>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => navigate(`/segments/${s.id}`)}>
                        Manage
                      </button>
                      <button className="btn secondary small" onClick={() => remove(s.id)}>
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()} onSubmit={create}>
            <h2>New segment</h2>
            <label>Property</label>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer sale mobile users" autoFocus />
            <label>Conditions (all must match)</label>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <select value={r.field} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} style={{ width: 170 }}>
                  {FIELDS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <select value={r.op} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))} style={{ width: 150 }}>
                  {OPS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <input
                  value={r.value}
                  placeholder={r.op === "between" ? "min, max" : r.op === "in" || r.op === "nin" ? "a, b, c" : "value"}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <button type="button" className="btn secondary small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn secondary small" onClick={() => setRows([...rows, { field: "device", op: "eq", value: "" }])}>
              + Add condition
            </button>
            {error && <div className="error-msg">{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn" disabled={busy || !name}>
                {busy ? "Creating…" : "Create segment"}
              </button>
              <button type="button" className="btn secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
