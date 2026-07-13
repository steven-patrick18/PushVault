import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

interface Campaign {
  id: string;
  propertyId: string;
  name: string;
  title: string;
  body: string;
  iconUrl: string | null;
  imageUrl: string | null;
  clickUrl: string;
  status: string;
  scheduleAt: string | null;
  pacingPerMinute: number | null;
  segment: { id: string; name: string } | null;
  totalTargeted: number | null;
  totalSent: number;
  totalClicked: number;
  totalFailed: number;
  totalExpiredPruned: number;
  createdAt: string;
}

interface Report {
  funnel: { targeted: number; queued: number; sent: number; delivered: number; clicked: number; failed: number; expired: number };
  ctr: number | null;
  errors: { code: string; count: number }[];
}

const STATUS_BADGE: Record<string, string> = {
  draft: "gray", scheduled: "purple", sending: "amber", sent: "green", cancelled: "gray", failed: "amber",
};

type Platform = "windows" | "android" | "mac" | "ios";

/** Stylized mockups of how the push popup renders on each OS. */
function PlatformPreview({ platform, title, body, icon, image, domain }: {
  platform: Platform; title: string; body: string; icon: string | null; image: string | null; domain: string;
}) {
  const iconEl = (size: number, radius = 8) =>
    icon ? (
      <img src={icon} style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0 }} />
    ) : (
      <div style={{ width: size, height: size, borderRadius: radius, background: "#7C3AED33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, flexShrink: 0 }}>🔔</div>
    );

  if (platform === "windows") {
    return (
      <div>
        <div style={{ background: "#1f1f1f", color: "#fff", borderRadius: 8, padding: 16, width: 330, boxShadow: "0 8px 30px rgba(0,0,0,.5)" }}>
          <div style={{ display: "flex", gap: 12 }}>
            {iconEl(44, 6)}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
              <div style={{ fontSize: 13, color: "#c8c8c8", marginTop: 2 }}>{body}</div>
              <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 6 }}>Google Chrome · {domain}</div>
            </div>
          </div>
          {image && <img src={image} style={{ width: "100%", borderRadius: 6, marginTop: 12 }} />}
        </div>
        <div className="preview-note">Windows 10/11 toast (Chrome/Edge). Big image + up to 2 action buttons supported.</div>
      </div>
    );
  }
  if (platform === "android") {
    return (
      <div>
        <div style={{ background: "#fff", color: "#1a1a1a", borderRadius: 24, padding: "14px 16px", width: 330, boxShadow: "0 6px 24px rgba(0,0,0,.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5f6368" }}>
            {iconEl(16, 4)}
            <span>Chrome · {domain} · now</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, marginTop: 6 }}>{title}</div>
          <div style={{ fontSize: 13, color: "#5f6368" }}>{body}</div>
          {image && <img src={image} style={{ width: "100%", borderRadius: 12, marginTop: 10 }} />}
        </div>
        <div className="preview-note">Android notification shade (Chrome). Big image shown when expanded.</div>
      </div>
    );
  }
  if (platform === "mac") {
    return (
      <div>
        <div style={{ background: "rgba(245,245,247,.98)", color: "#1a1a1a", borderRadius: 14, padding: "12px 14px", width: 330, boxShadow: "0 6px 24px rgba(0,0,0,.3)", display: "flex", gap: 12, alignItems: "center" }}>
          {iconEl(38, 8)}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
            <div style={{ fontSize: 12.5, color: "#555" }}>{body}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{domain}</div>
          </div>
        </div>
        <div className="preview-note">macOS banner (top-right). Chrome/Safari — big image not displayed, keep title ≤ 40 chars.</div>
      </div>
    );
  }
  // ios
  return (
    <div>
      <div style={{ background: "rgba(250,250,252,.95)", color: "#1a1a1a", borderRadius: 20, padding: "12px 14px", width: 330, boxShadow: "0 6px 24px rgba(0,0,0,.3)", display: "flex", gap: 12, alignItems: "center" }}>
        {iconEl(40, 10)}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
            <span style={{ fontSize: 11, color: "#999" }}>now</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#555" }}>{body}</div>
        </div>
      </div>
      <div className="preview-note">
        iOS 16.4+ lock screen. Web push works only after the visitor adds the site to their Home Screen; images &amp; action buttons are not shown — the title/body must carry the message.
      </div>
    </div>
  );
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [audience, setAudience] = useState<number | null>(null);
  const [platform, setPlatform] = useState<Platform>("windows");
  const [form, setForm] = useState({ name: "", title: "", body: "", clickUrl: "", iconUrl: "", imageUrl: "", segmentId: "", pacing: "", scheduleAt: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const editable = campaign ? ["draft", "scheduled"].includes(campaign.status) : false;

  const load = useCallback(() => {
    api<Campaign>(`/campaigns/${id}`).then((c) => {
      setCampaign(c);
      setForm({
        name: c.name, title: c.title, body: c.body, clickUrl: c.clickUrl,
        iconUrl: c.iconUrl ?? "", imageUrl: c.imageUrl ?? "",
        segmentId: c.segment?.id ?? "", pacing: c.pacingPerMinute ? String(c.pacingPerMinute) : "",
        scheduleAt: "",
      });
      if (c.status !== "draft") {
        api<Report>(`/campaigns/${id}/report`).then(setReport).catch(() => {});
      }
    }).catch((e) => setError(e.message));
    api<{ id: string; name: string }[]>("/segments").then(setSegments).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  // poll while sending
  useEffect(() => {
    if (campaign?.status !== "sending") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [campaign?.status, load]);

  // live leads count for the assigned segment
  useEffect(() => {
    let stale = false;
    setAudience(null);
    const promise = form.segmentId
      ? api<{ count: number }>(`/segments/${form.segmentId}/count`, { method: "POST" }).then((r) => r.count)
      : api<{ total: number }>(`/subscribers?status=active&page_size=1`).then((r) => r.total);
    promise.then((n) => { if (!stale) setAudience(n); }).catch(() => {});
    return () => { stale = true; };
  }, [form.segmentId]);

  async function save(): Promise<boolean> {
    setBusy(true); setMsg(""); setError("");
    try {
      await api(`/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name, title: form.title, body: form.body, clickUrl: form.clickUrl,
          iconUrl: form.iconUrl || undefined, imageUrl: form.imageUrl || undefined,
          segmentId: form.segmentId || null,
          pacingPerMinute: form.pacing ? Number(form.pacing) : null,
        }),
      });
      setMsg("Saved");
      load();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    if (!(await save())) return;
    if (!confirm(`Blast to ${audience ?? "?"} leads now?`)) return;
    await api(`/campaigns/${id}/send-now`, { method: "POST" });
    load();
  }

  async function schedule() {
    if (!form.scheduleAt) { setError("Pick a schedule time first"); return; }
    if (!(await save())) return;
    await api(`/campaigns/${id}/schedule`, {
      method: "POST",
      body: JSON.stringify({ schedule_at: new Date(form.scheduleAt).toISOString() }),
    });
    load();
  }

  async function cancelSchedule() {
    await api(`/campaigns/${id}/cancel`, { method: "POST" });
    load();
  }

  async function duplicate() {
    const created = await api<Campaign>("/campaigns", {
      method: "POST",
      body: JSON.stringify({
        propertyId: campaign!.propertyId,
        name: form.name + " (copy)",
        title: form.title, body: form.body, clickUrl: form.clickUrl,
        iconUrl: form.iconUrl || undefined, imageUrl: form.imageUrl || undefined,
        segmentId: form.segmentId || undefined,
        pacingPerMinute: form.pacing ? Number(form.pacing) : undefined,
      }),
    });
    navigate(`/campaigns/${created.id}`);
  }

  if (!campaign) return <div className="page-sub">{error || "Loading…"}</div>;

  const domain = (() => { try { return new URL(form.clickUrl).host; } catch { return "yoursite.com"; } })();

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">
            <Link to="/campaigns" style={{ color: "var(--text-dim)" }}>Campaigns</Link> / {campaign.name}
          </div>
          <div className="page-sub">
            <span className={"badge " + (STATUS_BADGE[campaign.status] ?? "gray")}>{campaign.status}</span>
            {campaign.status === "scheduled" && campaign.scheduleAt && (
              <> · fires {new Date(campaign.scheduleAt).toLocaleString()}</>
            )}
            {" · "}created {new Date(campaign.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="row-actions">
          {editable && (
            <>
              <button className="btn secondary" onClick={() => save()} disabled={busy}>Save</button>
              {campaign.status === "scheduled" ? (
                <button className="btn secondary" onClick={cancelSchedule}>Cancel schedule</button>
              ) : (
                <button className="btn secondary" onClick={schedule} disabled={busy || !form.scheduleAt}>Schedule</button>
              )}
              <button className="btn" onClick={sendNow} disabled={busy}>Send now</button>
            </>
          )}
          {!editable && (
            <button className="btn" onClick={duplicate}>Duplicate as draft</button>
          )}
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}
      {!editable && campaign.status !== "sending" && (
        <div className="page-sub">This campaign has been {campaign.status} — content is locked. Duplicate it to edit and re-blast.</div>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* ---- content ---- */}
        <div className="panel" style={{ flex: 1, minWidth: 340 }}>
          <h3>Content</h3>
          <fieldset disabled={!editable} style={{ border: "none" }}>
            <label>Internal name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label>Body</label>
            <textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <label>Click URL (where the tap lands)</label>
            <input value={form.clickUrl} onChange={(e) => setForm({ ...form, clickUrl: e.target.value })} />
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>Icon URL</label>
                <input value={form.iconUrl} placeholder="https://… (square, ≥192px)" onChange={(e) => setForm({ ...form, iconUrl: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Big image URL</label>
                <input value={form.imageUrl} placeholder="https://… (2:1, Win/Android only)" onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
              </div>
            </div>

            <h3 style={{ marginTop: 22 }}>Targeting &amp; pacing</h3>
            <label>Leads (segment)</label>
            <select value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })}>
              <option value="">All active subscribers (no segment)</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div style={{ marginTop: 8 }}>
              <span className="badge purple">
                {audience === null ? "counting…" : `${audience.toLocaleString()} leads`}
              </span>
              {form.segmentId && editable && (
                <button type="button" className="btn secondary small" style={{ marginLeft: 8 }} onClick={() => setForm({ ...form, segmentId: "" })}>
                  Unassign segment
                </button>
              )}
            </div>
            <label>Pacing</label>
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
            {editable && campaign.status !== "scheduled" && (
              <>
                <label>Schedule for later (optional)</label>
                <input type="datetime-local" value={form.scheduleAt} onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })} />
              </>
            )}
          </fieldset>
        </div>

        {/* ---- platform previews ---- */}
        <div className="panel" style={{ width: 400 }}>
          <h3>Popup preview per platform</h3>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {(["windows", "android", "mac", "ios"] as Platform[]).map((p) => (
              <button
                key={p}
                className={"btn small " + (platform === p ? "" : "secondary")}
                onClick={() => setPlatform(p)}
              >
                {p === "windows" ? "🪟 Windows" : p === "android" ? "🤖 Android" : p === "mac" ? "🍎 macOS" : "📱 iOS"}
              </button>
            ))}
          </div>
          <div style={{ background: "var(--bg-elevated)", borderRadius: 12, padding: 20, display: "flex", justifyContent: "center" }}>
            <PlatformPreview
              platform={platform}
              title={form.title || "Notification title"}
              body={form.body || "Notification body"}
              icon={form.iconUrl || null}
              image={form.imageUrl || null}
              domain={domain}
            />
          </div>
        </div>
      </div>

      {/* ---- report ---- */}
      {report && campaign.status !== "draft" && (
        <div className="panel">
          <h3>Blast report {campaign.status === "sending" && <span className="badge amber">live</span>}</h3>
          <div className="cards" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginBottom: 0 }}>
            <div className="card"><div className="label">Targeted</div><div className="value">{report.funnel.targeted}</div></div>
            <div className="card"><div className="label">Queued</div><div className="value">{report.funnel.queued}</div></div>
            <div className="card"><div className="label">Sent</div><div className="value">{report.funnel.sent}</div></div>
            <div className="card"><div className="label">Clicked</div><div className="value">{report.funnel.clicked}</div><div className="hint">{report.ctr !== null ? `CTR ${report.ctr}%` : ""}</div></div>
            <div className="card"><div className="label">Failed</div><div className="value">{report.funnel.failed}</div></div>
            <div className="card"><div className="label">Pruned</div><div className="value">{report.funnel.expired}</div></div>
          </div>
          {report.errors.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-dim)" }}>
              Errors: {report.errors.map((e) => `${e.code}×${e.count}`).join(" · ")}
            </div>
          )}
        </div>
      )}
    </>
  );
}
