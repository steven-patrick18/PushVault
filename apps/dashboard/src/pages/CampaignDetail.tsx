import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

interface CampaignAction {
  action: string;
  title: string;
  url: string;
}

interface Campaign {
  id: string;
  propertyId: string;
  name: string;
  title: string;
  body: string;
  iconUrl: string | null;
  imageUrl: string | null;
  clickUrl: string;
  actions: CampaignAction[] | null;
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

const EMOJI = ["🔥", "🎉", "✨", "🛍️", "💰", "⚡", "🔔", "🎁", "📢", "⏰"];

type Platform = "windows" | "android" | "mac" | "ios";

interface ActionRow {
  kind: "url" | "call";
  title: string;
  value: string;
}

interface PreviewProps {
  title: string;
  body: string;
  icon: string | null;
  image: string | null;
  domain: string;
  actions: ActionRow[];
}

function Icon({ icon, size, radius }: { icon: string | null; size: number; radius: number }) {
  return icon ? (
    <img src={icon} style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0 }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: radius, background: "linear-gradient(135deg,#7C3AED,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.5, flexShrink: 0 }}>🔔</div>
  );
}

/* ---------- realistic device mockups ---------- */

function IphonePreview({ title, body, icon }: PreviewProps) {
  return (
    <div style={{ width: 270, height: 560, borderRadius: 44, border: "10px solid #17171a", background: "linear-gradient(165deg,#4a3b7a 0%,#232a52 55%,#141a38 100%)", position: "relative", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.5)" }}>
      {/* dynamic island */}
      <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 86, height: 24, borderRadius: 14, background: "#000" }} />
      {/* lock screen clock */}
      <div style={{ textAlign: "center", marginTop: 64, color: "#fff" }}>
        <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.9 }}>Tuesday, 14 July</div>
        <div style={{ fontSize: 64, fontWeight: 300, lineHeight: 1.05, letterSpacing: -1 }}>9:41</div>
      </div>
      {/* notification banner */}
      <div style={{ margin: "26px 10px 0", background: "rgba(245,245,250,.88)", backdropFilter: "blur(6px)", borderRadius: 18, padding: "10px 12px", color: "#111", display: "flex", gap: 10, alignItems: "center" }}>
        <Icon icon={icon} size={34} radius={8} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
            <span style={{ fontSize: 10, color: "#666", flexShrink: 0 }}>now</span>
          </div>
          <div style={{ fontSize: 12, color: "#333", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{body}</div>
        </div>
      </div>
      {/* bottom controls */}
      <div style={{ position: "absolute", bottom: 22, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "0 34px" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🔦</div>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📷</div>
      </div>
      <div style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", width: 110, height: 4, borderRadius: 2, background: "rgba(255,255,255,.75)" }} />
    </div>
  );
}

function AndroidPreview({ title, body, icon, image, domain, actions }: PreviewProps) {
  return (
    <div style={{ width: 270, height: 560, borderRadius: 30, border: "8px solid #1c1e22", background: "linear-gradient(160deg,#0f3d3e 0%,#12252e 60%,#0c1620 100%)", position: "relative", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.5)" }}>
      {/* punch-hole camera */}
      <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#000" }} />
      {/* status bar */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px 0", color: "#e6e6e6", fontSize: 11 }}>
        <span>9:41</span>
        <span>📶 🔋</span>
      </div>
      {/* clock small */}
      <div style={{ color: "#e9f2ef", padding: "26px 20px 8px" }}>
        <div style={{ fontSize: 42, fontWeight: 400, lineHeight: 1 }}>9:41</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Tue, 14 July</div>
      </div>
      {/* notification card */}
      <div style={{ margin: "14px 10px 0", background: "#fdfdfd", borderRadius: 22, padding: "12px 14px", color: "#1b1b1f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#5f6368" }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "conic-gradient(#ea4335 0 25%, #fbbc04 25% 50%, #34a853 50% 75%, #4285f4 75% 100%)" }} />
          <span>Chrome · {domain} · now</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
            <div style={{ fontSize: 12.5, color: "#5f6368", marginTop: 2 }}>{body}</div>
          </div>
          <Icon icon={icon} size={36} radius={8} />
        </div>
        {image && <img src={image} style={{ width: "100%", borderRadius: 12, marginTop: 10, maxHeight: 110, objectFit: "cover" }} />}
        {actions.length > 0 && (
          <div style={{ display: "flex", gap: 18, marginTop: 10, paddingTop: 8, borderTop: "1px solid #eee" }}>
            {actions.map((a, i) => (
              <span key={i} style={{ color: "#0b57d0", fontSize: 12.5, fontWeight: 600 }}>
                {a.kind === "call" ? "📞 " : ""}{a.title || (a.kind === "call" ? "Call now" : "Open")}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", width: 96, height: 4, borderRadius: 2, background: "rgba(255,255,255,.5)" }} />
    </div>
  );
}

function WindowsPreview({ title, body, icon, image, domain, actions }: PreviewProps) {
  return (
    <div style={{ width: 360, height: 230, borderRadius: 10, background: "linear-gradient(140deg,#0b3d91 0%,#1763c6 45%,#57a8e8 100%)", position: "relative", overflow: "hidden", boxShadow: "0 14px 40px rgba(0,0,0,.45)", border: "1px solid #333" }}>
      {/* toast */}
      <div style={{ position: "absolute", right: 10, bottom: 44, width: 250, background: "#202020", borderRadius: 8, padding: "10px 12px", color: "#fff", boxShadow: "0 8px 26px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Icon icon={icon} size={34} radius={6} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{title}</div>
            <div style={{ fontSize: 11.5, color: "#c8c8c8", marginTop: 1 }}>{body}</div>
            <div style={{ fontSize: 10, color: "#8a8a8a", marginTop: 4 }}>Google Chrome · {domain}</div>
          </div>
          <span style={{ marginLeft: "auto", color: "#8a8a8a", fontSize: 11 }}>✕</span>
        </div>
        {image && <img src={image} style={{ width: "100%", borderRadius: 4, marginTop: 8, maxHeight: 70, objectFit: "cover" }} />}
        {actions.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {actions.map((a, i) => (
              <span key={i} style={{ flex: 1, textAlign: "center", background: "#3a3a3a", borderRadius: 4, padding: "5px 0", fontSize: 11, fontWeight: 600 }}>
                {a.kind === "call" ? "📞 " : ""}{a.title || (a.kind === "call" ? "Call now" : "Open")}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* taskbar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 34, background: "rgba(18,18,24,.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontSize: 14 }}>
        <span>⊞</span><span>🔍</span><span>📁</span><span>🌐</span><span>✉️</span>
        <span style={{ position: "absolute", right: 10, fontSize: 9.5, color: "#ccc", textAlign: "right", lineHeight: 1.3 }}>9:41 AM<br />14-07-2026</span>
      </div>
    </div>
  );
}

function MacPreview({ title, body, icon, domain }: PreviewProps) {
  return (
    <div style={{ width: 360, height: 230, borderRadius: 12, background: "linear-gradient(150deg,#c76b98 0%,#7b4ea3 40%,#2e2e6e 100%)", position: "relative", overflow: "hidden", boxShadow: "0 14px 40px rgba(0,0,0,.45)", border: "1px solid #333" }}>
      {/* menu bar */}
      <div style={{ height: 22, background: "rgba(20,20,28,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", padding: "0 10px", color: "#eee", fontSize: 10, gap: 10 }}>
        <span style={{ fontSize: 11 }}></span>
        <b>Finder</b><span>File</span><span>Edit</span><span>View</span>
        <span style={{ marginLeft: "auto" }}>Tue 14 Jul 9:41 AM</span>
      </div>
      {/* banner top-right */}
      <div style={{ position: "absolute", right: 10, top: 32, width: 240, background: "rgba(246,246,248,.92)", backdropFilter: "blur(6px)", borderRadius: 12, padding: "9px 11px", color: "#111", display: "flex", gap: 10, alignItems: "center", boxShadow: "0 8px 26px rgba(0,0,0,.35)" }}>
        <Icon icon={icon} size={32} radius={7} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 11.5 }}>{title}</div>
          <div style={{ fontSize: 11, color: "#444", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{body}</div>
          <div style={{ fontSize: 9.5, color: "#888", marginTop: 2 }}>{domain}</div>
        </div>
      </div>
      {/* dock */}
      <div style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", background: "rgba(255,255,255,.22)", backdropFilter: "blur(6px)", borderRadius: 12, padding: "4px 10px", display: "flex", gap: 8, fontSize: 15 }}>
        <span>🌐</span><span>✉️</span><span>🗓️</span><span>🎵</span><span>⚙️</span>
      </div>
    </div>
  );
}

const PREVIEW_NOTES: Record<Platform, string> = {
  windows: "Windows 10/11 toast, bottom-right above the taskbar. Big image + up to 2 action buttons supported.",
  android: "Android notification shade (Chrome). Big image when expanded; action buttons as text links. Click-to-call opens the dialer.",
  mac: "macOS banner, top-right under the menu bar. No big image or action buttons — keep the title short.",
  ios: "iOS 16.4+ lock screen. Works only after the visitor adds the site to their Home Screen; no images or buttons — title/body must carry the message.",
};

/* ---------- page ---------- */

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [audience, setAudience] = useState<number | null>(null);
  const [platform, setPlatform] = useState<Platform>("android");
  const [form, setForm] = useState({ name: "", title: "", body: "", clickUrl: "", iconUrl: "", imageUrl: "", segmentId: "", pacing: "", scheduleAt: "" });
  const [actions, setActions] = useState<ActionRow[]>([]);
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
      setActions(
        (c.actions ?? []).map((a) => ({
          kind: a.url?.startsWith("tel:") ? "call" : "url",
          title: a.title,
          value: a.url?.startsWith("tel:") ? a.url.slice(4) : a.url,
        })),
      );
      if (c.status !== "draft") {
        api<Report>(`/campaigns/${id}/report`).then(setReport).catch(() => {});
      }
    }).catch((e) => setError(e.message));
    api<{ id: string; name: string }[]>("/segments").then(setSegments).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (campaign?.status !== "sending") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [campaign?.status, load]);

  useEffect(() => {
    let stale = false;
    setAudience(null);
    const promise = form.segmentId
      ? api<{ count: number }>(`/segments/${form.segmentId}/count`, { method: "POST" }).then((r) => r.count)
      : api<{ total: number }>(`/subscribers?status=active&page_size=1`).then((r) => r.total);
    promise.then((n) => { if (!stale) setAudience(n); }).catch(() => {});
    return () => { stale = true; };
  }, [form.segmentId]);

  function actionsPayload(): CampaignAction[] {
    return actions
      .filter((a) => a.value.trim())
      .slice(0, 2)
      .map((a, i) => ({
        action: `a${i + 1}`,
        title: a.title || (a.kind === "call" ? "Call now" : "Open"),
        url: a.kind === "call" ? `tel:${a.value.replace(/[^\d+]/g, "")}` : a.value,
      }));
  }

  async function save(): Promise<boolean> {
    setBusy(true); setMsg(""); setError("");
    try {
      await api(`/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name, title: form.title, body: form.body, clickUrl: form.clickUrl,
          iconUrl: form.iconUrl || undefined, imageUrl: form.imageUrl || undefined,
          actions: actionsPayload(),
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
        actions: actionsPayload(),
        segmentId: form.segmentId || undefined,
        pacingPerMinute: form.pacing ? Number(form.pacing) : undefined,
      }),
    });
    navigate(`/campaigns/${created.id}`);
  }

  if (!campaign) return <div className="page-sub">{error || "Loading…"}</div>;

  const domain = (() => { try { return new URL(form.clickUrl).host; } catch { return "yoursite.com"; } })();
  const previewProps: PreviewProps = {
    title: form.title || "Notification title",
    body: form.body || "Notification body",
    icon: form.iconUrl || null,
    image: form.imageUrl || null,
    domain,
    actions: actions.filter((a) => a.value.trim()).slice(0, 2),
  };

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

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* ---- content ---- */}
        <div className="panel" style={{ flex: 1, minWidth: 340 }}>
          <h3>Content</h3>
          <fieldset disabled={!editable} style={{ border: "none" }}>
            <label>Internal name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

            <label>Title <span style={{ color: form.title.length > 50 ? "var(--amber)" : "var(--text-dim)", fontWeight: 400 }}>({form.title.length}/50 recommended)</span></label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            {editable && (
              <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                {EMOJI.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setForm({ ...form, title: form.title + em })}
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontSize: 14 }}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}

            <label>Body <span style={{ color: form.body.length > 120 ? "var(--amber)" : "var(--text-dim)", fontWeight: 400 }}>({form.body.length}/120 recommended)</span></label>
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

            <label>Action buttons (up to 2, Windows/Android) — supports click-to-call</label>
            {actions.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <select
                  value={a.kind}
                  style={{ width: 130 }}
                  onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, kind: e.target.value as ActionRow["kind"] } : x)))}
                >
                  <option value="url">Open URL</option>
                  <option value="call">📞 Call phone</option>
                </select>
                <input
                  style={{ width: 130 }}
                  placeholder="Button label"
                  value={a.title}
                  onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
                <input
                  placeholder={a.kind === "call" ? "+91 98765 43210" : "https://…"}
                  value={a.value}
                  onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <button type="button" className="btn secondary small" onClick={() => setActions(actions.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {actions.length < 2 && editable && (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn secondary small" onClick={() => setActions([...actions, { kind: "url", title: "", value: "" }])}>
                  + Add button
                </button>
                <button type="button" className="btn secondary small" onClick={() => setActions([...actions, { kind: "call", title: "Call now", value: "" }])}>
                  + 📞 Click-to-call
                </button>
              </div>
            )}

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
        <div className="panel" style={{ width: 440 }}>
          <h3>Popup preview per platform</h3>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {(["windows", "android", "mac", "ios"] as Platform[]).map((p) => (
              <button key={p} className={"btn small " + (platform === p ? "" : "secondary")} onClick={() => setPlatform(p)}>
                {p === "windows" ? "🪟 Windows" : p === "android" ? "🤖 Android" : p === "mac" ? "🍎 macOS" : "📱 iOS"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
            {platform === "ios" && <IphonePreview {...previewProps} />}
            {platform === "android" && <AndroidPreview {...previewProps} />}
            {platform === "windows" && <WindowsPreview {...previewProps} />}
            {platform === "mac" && <MacPreview {...previewProps} />}
          </div>
          <div className="preview-note" style={{ maxWidth: "100%", textAlign: "center" }}>{PREVIEW_NOTES[platform]}</div>
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
