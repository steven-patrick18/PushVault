import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "../api";

interface SubscriberRow {
  id: string;
  endpoint: string;
  status: string;
  statusAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  language: string | null;
  timezone: string | null;
  pushesReceived: number;
  pushesClicked: number;
  lastPushAt: string | null;
  subscribedAt: string;
}

interface ListResponse {
  rows: SubscriberRow[];
  total: number;
  totals: { active: number; unsubscribed: number; expired: number };
  page: number;
  pageSize: number;
}

interface Facet {
  value: string;
  count: number;
}
interface Facets {
  countries: Facet[];
  browsers: Facet[];
  oses: Facet[];
  languages: Facet[];
  timezones: Facet[];
  campaigns: Facet[];
}

const STATUS_BADGE: Record<string, string> = {
  active: "green",
  unsubscribed: "gray",
  expired: "amber",
};

const EMPTY_FILTERS = {
  status: "",
  device: "",
  country: "",
  browser: "",
  os: "",
  language: "",
  utm_campaign: "",
  utm_source: "",
  from: "",
  to: "",
  fresh: "",
};

interface AutoAssignRule {
  segmentId: string;
  weight: number;
}
interface AutoAssign {
  status: "active" | "paused" | "stopped";
  rules: AutoAssignRule[];
  counts?: Record<string, number>;
}

