import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getUser } from "../api";

interface Campaign {
  id: string;
  name: string;
  title: string;
  status: string;
  scheduleAt: string | null;
  recurrence: { freq: string } | null;
  segment: { id: string; name: string } | null;
  segmentIds: string[];
  targetAll: boolean;
  totalTargeted: number | null;
  totalSent: number;
  totalClicked: number;
  totalFailed: number;
  totalExpiredPruned: number;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "gray",
  scheduled: "purple",
  sending: "amber",
  paused: "amber",
  sent: "green",
  cancelled: "gray",
  failed: "amber",
};

export default function Campaigns() {
  const navigate = useNavigate();
  const canEdit = ["admin", "manager"].includes(getUser()?.role ?? "");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string; domains: string[] }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove(id: string, name: string) {
    if (!confirm(`Delete campaign "${name}" and its send history? This can't be undone.`)) return;
    try {
      await api(`/campaigns/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const load = () => {
    api<Campaign[]>("/campaigns").then(setCampaigns).catch((e) => setError(e.message));
    api<{ id: string; name: string; domains: string[] }[]>("/properties").then((p) => {
      setProperties(p);
      setPropertyId((prev) => prev || p[0]?.id || "");
    });
  };
  useEffect(load, []);

  // live refresh while anything is blasting
  useEffect(() => {
    if (!campaigns.some((c) => c.status === "sending")) return;
    const t = setInterval(() => api<Campaign[]>("/campaigns").then(setCampaigns).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [campaigns]);

  /** create a draft with sane defaults, then open the full designer */
  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const property = properties.find((p) => p.id === propertyId);
      const domain = property?.domains?.[0] ?? "example.com";
      const created = await api<Campaign>("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          name: name || "Untitled campaign",
          title: "🔥 Your title here",
          body: "Your message here.",
          clickUrl: `https://${domain.replace(/^https?:\/\//, "")}/?utm_source=push`,
        }),
      });
      navigate(`/campaigns/${created.id}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Campaigns</div>
          <div className="page-sub">Compose and send push campaigns</div>
        </div>
        {canEdit && (
          <button className="btn" onClick={() => setShowCreate(true)}>
            + New campaign
          </button>
        )}
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
                <th>Leads</th>
                <th>Targeted</th>
                <th>Sent</th>
                <th>Clicked</th>
                <th>Pruned</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const progressed = c.totalSent + c.totalFailed + c.totalExpiredPruned;
                return (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/campaigns/${c.id}`)}>
                    <td>
                      <span style={{ color: "var(--accent-hover)", fontWeight: 600 }}>{c.name}</span>
                      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{c.title}</div>
                    </td>
                    <td>
                      <span className={"badge " + (STATUS_BADGE[c.status] ?? "gray")}>{c.status}</span>
                      {c.status === "scheduled" && c.scheduleAt && (
                        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                          {new Date(c.scheduleAt).toLocaleString()}
                          {c.recurrence && <> · {c.recurrence.freq.toLowerCase()}</>}
                        </div>
                      )}
                      {c.status === "sending" && (
                        <div style={{ marginTop: 6, width: 120 }}>
                          <div style={{ height: 6, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
                            <div
                              style={{
                                height: "100%",
                                width: `${c.totalTargeted ? Math.min((progressed / c.totalTargeted) * 100, 100) : 5}%`,
                                background: "var(--accent)",
                                transition: "width 0.5s",
                              }}
                            />
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                            {progressed} / {c.totalTargeted ?? "…"} blasted
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {c.targetAll ? "All active" : c.segmentIds?.length ? `${c.segmentIds.length} segment${c.segmentIds.length > 1 ? "s" : ""}` : c.segment?.name ?? <span className="badge amber">none</span>}
                    </td>
                    <td>{c.totalTargeted ?? "–"}</td>
                    <td>{c.totalSent}</td>
                    <td>{c.totalClicked}</td>
                    <td>{c.totalExpiredPruned}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="btn secondary small" onClick={() => navigate(`/campaigns/${c.id}`)}>
                          {c.status === "draft" && canEdit ? "✎ Design" : "Manage"}
                        </button>
                        {canEdit && c.status !== "sending" && (
                          <button className="btn secondary small" title="Delete campaign" onClick={() => remove(c.id, c.name)}>
                            🗑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={createDraft}>
            <h2>New campaign</h2>
            <p className="page-sub">
              A draft opens in the full designer — content, device previews, click-to-call buttons,
              A/B test, lead mixing and pacing all live there.
            </p>
            <label>Property</label>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label>Internal name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend flash sale" autoFocus />
            {error && <div className="error-msg">{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn" disabled={busy || !propertyId}>
                {busy ? "Creating…" : "Create & open designer →"}
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
