import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

interface Campaign {
  id: string;
  name: string;
  title: string;
  body: string;
  iconUrl: string | null;
  imageUrl: string | null;
  clickUrl: string;
  status: string;
  scheduleAt: string | null;
  segment: { id: string; name: string } | null;
  totalTargeted: number | null;
  totalSent: number;
  totalClicked: number;
  totalFailed: number;
  totalExpiredPruned: number;
  createdAt: string;
}

interface Report {
  campaign: Campaign;
  funnel: {
    targeted: number;
    queued: number;
    sent: number;
    delivered: number;
    clicked: number;
    failed: number;
    expired: number;
  };
  ctr: number | null;
  errors: { code: string; count: number }[];
}

const STATUS_BADGE: Record<string, string> = {
  draft: "gray",
  scheduled: "purple",
  sending: "amber",
  sent: "green",
  cancelled: "gray",
  failed: "amber",
};

export default function Campaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    propertyId: "",
    name: "",
    title: "🔥 Weekend flash sale is live!",
    body: "Up to 60% off — today and tomorrow only.",
    clickUrl: "http://localhost:8080/?utm_source=push",
    iconUrl: "",
    imageUrl: "",
    segmentId: "",
    scheduleAt: "",
    pacing: "",
  });
  const [audience, setAudience] = useState<number | null>(null);

  const load = () => {
    api<Campaign[]>("/campaigns").then(setCampaigns).catch((e) => setError(e.message));
    api<{ id: string; name: string }[]>("/segments").then(setSegments);
    api<{ id: string; name: string }[]>("/properties").then((p) => {
      setProperties(p);
      setForm((f) => (f.propertyId ? f : { ...f, propertyId: p[0]?.id ?? "" }));
    });
  };
  useEffect(load, []);

  // live audience ("leads") estimate for the composer
  useEffect(() => {
    if (!showCreate) return;
    let stale = false;
    setAudience(null);
    const promise = form.segmentId
      ? api<{ count: number }>(`/segments/${form.segmentId}/count`, { method: "POST" }).then((r) => r.count)
      : api<{ total: number }>(`/subscribers?status=active&page_size=1`).then((r) => r.total);
    promise.then((n) => { if (!stale) setAudience(n); }).catch(() => {});
    return () => { stale = true; };
  }, [showCreate, form.segmentId]);

  // poll while any campaign is sending or a report modal is open
  useEffect(() => {
    const hasActive = campaigns.some((c) => c.status === "sending");
    if (!hasActive && !report) return;
    const t = setInterval(() => {
      api<Campaign[]>("/campaigns").then(setCampaigns);
      if (report) openReport(report.campaign.id, true);
    }, 2000);
    return () => clearInterval(t);
  }, [campaigns, report]);

  async function createAnd(action: "draft" | "send" | "schedule") {
    setBusy(true);
    setError("");
    try {
      const created = await api<Campaign>("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          propertyId: form.propertyId,
          name: form.name || form.title,
          title: form.title,
          body: form.body,
          clickUrl: form.clickUrl,
          iconUrl: form.iconUrl || undefined,
          imageUrl: form.imageUrl || undefined,
          segmentId: form.segmentId || undefined,
          targetAll: !form.segmentId, // composer's "All active subscribers" choice
          pacingPerMinute: form.pacing ? Number(form.pacing) : undefined,
        }),
      });
      if (action === "send") {
        await api(`/campaigns/${created.id}/send-now`, { method: "POST" });
      } else if (action === "schedule") {
        await api(`/campaigns/${created.id}/schedule`, {
          method: "POST",
          body: JSON.stringify({ schedule_at: new Date(form.scheduleAt).toISOString() }),
        });
      }
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendNow(id: string) {
    if (!confirm("Send this campaign now?")) return;
    await api(`/campaigns/${id}/send-now`, { method: "POST" });
    load();
  }

  async function cancel(id: string) {
    await api(`/campaigns/${id}/cancel`, { method: "POST" });
    load();
  }

  async function openReport(id: string, silent = false) {
    try {
      const r = await api<Report>(`/campaigns/${id}/report`);
      setReport(r);
    } catch (e: any) {
      if (!silent) setError(e.message);
    }
  }

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Campaigns</div>
          <div className="page-sub">Compose and send push campaigns</div>
        </div>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + New campaign
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="panel">
        {campaigns.length === 0 ? (
          <div className="empty">No campaigns yet — create your first one.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Segment</th>
                <th>Targeted</th>
                <th>Sent</th>
                <th>Clicked</th>
                <th>Pruned</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/campaigns/${c.id}`)}
                >
                  <td>
                    <span style={{ color: "var(--accent-hover)", fontWeight: 600 }}>{c.name}</span>
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{c.title}</div>
                  </td>
                  <td>
                    <span className={"badge " + (STATUS_BADGE[c.status] ?? "gray")}>{c.status}</span>
                    {c.status === "scheduled" && c.scheduleAt && (
                      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                        {new Date(c.scheduleAt).toLocaleString()}
                      </div>
                    )}
                    {c.status === "sending" && (
                      <div style={{ marginTop: 6, width: 120 }}>
                        <div style={{ height: 6, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${c.totalTargeted ? Math.min(((c.totalSent + c.totalFailed + c.totalExpiredPruned) / c.totalTargeted) * 100, 100) : 5}%`,
                              background: "var(--accent)",
                              transition: "width 0.5s",
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                          {c.totalSent + c.totalFailed + c.totalExpiredPruned} / {c.totalTargeted ?? "…"} blasted
                        </div>
                      </div>
                    )}
                  </td>
                  <td>{c.segment?.name ?? "All active"}</td>
                  <td>{c.totalTargeted ?? "–"}</td>
                  <td>{c.totalSent}</td>
                  <td>{c.totalClicked}</td>
                  <td>{c.totalExpiredPruned}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      {c.status === "draft" && (
                        <button className="btn small" onClick={() => sendNow(c.id)}>
                          Send
                        </button>
                      )}
                      {c.status === "scheduled" && (
                        <button className="btn secondary small" onClick={() => cancel(c.id)}>
                          Cancel
                        </button>
                      )}
                      <button className="btn secondary small" onClick={() => navigate(`/campaigns/${c.id}`)}>
                        Manage
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
          <div className="modal" style={{ width: 720, display: "flex", gap: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ flex: 1 }}>
              <h2>New campaign</h2>
              <label>Property</label>
              <select value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value })}>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label>Internal name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="(defaults to title)" />
              <label>Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <label>Body</label>
              <textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <label>Click URL</label>
              <input value={form.clickUrl} onChange={(e) => setForm({ ...form, clickUrl: e.target.value })} />
              <label>Segment</label>
              <select value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })}>
                <option value="">All active subscribers</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <span className="badge purple">
                  {audience === null ? "counting leads…" : `${audience.toLocaleString()} leads will be targeted`}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: 6 }}>
                  before frequency caps
                </span>
              </div>
              <label>Pacing (sends per minute)</label>
              <select value={form.pacing} onChange={(e) => setForm({ ...form, pacing: e.target.value })}>
                <option value="">Full speed (no pacing)</option>
                <option value="60">60 / minute</option>
                <option value="300">300 / minute</option>
                <option value="600">600 / minute</option>
                <option value="1200">1,200 / minute</option>
                <option value="3000">3,000 / minute</option>
              </select>
              {form.pacing && audience !== null && audience > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                  ≈ {Math.ceil(audience / Number(form.pacing))} min to complete the blast
                </div>
              )}
              <label>Schedule (optional)</label>
              <input type="datetime-local" value={form.scheduleAt} onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })} />
              {error && <div className="error-msg">{error}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
                <button className="btn" disabled={busy || !form.title} onClick={() => createAnd("send")}>
                  Send now
                </button>
                <button className="btn secondary" disabled={busy || !form.scheduleAt} onClick={() => createAnd("schedule")}>
                  Schedule
                </button>
                <button className="btn secondary" disabled={busy} onClick={() => createAnd("draft")}>
                  Save draft
                </button>
              </div>
            </div>
            <div style={{ width: 260 }}>
              <label>Live preview</label>
              <div style={{ background: "#f5f5f7", borderRadius: 12, padding: 14, color: "#1a1a2a" }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "#7C3AED22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {form.iconUrl ? <img src={form.iconUrl} style={{ width: 36, height: 36, borderRadius: 8 }} /> : "🔔"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{form.title || "Notification title"}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{form.body || "Notification body"}</div>
                    <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>localhost:8080 · now</div>
                  </div>
                </div>
                {form.imageUrl && <img src={form.imageUrl} style={{ width: "100%", borderRadius: 8, marginTop: 10 }} />}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>
                This is how the notification will look on Windows/Chrome.
              </div>
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="modal-backdrop" onClick={() => setReport(null)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2>{report.campaign.name}</h2>
            <div className="page-sub">
              <span className={"badge " + (STATUS_BADGE[report.campaign.status] ?? "gray")}>{report.campaign.status}</span>
              {" · "}segment: {report.campaign.segment?.name ?? "All active"}
              {report.ctr !== null && <> · CTR {report.ctr}%</>}
            </div>
            <div className="cards" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div className="card">
                <div className="label">Targeted</div>
                <div className="value">{report.funnel.targeted}</div>
              </div>
              <div className="card">
                <div className="label">Sent</div>
                <div className="value">{report.funnel.sent}</div>
                {report.funnel.queued > 0 && <div className="hint">{report.funnel.queued} still queued…</div>}
              </div>
              <div className="card">
                <div className="label">Clicked</div>
                <div className="value">{report.funnel.clicked}</div>
              </div>
              <div className="card">
                <div className="label">Failed</div>
                <div className="value">{report.funnel.failed}</div>
              </div>
              <div className="card">
                <div className="label">Expired / pruned</div>
                <div className="value">{report.funnel.expired}</div>
              </div>
              <div className="card">
                <div className="label">Delivered</div>
                <div className="value">{report.funnel.delivered}</div>
                <div className="hint">= accepted by push service</div>
              </div>
            </div>
            {report.errors.length > 0 && (
              <>
                <label>Error breakdown</label>
                <table>
                  <tbody>
                    {report.errors.map((e) => (
                      <tr key={e.code}>
                        <td>
                          <span className="commit-hash">{e.code}</span>
                        </td>
                        <td>{e.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <button className="btn" style={{ marginTop: 16 }} onClick={() => setReport(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
