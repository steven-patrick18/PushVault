import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface SubscriberRow {
  id: string;
  endpoint: string;
  status: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingUrl: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  language: string | null;
  timezone: string | null;
  pushesReceived: number;
  pushesClicked: number;
  subscribedAt: string;
}

interface ListResponse {
  rows: SubscriberRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_BADGE: Record<string, string> = {
  active: "green",
  unsubscribed: "gray",
  expired: "amber",
};

export default function Subscribers() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState("");
  const [device, setDevice] = useState("");
  const [campaign, setCampaign] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (device) params.set("device", device);
    if (campaign) params.set("utm_campaign", campaign);
    params.set("page", String(page));
    api<ListResponse>(`/subscribers?${params}`).then(setData).catch((e) => setError(e.message));
  }, [status, device, campaign, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function erase(id: string) {
    if (!confirm("Permanently delete this subscriber and their send history? (GDPR erasure)")) return;
    await api(`/subscribers/${id}`, { method: "DELETE" });
    load();
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Subscribers</div>
          <div className="page-sub">{data ? `${data.total} total` : "Loading…"}</div>
        </div>
        <button className="btn secondary" onClick={load}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="panel" style={{ display: "flex", gap: 12 }}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 160 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="expired">Expired</option>
        </select>
        <select value={device} onChange={(e) => { setDevice(e.target.value); setPage(1); }} style={{ width: 160 }}>
          <option value="">All devices</option>
          <option value="desktop">Desktop</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
        </select>
        <input
          placeholder="Filter by utm_campaign…"
          value={campaign}
          onChange={(e) => { setCampaign(e.target.value); setPage(1); }}
          style={{ width: 220 }}
        />
      </div>

      <div className="panel">
        {!data || data.rows.length === 0 ? (
          <div className="empty">
            No subscribers yet. Open the demo store and accept the prompt to create one.
          </div>
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
                  </td>
                  <td style={{ fontSize: 12 }}>{new Date(s.subscribedAt).toLocaleString()}</td>
                  <td>
                    <button className="btn secondary small" onClick={() => erase(s.id)} title="GDPR erasure">
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>
            Page {page} of {pages}
          </span>
          <button className="btn secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </>
  );
}