export default function Subscribers() {
  const readOnly = getUser()?.role === "client";
  const [data, setData] = useState<ListResponse | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [auto, setAuto] = useState<AutoAssign | null>(null);
  const [autoRules, setAutoRules] = useState<{ segmentId: string; weight: string }[]>([]);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(1);
  const [assignSegment, setAssignSegment] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    return params;
  }, [filters]);

  const load = useCallback(() => {
    const params = filterParams();
    params.set("page", String(page));
    api<ListResponse>(`/subscribers?${params}`).then(setData).catch((e) => setError(e.message));
  }, [filterParams, page]);

  useEffect(load, [load]);
  useEffect(() => {
    api<Facets>("/subscribers/facets").then(setFacets).catch(() => {});
    api<{ id: string; name: string }[]>("/segments").then(setSegments).catch(() => {});
    api<{ id: string }[]>("/properties").then((p) => {
      if (p[0]) {
        setPropertyId(p[0].id);
        api<AutoAssign>(`/properties/${p[0].id}/auto-assign`).then((a) => {
          setAuto(a);
          setAutoRules((a.rules ?? []).map((r) => ({ segmentId: r.segmentId, weight: String(r.weight) })));
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  async function saveAutoAssign(status: "active" | "paused") {
    const rules = autoRules
      .filter((r) => r.segmentId && Number(r.weight) > 0)
      .map((r) => ({ segmentId: r.segmentId, weight: Number(r.weight) }));
    if (status === "active" && rules.length === 0) {
      setError("Add at least one segment with a weight to activate auto-assign");
      return;
    }
    try {
      const res = await api<AutoAssign>(`/properties/${propertyId}/auto-assign`, {
        method: "PUT",
        body: JSON.stringify({ status, rules }),
      });
      setAuto(res);
      setMsg(status === "active" ? "Auto-assign is running — every new lead will be distributed" : "Auto-assign paused");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function stopAutoAssign() {
    if (!confirm("Stop and remove the auto-assign rule?")) return;
    try {
      await api(`/properties/${propertyId}/auto-assign`, { method: "PUT", body: "null" });
      setAuto({ status: "stopped", rules: [], counts: {} });
      setAutoRules([]);
      setMsg("Auto-assign stopped");
    } catch (e: any) {
      setError(e.message);
    }
  }

  function setFilter(key: keyof typeof EMPTY_FILTERS, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  async function assignFiltered() {
    if (!assignSegment) return;
    const segName = segments.find((s) => s.id === assignSegment)?.name;
    if (
      !confirm(
        `Assign ALL ${data?.total.toLocaleString()} filtered leads to "${segName}"?\n\nA lead belongs to ONE segment at a time — these leads will be removed from every other segment.`,
      )
    )
      return;
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(filters)) if (v) f[k] = v;
      const res = await api<{ assigned: number; evictedFromOtherSegments: number }>(
        `/segments/${assignSegment}/assign-filtered`,
        { method: "POST", body: JSON.stringify({ filters: f }) },
      );
      setMsg(
        `${res.assigned.toLocaleString()} leads assigned to "${segName}"` +
          (res.evictedFromOtherSegments > 0
            ? ` (removed from ${res.evictedFromOtherSegments} other segment${res.evictedFromOtherSegments > 1 ? "s" : ""})`
            : ""),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function erase(id: string) {
    if (!confirm("Permanently delete this lead and their send history? (GDPR erasure)")) return;
    try {
      await api(`/subscribers/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const grandTotal = data ? data.totals.active + data.totals.unsubscribed + data.totals.expired : 0;

  const facetSelect = (
    label: string,
    key: keyof typeof EMPTY_FILTERS,
    options: Facet[] | undefined,
    width = 150,
  ) => (
    <div>
      <label style={{ margin: "0 0 4px" }}>{label}</label>
      <select value={filters[key]} style={{ width }} onChange={(e) => setFilter(key, e.target.value)}>
        <option value="">All</option>
        {(options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} ({o.count})
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Subscribers</div>
          <div className="page-sub">{data ? `${data.total.toLocaleString()} matching leads` : "Loading…"}</div>
        </div>
        <button className="btn secondary" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      {/* status totals — click to filter */}
      {data && (
        <div className="cards" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {([
            ["", "All leads", grandTotal, "purple"],
            ["active", "Active", data.totals.active, "green"],
            ["unsubscribed", "Unsubscribed", data.totals.unsubscribed, "gray"],
            ["expired", "Expired", data.totals.expired, "amber"],
          ] as const).map(([key, label, value]) => (
            <div
              key={label}
              className="card"
              style={{
                cursor: "pointer",
                borderColor: filters.status === key && (key !== "" || filters.status === "") && filters.status === key ? "var(--accent)" : undefined,
                outline: filters.status === key ? "1px solid var(--accent)" : undefined,
              }}
              onClick={() => setFilter("status", key)}
            >
              <div className="label">{label}</div>
              <div className="value">{value.toLocaleString()}</div>
              <div className="hint">
                {key === "" ? "click to clear status filter" : `click to show only ${label.toLowerCase()}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* filter bar */}
      <div className="panel">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ margin: "0 0 4px" }}>Freshness</label>
            <select value={filters.fresh} style={{ width: 170 }} onChange={(e) => setFilter("fresh", e.target.value)}>
              <option value="">All</option>
              <option value="yes">🌱 Fresh — never pushed</option>
              <option value="no">Contacted before</option>
            </select>
          </div>
          <div>
            <label style={{ margin: "0 0 4px" }}>Device</label>
            <select value={filters.device} style={{ width: 130 }} onChange={(e) => setFilter("device", e.target.value)}>
              <option value="">All</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
              <option value="tablet">Tablet</option>
            </select>
          </div>
          {facetSelect("Country", "country", facets?.countries, 120)}
          {facetSelect("Browser", "browser", facets?.browsers, 130)}
          {facetSelect("OS", "os", facets?.oses, 130)}
          {facetSelect("Language", "language", facets?.languages, 120)}
          <div>
            <label style={{ margin: "0 0 4px" }}>Campaign</label>
            <input style={{ width: 150 }} placeholder="contains…" value={filters.utm_campaign} onChange={(e) => setFilter("utm_campaign", e.target.value)} />
          </div>
          <div>
            <label style={{ margin: "0 0 4px" }}>Source</label>
            <input style={{ width: 120 }} placeholder="contains…" value={filters.utm_source} onChange={(e) => setFilter("utm_source", e.target.value)} />
          </div>
          <div>
            <label style={{ margin: "0 0 4px" }}>Subscribed from</label>
            <input type="date" style={{ width: 150 }} value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
          </div>
          <div>
            <label style={{ margin: "0 0 4px" }}>to</label>
            <input type="date" style={{ width: 150 }} value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
          </div>
          {activeFilterCount > 0 && (
            <button className="btn secondary small" onClick={() => { setFilters({ ...EMPTY_FILTERS }); setPage(1); }}>
              ✕ Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
            </button>
          )}
        </div>

        {/* assign filtered to segment */}
        {!readOnly && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <button
              className={"btn small " + (filters.fresh === "yes" && filters.status === "active" ? "" : "secondary")}
              onClick={() => { setFilters({ ...EMPTY_FILTERS, status: "active", fresh: "yes" }); setPage(1); }}
              title="Active leads that never received a push"
            >
              🌱 Select fresh leads
            </button>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
              Assign the {data?.total.toLocaleString() ?? "…"} filtered leads to:
            </span>
            <select value={assignSegment} style={{ width: 220 }} onChange={(e) => setAssignSegment(e.target.value)}>
              <option value="">Choose segment…</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className="btn small" disabled={!assignSegment || busy || !data?.total} onClick={assignFiltered}>
              {busy ? "Assigning…" : "→ Assign to segment"}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              exclusive: a lead lives in one segment at a time
            </span>
          </div>
        )}
      </div>

      {/* auto-assign new leads */}
      {!readOnly && (
        <div className="panel">
          <div className="flex-between">
            <h3>
              🔁 Auto-assign new leads{" "}
              {auto && (
                <span className={"badge " + (auto.status === "active" ? "green" : auto.status === "paused" ? "amber" : "gray")}>
                  {auto.status === "active" ? "running" : auto.status}
                </span>
              )}
            </h3>
            <div className="row-actions">
              {auto?.status === "active" ? (
                <button className="btn secondary small" onClick={() => saveAutoAssign("paused")}>⏸ Pause</button>
              ) : (
                <button className="btn small" onClick={() => saveAutoAssign("active")}>▶ {auto?.status === "paused" ? "Resume" : "Activate"}</button>
              )}
              {auto && auto.status !== "stopped" && auto.rules?.length > 0 && (
                <button className="btn secondary small" onClick={stopAutoAssign}>✕ Stop &amp; remove</button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
            Every NEW subscriber is automatically placed into one of these segments (exclusive) using the
            ratio below — e.g. weights 2 : 1 send two leads to the first segment for every one to the second.
          </div>
          {autoRules.map((r, i) => {
            const totalWeight = autoRules.reduce((s, x) => s + (Number(x.weight) || 0), 0);
            const share = totalWeight > 0 && Number(r.weight) > 0 ? Math.round((Number(r.weight) / totalWeight) * 100) : 0;
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <select value={r.segmentId} style={{ width: 220 }}
                  onChange={(e) => setAutoRules(autoRules.map((x, j) => (j === i ? { ...x, segmentId: e.target.value } : x)))}>
                  <option value="">Choose segment…</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>weight</span>
                <input type="number" min={1} style={{ width: 80 }} value={r.weight}
                  onChange={(e) => setAutoRules(autoRules.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
                <span className="badge purple">{share}%</span>
                {auto?.counts?.[r.segmentId] !== undefined && (
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {auto.counts[r.segmentId]} assigned so far
                  </span>
                )}
                <button className="btn secondary small" onClick={() => setAutoRules(autoRules.filter((_, j) => j !== i))}>✕</button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn secondary small" onClick={() => setAutoRules([...autoRules, { segmentId: "", weight: "1" }])}>
              + Add segment to distribution
            </button>
            {autoRules.length > 0 && auto?.status === "active" && (
              <button className="btn secondary small" onClick={() => saveAutoAssign("active")}>Save changes</button>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        {!data || data.rows.length === 0 ? (
          <div className="empty">No leads match these filters.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Campaign / Source</th>
                <th>Location</th>
                <th>Device</th>
                <th>TZ / Lang</th>
                <th>Recv / Click</th>
                <th>Subscribed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className={"badge " + (STATUS_BADGE[s.status] ?? "gray")}>{s.status}</span>
                    <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 3 }}>
                      {s.status === "active" && `since ${new Date(s.subscribedAt).toLocaleDateString()}`}
                      {s.status === "unsubscribed" && (s.statusAt ? `on ${new Date(s.statusAt).toLocaleString()}` : "")}
                      {s.status === "expired" && (s.statusAt ? `detected ${new Date(s.statusAt).toLocaleString()}` : "dead token")}
                    </div>
                  </td>
                  <td>
                    {s.utmCampaign ?? <span style={{ color: "var(--text-dim)" }}>direct</span>}
                    {s.utmSource && (
                      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                        {s.utmSource} / {s.utmMedium}
                      </div>
                    )}
                  </td>
                  <td>{[s.city, s.country].filter(Boolean).join(", ") || "–"}</td>
                  <td>
                    {s.device}
                    <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                      {s.browser} · {s.os}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {s.timezone ?? "–"}
                    <div style={{ color: "var(--text-dim)" }}>{s.language ?? ""}</div>
                  </td>
                  <td>
                    {s.pushesReceived} / {s.pushesClicked}
                    {s.lastPushAt && (
                      <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
                        last {new Date(s.lastPushAt).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{new Date(s.subscribedAt).toLocaleString()}</td>
                  <td>
                    {!readOnly && (
                      <button className="btn secondary small" onClick={() => erase(s.id)} title="GDPR erasure">
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Page {page} of {pages}</span>
          <button className="btn secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </>
  );
}
