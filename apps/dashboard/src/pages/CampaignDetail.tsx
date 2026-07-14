import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getUser } from "../api";

interface CampaignAction {
  action: string;
  title: string;
  url?: string;
  numbers?: string[];
  strategy?: "round_robin" | "random";
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
  callNumbers: string[];
  callStrategy: string;
  sourceDomain: string | null;
  actions: CampaignAction[] | null;
  abConfig: { enabled: boolean; variantB?: { title?: string; body?: string } } | null;
  recurrence: { freq: string; interval?: number; byweekday?: number[] } | null;
  segmentIds: string[];
  mixStrategy: string;
  targetAll: boolean;
  status: string;
  scheduleAt: string | null;
  pacingPerMinute: number | null;
  segment: { id: string; name: string } | null;
  totalTargeted: number | null;
  createdAt: string;
}

interface Live {
  name: string;
  status: string;
  startedAt: string | null;
  pacingPerMinute: number | null;
  targeted: number;
  queued: number;
  sent: number;
  failed: number;
  expired: number;
  clicked: number;
  ctr: number | null;
  sentLastMin: number;
  elapsedSec: number;
  etaMinutes: number;
}

interface Report {
  funnel: { targeted: number; queued: number; sent: number; delivered: number; clicked: number; failed: number; expired: number };
  ctr: number | null;
  errors: { code: string; count: number }[];
  variants: { variant: string; sent: number; clicked: number; ctr: number }[] | null;
  revenue: { conversions: number; amount: number };
}

interface CdrRow {
  id: string;
  at: string;
  status: string;
  variant: string | null;
  clicked: boolean;
  errorCode: string | null;
  lead: { id: string; utmCampaign: string | null; device: string | null; country: string | null };
  cost: number;
}

interface Cdr {
  rates: { per_send: number; per_click: number; currency: string };
  summary: { records: number; sent: number; clicked: number; sendCost: number; clickCost: number; total: number };
  rows: CdrRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "gray", scheduled: "purple", sending: "amber", paused: "amber",
  sent: "green", cancelled: "gray", failed: "amber",
};
const EMOJI = ["🔥", "🎉", "✨", "🛍️", "💰", "⚡", "🔔", "🎁", "📢", "⏰"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PACING_PRESETS = [60, 300, 600, 1200, 3000];

type Platform = "windows" | "android" | "mac" | "ios" | "tablet";

interface ActionRow {
  kind: "url" | "call";
  title: string;
  value: string; // url, or comma-separated numbers for call pools
  strategy: "round_robin" | "random";
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

function actionLabel(a: ActionRow): string {
  return (a.kind === "call" ? "📞 " : "") + (a.title || (a.kind === "call" ? "Call now" : "Open"));
}

/* ---------- device mockups ---------- */

function IphonePreview({ title, body, icon }: PreviewProps) {
  return (
    <div style={{ width: 270, height: 560, borderRadius: 44, border: "10px solid #17171a", background: "linear-gradient(165deg,#4a3b7a 0%,#232a52 55%,#141a38 100%)", position: "relative", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.5)" }}>
      <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 86, height: 24, borderRadius: 14, background: "#000" }} />
      <div style={{ textAlign: "center", marginTop: 64, color: "#fff" }}>
        <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.9 }}>Tuesday, 14 July</div>
        <div style={{ fontSize: 64, fontWeight: 300, lineHeight: 1.05, letterSpacing: -1 }}>9:41</div>
      </div>
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
      <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#000" }} />
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px 0", color: "#e6e6e6", fontSize: 11 }}>
        <span>9:41</span>
        <span>📶 🔋</span>
      </div>
      <div style={{ color: "#e9f2ef", padding: "26px 20px 8px" }}>
        <div style={{ fontSize: 42, fontWeight: 400, lineHeight: 1 }}>9:41</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Tue, 14 July</div>
      </div>
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
              <span key={i} style={{ color: "#0b57d0", fontSize: 12.5, fontWeight: 600 }}>{actionLabel(a)}</span>
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
              <span key={i} style={{ flex: 1, textAlign: "center", background: "#3a3a3a", borderRadius: 4, padding: "5px 0", fontSize: 11, fontWeight: 600 }}>{actionLabel(a)}</span>
            ))}
          </div>
        )}
      </div>
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
      <div style={{ height: 22, background: "rgba(20,20,28,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", padding: "0 10px", color: "#eee", fontSize: 10, gap: 10 }}>
        <span style={{ fontSize: 11 }}></span>
        <b>Finder</b><span>File</span><span>Edit</span><span>View</span>
        <span style={{ marginLeft: "auto" }}>Tue 14 Jul 9:41 AM</span>
      </div>
      <div style={{ position: "absolute", right: 10, top: 32, width: 240, background: "rgba(246,246,248,.92)", backdropFilter: "blur(6px)", borderRadius: 12, padding: "9px 11px", color: "#111", display: "flex", gap: 10, alignItems: "center", boxShadow: "0 8px 26px rgba(0,0,0,.35)" }}>
        <Icon icon={icon} size={32} radius={7} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 11.5 }}>{title}</div>
          <div style={{ fontSize: 11, color: "#444", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{body}</div>
          <div style={{ fontSize: 9.5, color: "#888", marginTop: 2 }}>{domain}</div>
        </div>
      </div>
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
  tablet: "Tablets follow their OS: iPadOS behaves like iOS (Home Screen required, no image/buttons — shown here); Android tablets behave like Android phones with a wider card.",
};

function TabletPreview({ title, body, icon }: PreviewProps) {
  return (
    <div style={{ width: 340, height: 450, borderRadius: 26, border: "12px solid #1a1a1e", background: "linear-gradient(160deg,#3d5a80 0%,#1f2f4a 60%,#131c30 100%)", position: "relative", overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.5)" }}>
      {/* front camera */}
      <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 8, height: 8, borderRadius: "50%", background: "#000" }} />
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px 0", color: "#dfe6f0", fontSize: 10 }}>
        <span>Tuesday, 14 July</span>
        <span>📶 82% 🔋</span>
      </div>
      <div style={{ textAlign: "center", marginTop: 46, color: "#fff" }}>
        <div style={{ fontSize: 56, fontWeight: 300, lineHeight: 1 }}>9:41</div>
      </div>
      {/* notification banner — wider on tablets */}
      <div style={{ margin: "30px 26px 0", background: "rgba(245,245,250,.9)", backdropFilter: "blur(6px)", borderRadius: 16, padding: "10px 14px", color: "#111", display: "flex", gap: 12, alignItems: "center" }}>
        <Icon icon={icon} size={38} radius={9} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
            <span style={{ fontSize: 10.5, color: "#666", flexShrink: 0 }}>now</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#333", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{body}</div>
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", width: 130, height: 4, borderRadius: 2, background: "rgba(255,255,255,.7)" }} />
    </div>
  );
}

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${sec % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ---------- page ---------- */

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = getUser()?.role ?? "admin";
  const canEdit = role === "admin" || role === "manager";
  const canOperate = canEdit || role === "operator";

  const [tab, setTab] = useState<"basic" | "details">("basic");
  const [tabInitialized, setTabInitialized] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [audience, setAudience] = useState<number | null>(null);
  const [platform, setPlatform] = useState<Platform>("android");
  const [previewVariant, setPreviewVariant] = useState<"A" | "B">("A");
  const [form, setForm] = useState({ name: "", title: "", body: "", clickUrl: "", iconUrl: "", imageUrl: "", scheduleAt: "", sourceDomain: "" });
  const [tapAction, setTapAction] = useState<"url" | "call">("url");
  const [callNumbers, setCallNumbers] = useState(""); // comma-separated
  const [callStrategy, setCallStrategy] = useState<"round_robin" | "random">("round_robin");
  const [propDomain, setPropDomain] = useState("yoursite.com");
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [ab, setAb] = useState({ enabled: false, titleB: "", bodyB: "" });
  const [repeat, setRepeat] = useState("none");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [mixStrategy, setMixStrategy] = useState("mixed");
  const [targetAll, setTargetAll] = useState(false);
  const [pacing, setPacing] = useState("");
  const [cdr, setCdr] = useState<Cdr | null>(null);
  const [cdrPage, setCdrPage] = useState(1);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // paused blasts stay editable — changes apply to the remaining queued leads on resume
  const editable = campaign ? ["draft", "scheduled", "paused"].includes(campaign.status) && canEdit : false;
  const nothingToDial = !targetAll && segmentIds.length === 0;

  const load = useCallback(() => {
    api<Campaign>(`/campaigns/${id}`).then((c) => {
      setCampaign(c);
      setForm({
        name: c.name, title: c.title, body: c.body, clickUrl: c.clickUrl,
        iconUrl: c.iconUrl ?? "", imageUrl: c.imageUrl ?? "", scheduleAt: "",
        sourceDomain: c.sourceDomain ?? "",
      });
      setActions(
        (c.actions ?? []).map((a) => ({
          kind: a.numbers?.length || a.url?.startsWith("tel:") ? "call" : "url",
          title: a.title,
          value: a.numbers?.length ? a.numbers.join(", ") : a.url?.startsWith("tel:") ? a.url.slice(4) : (a.url ?? ""),
          strategy: a.strategy ?? "round_robin",
        })),
      );
      setAb({
        enabled: c.abConfig?.enabled ?? false,
        titleB: c.abConfig?.variantB?.title ?? "",
        bodyB: c.abConfig?.variantB?.body ?? "",
      });
      setRepeat(c.recurrence?.freq ?? "none");
      setWeekdays(c.recurrence?.byweekday ?? []);
      setSegmentIds(c.segmentIds?.length ? c.segmentIds : c.segment ? [c.segment.id] : []);
      setMixStrategy(c.mixStrategy ?? "mixed");
      setTargetAll(c.targetAll ?? false);
      setPacing(c.pacingPerMinute ? String(c.pacingPerMinute) : "");
      // call-first vs url tap
      if (c.callNumbers?.length) {
        setTapAction("call");
        setCallNumbers(c.callNumbers.join(", "));
        setCallStrategy((c.callStrategy as any) ?? "round_robin");
      } else {
        setTapAction("url");
        setCallNumbers("");
      }
      // the source domain shown on a real notification is the PROPERTY's domain
      // (the push subscription origin), not the click URL
      api<{ id: string; domains: string[] }[]>("/properties")
        .then((ps) => {
          const p = ps.find((x) => x.id === c.propertyId);
          if (p?.domains?.[0]) setPropDomain(p.domains[0]);
        })
        .catch(() => {});
      if (c.status !== "draft") {
        api<Report>(`/campaigns/${id}/report`).then(setReport).catch(() => {});
        api<Cdr>(`/campaigns/${id}/cdr?page=${cdrPage}`).then(setCdr).catch(() => {});
      }
    }).catch((e) => setError(e.message));
    api<{ id: string; name: string }[]>("/segments").then(setSegments).catch(() => {});
    api<Live>(`/campaigns/${id}/live`).then(setLive).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  // drafts open straight in the designer; running/sent campaigns in the monitor
  useEffect(() => {
    if (campaign && !tabInitialized) {
      setTab(campaign.status === "draft" && canEdit ? "details" : "basic");
      setTabInitialized(true);
    }
  }, [campaign, tabInitialized, canEdit]);

  // live monitor poll — every 2s while active, every 10s otherwise
  useEffect(() => {
    const active = live?.status === "sending" || live?.status === "paused";
    const t = setInterval(() => {
      api<Live>(`/campaigns/${id}/live`).then((l) => {
        setLive(l);
        if (l.status !== campaign?.status) load();
      }).catch(() => {});
    }, active ? 2000 : 10000);
    return () => clearInterval(t);
  }, [id, live?.status, campaign?.status, load]);

  // leads count for the selected segments (union, deduped)
  useEffect(() => {
    if (!campaign) return;
    let stale = false;
    setAudience(null);
    api<{ count: number }>(`/campaigns/audience-count`, {
      method: "POST",
      body: JSON.stringify({ propertyId: campaign.propertyId, segmentIds, targetAll }),
    }).then((r) => { if (!stale) setAudience(r.count); }).catch(() => {});
    return () => { stale = true; };
  }, [campaign, segmentIds, targetAll]);

  function actionsPayload(): CampaignAction[] {
    return actions
      .filter((a) => a.value.trim())
      .slice(0, 2)
      .map((a, i) => {
        if (a.kind === "call") {
          const numbers = a.value.split(",").map((n) => n.replace(/[^\d+]/g, "")).filter(Boolean);
          return {
            action: `a${i + 1}`,
            title: a.title || "Call now",
            numbers,
            strategy: a.strategy,
            url: numbers.length === 1 ? `tel:${numbers[0]}` : undefined,
          };
        }
        return { action: `a${i + 1}`, title: a.title || "Open", url: a.value };
      });
  }

  function callNumbersList(): string[] {
    return callNumbers.split(",").map((n) => n.replace(/[^\d+]/g, "")).filter(Boolean);
  }

  async function save(): Promise<boolean> {
    setBusy(true); setMsg(""); setError("");
    try {
      const nums = tapAction === "call" ? callNumbersList() : [];
      if (tapAction === "call" && nums.length === 0) {
        setError("Add at least one phone number for a click-to-call campaign");
        setBusy(false);
        return false;
      }
      // call mode: body tap dials; clickUrl holds the first number as fallback
      const clickUrl = tapAction === "call" ? `tel:${nums[0]}` : form.clickUrl;
      await api(`/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name, title: form.title, body: form.body, clickUrl,
          callNumbers: nums,
          callStrategy,
          sourceDomain: form.sourceDomain.trim() || null,
          // null (not undefined) so emptying a field actually clears it server-side
          iconUrl: form.iconUrl || null, imageUrl: form.imageUrl || null,
          actions: actionsPayload(),
          segmentIds,
          mixStrategy,
          targetAll,
          segmentId: segmentIds[0] ?? null,
          pacingPerMinute: pacing ? Number(pacing) : null,
          abConfig: ab.enabled ? { enabled: true, variantB: { title: ab.titleB, body: ab.bodyB } } : null,
        }),
      });
      setMsg(campaign?.status === "paused" ? "Saved — applies to remaining leads on resume" : "Saved");
      load();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: "send-now" | "pause" | "resume" | "cancel") {
    setError("");
    try {
      if (action === "send-now") {
        if (nothingToDial) {
          setError("No leads selected — pick at least one segment or enable 'All active subscribers'");
          return;
        }
        if (editable && !(await save())) return;
        if (!confirm(`Blast to ${audience ?? "?"} leads now?`)) return;
      }
      await api(`/campaigns/${id}/${action}`, { method: "POST" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function schedule() {
    if (!form.scheduleAt) { setError("Pick a schedule time first"); return; }
    if (nothingToDial) {
      setError("No leads selected — pick at least one segment or enable 'All active subscribers'");
      return;
    }
    if (new Date(form.scheduleAt).getTime() <= Date.now()) {
      setError("Schedule time must be in the future");
      return;
    }
    if (!(await save())) return;
    try {
      await api(`/campaigns/${id}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          schedule_at: new Date(form.scheduleAt).toISOString(),
          recurrence: repeat === "none" ? null : { freq: repeat, interval: 1, ...(repeat === "WEEKLY" && weekdays.length ? { byweekday: weekdays } : {}) },
        }),
      });
      setMsg(`Scheduled for ${new Date(form.scheduleAt).toLocaleString()}`);
      setError("");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (campaign && campaign.status !== "draft") {
      api<Cdr>(`/campaigns/${id}/cdr?page=${cdrPage}`).then(setCdr).catch(() => {});
    }
  }, [id, cdrPage, campaign?.status]);

  // RFC-4180 quoting + formula-injection guard: utmCampaign etc. come from the
  // public subscribe endpoint (attacker-controlled), so a value like
  // "=HYPERLINK(...)" must not execute when the CSV is opened in Excel.
  function csvCell(v: unknown): string {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize formula triggers
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  async function exportCdrCsv() {
    setMsg("Exporting CDR…");
    try {
      const cols = ["send_id", "timestamp", "status", "variant", "clicked", "error", "lead_id", "lead_campaign", "device", "country", "cost"];
      const lines = [cols.join(",")];
      let p = 1;
      let truncated = false;
      for (;;) {
        const batch = await api<Cdr>(`/campaigns/${id}/cdr?page=${p}&page_size=500`);
        for (const r of batch.rows) {
          lines.push(
            [r.id, r.at, r.status, r.variant ?? "", r.clicked, r.errorCode ?? "", r.lead.id, r.lead.utmCampaign ?? "", r.lead.device ?? "", r.lead.country ?? "", r.cost]
              .map(csvCell)
              .join(","),
          );
        }
        if (p * batch.pageSize >= batch.total) break;
        if (p >= 200) { truncated = true; break; } // 100k-row safety cap
        p++;
      }
      const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cdr-${campaign?.name.replace(/\W+/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(
        `CDR exported (${lines.length - 1} records)` +
          (truncated ? " — capped at 100,000 rows; contact support for a full export" : ""),
      );
    } catch (e: any) {
      setError(e.message);
      setMsg("");
    }
  }

  async function duplicate() {
    const nums = tapAction === "call" ? callNumbersList() : [];
    try {
      const created = await api<Campaign>("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          propertyId: campaign!.propertyId,
          name: form.name + " (copy)",
          title: form.title, body: form.body,
          clickUrl: nums.length ? `tel:${nums[0]}` : form.clickUrl,
          callNumbers: nums, callStrategy,
          sourceDomain: form.sourceDomain.trim() || undefined,
          iconUrl: form.iconUrl || undefined, imageUrl: form.imageUrl || undefined,
          actions: actionsPayload(),
          segmentIds, mixStrategy, targetAll,
          pacingPerMinute: pacing ? Number(pacing) : undefined,
          abConfig: ab.enabled ? { enabled: true, variantB: { title: ab.titleB, body: ab.bodyB } } : undefined,
        }),
      });
      navigate(`/campaigns/${created.id}`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!campaign) return <div className="page-sub">{error || "Loading…"}</div>;

  // preview source line: campaign override if set, else the property's real
  // push origin (what the browser actually shows on a delivered notification)
  const domain = form.sourceDomain.trim() || propDomain;
  const previewProps: PreviewProps = {
    title: (previewVariant === "B" && ab.enabled ? (ab.titleB || form.title) : form.title) || "Notification title",
    body: (previewVariant === "B" && ab.enabled ? (ab.bodyB || form.body) : form.body) || "Notification body",
    icon: form.iconUrl || null,
    image: form.imageUrl || null,
    domain,
    actions: actions.filter((a) => a.value.trim()).slice(0, 2),
  };
  const progressed = live ? live.sent + live.failed + live.expired : 0;
  const pct = live && live.targeted > 0 ? Math.min((progressed / live.targeted) * 100, 100) : 0;

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">
            <Link to="/campaigns" style={{ color: "var(--text-dim)" }}>Campaigns</Link> / {campaign.name}
          </div>
          <div className="page-sub">
            <span className={"badge " + (STATUS_BADGE[campaign.status] ?? "gray")}>{campaign.status}</span>
            {campaign.status === "scheduled" && campaign.scheduleAt && <> · fires {new Date(campaign.scheduleAt).toLocaleString()}</>}
            {campaign.recurrence && <> · repeats {campaign.recurrence.freq.toLowerCase()}</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={"btn small " + (tab === "basic" ? "" : "secondary")} onClick={() => setTab("basic")}>
            ▶ Basic (daily ops)
          </button>
          {canEdit && (
            <button className={"btn small " + (tab === "details" ? "" : "secondary")} onClick={() => setTab("details")}>
              ⚙ Details (setup)
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      {/* ================= BASIC VIEW ================= */}
      {tab === "basic" && (
        <>
          <div className="panel">
            <div className="flex-between">
              <h3>Live blast monitor <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text-dim)" }}>{(live?.status === "sending" || live?.status === "paused") ? "· refreshing every 2s" : ""}</span></h3>
              {canOperate && (
                <div className="row-actions">
                  {campaign.status === "draft" && <button className="btn" onClick={() => lifecycle("send-now")}>▶ Start blast</button>}
                  {campaign.status === "sending" && <button className="btn secondary" onClick={() => lifecycle("pause")}>⏸ Pause</button>}
                  {campaign.status === "paused" && <button className="btn" onClick={() => lifecycle("resume")}>▶ Resume</button>}
                  {campaign.status === "scheduled" && <button className="btn secondary" onClick={() => lifecycle("cancel")}>✕ Cancel schedule</button>}
                  {["sent", "cancelled", "failed"].includes(campaign.status) && canEdit && (
                    <button className="btn" onClick={duplicate}>Duplicate as draft</button>
                  )}
                </div>
              )}
            </div>

            {live && (
              <>
                <div style={{ height: 14, background: "var(--bg-elevated)", borderRadius: 7, overflow: "hidden", margin: "10px 0 6px" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: campaign.status === "paused" ? "var(--amber)" : "var(--accent)", transition: "width 0.5s" }} />
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
                  {progressed.toLocaleString()} / {live.targeted.toLocaleString()} leads blasted ({pct.toFixed(1)}%)
                  {live.status === "sending" && live.queued > 0 && <> · ETA ≈ {live.etaMinutes} min</>}
                  {live.startedAt && <> · elapsed {fmtElapsed(live.elapsedSec)}</>}
                </div>
                <div className="cards" style={{ gridTemplateColumns: "repeat(8, 1fr)", marginBottom: 0 }}>
                  <div className="card"><div className="label">Targeted</div><div className="value">{live.targeted}</div></div>
                  <div className="card"><div className="label">Queued</div><div className="value" style={{ color: live.queued > 0 ? "var(--amber)" : undefined }}>{live.queued}</div></div>
                  <div className="card"><div className="label">Sent</div><div className="value" style={{ color: "var(--green)" }}>{live.sent}</div></div>
                  <div className="card"><div className="label">Rate/min</div><div className="value">{live.sentLastMin}</div><div className="hint">{live.pacingPerMinute ? `paced ${live.pacingPerMinute}/min` : "full speed"}</div></div>
                  <div className="card"><div className="label">Clicked</div><div className="value">{live.clicked}</div></div>
                  <div className="card"><div className="label">CTR</div><div className="value">{live.ctr === null ? "–" : `${live.ctr}%`}</div></div>
                  <div className="card"><div className="label">Failed</div><div className="value" style={{ color: live.failed > 0 ? "var(--red)" : undefined }}>{live.failed}</div></div>
                  <div className="card"><div className="label">Pruned</div><div className="value">{live.expired}</div></div>
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <h3>Campaign summary</h3>
            <table>
              <tbody>
                <tr><td style={{ color: "var(--text-dim)", width: 160 }}>Message</td><td><b>{campaign.title}</b><div style={{ fontSize: 12, color: "var(--text-dim)" }}>{campaign.body}</div></td></tr>
                <tr><td style={{ color: "var(--text-dim)" }}>Leads</td><td>{targetAll ? "🌐 All active subscribers" : segmentIds.length === 0 ? <span className="badge amber">none — nothing to dial</span> : segmentIds.map((sid) => segments.find((s) => s.id === sid)?.name ?? "…").join(" + ")}{segmentIds.length > 1 && <span className="badge purple" style={{ marginLeft: 8 }}>{mixStrategy === "mixed" ? "mixed evenly" : mixStrategy === "sequential" ? "one after another" : "zone-wise"}</span>}</td></tr>
                <tr><td style={{ color: "var(--text-dim)" }}>Audience</td><td>{audience === null ? "…" : `${audience.toLocaleString()} leads`}</td></tr>
                <tr><td style={{ color: "var(--text-dim)" }}>Pacing</td><td>{campaign.pacingPerMinute ? `${campaign.pacingPerMinute} / minute` : "Full speed"}</td></tr>
                <tr><td style={{ color: "var(--text-dim)" }}>A/B test</td><td>{campaign.abConfig?.enabled ? "On — 50/50" : "Off"}</td></tr>
                {report && report.revenue.conversions > 0 && (
                  <tr><td style={{ color: "var(--text-dim)" }}>Revenue</td><td>₹{report.revenue.amount.toLocaleString()} from {report.revenue.conversions} conversions</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {cdr && campaign.status !== "draft" && (
            <div className="panel">
              <div className="flex-between">
                <h3>💳 Billing — CDR (per-lead records)</h3>
                <button className="btn secondary small" onClick={exportCdrCsv}>⬇ Export CSV</button>
              </div>
              <div style={{ marginBottom: 12, fontSize: 13 }}>
                <span className="badge green">
                  Campaign cost: {cdr.rates.currency} {cdr.summary.total.toLocaleString()}
                </span>
                <span style={{ color: "var(--text-dim)", marginLeft: 10 }}>
                  = {cdr.summary.sent.toLocaleString()} sends × {cdr.rates.per_send} + {cdr.summary.clicked.toLocaleString()} clicks × {cdr.rates.per_click} (pay-per-click)
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Lead</th>
                    <th>Status</th>
                    <th>Variant</th>
                    <th>Clicked</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {cdr.rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontSize: 12 }}>{new Date(r.at).toLocaleString()}</td>
                      <td style={{ fontSize: 12 }}>
                        <span className="commit-hash">{r.lead.id.slice(0, 8)}</span> {r.lead.utmCampaign ?? "direct"} · {r.lead.device ?? "–"}{r.lead.country ? ` · ${r.lead.country}` : ""}
                      </td>
                      <td>
                        <span className={"badge " + (r.status === "sent" ? "green" : r.status === "expired" ? "amber" : "gray")}>
                          {r.status}{r.errorCode ? ` (${r.errorCode})` : ""}
                        </span>
                      </td>
                      <td>{r.variant ?? "–"}</td>
                      <td>{r.clicked ? "✔" : "–"}</td>
                      <td>{r.cost > 0 ? `${cdr.rates.currency} ${r.cost}` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cdr.total > cdr.pageSize && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <button className="btn secondary small" disabled={cdrPage <= 1} onClick={() => setCdrPage(cdrPage - 1)}>← Prev</button>
                  <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                    {cdr.total.toLocaleString()} records · page {cdrPage} of {Math.ceil(cdr.total / cdr.pageSize)}
                  </span>
                  <button className="btn secondary small" disabled={cdrPage >= Math.ceil(cdr.total / cdr.pageSize)} onClick={() => setCdrPage(cdrPage + 1)}>Next →</button>
                </div>
              )}
            </div>
          )}

          {report?.variants && (
            <div className="panel">
              <h3>A/B result</h3>
              <table>
                <thead><tr><th>Variant</th><th>Sent</th><th>Clicked</th><th>CTR</th><th></th></tr></thead>
                <tbody>
                  {report.variants.map((v) => {
                    const best = report.variants!.every((o) => v.ctr >= o.ctr) && v.ctr > 0;
                    return (
                      <tr key={v.variant}>
                        <td><span className="badge purple">Variant {v.variant}</span></td>
                        <td>{v.sent}</td><td>{v.clicked}</td><td>{v.ctr}%</td>
                        <td>{best && <span className="badge green">🏆 winner</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ================= DETAILS VIEW ================= */}
      {tab === "details" && canEdit && (
        <>
          <div className="flex-between" style={{ marginBottom: 14 }}>
            <div className="page-sub" style={{ marginBottom: 0 }}>
              {campaign.status === "paused"
                ? "⏸ Paused — every section is editable. Saved changes apply to the remaining queued leads when you resume."
                : editable
                  ? "Full campaign setup — content, targeting, pacing, A/B."
                  : `Campaign is ${campaign.status} — content locked. Duplicate to edit.`}
            </div>
            <div className="row-actions">
              {editable && (
                <>
                  <button className="btn secondary" onClick={() => save()} disabled={busy}>Save</button>
                  {campaign.status === "paused" ? (
                    <button className="btn" onClick={() => lifecycle("resume")} disabled={busy}>▶ Save &amp; Resume</button>
                  ) : (
                    <>
                      {campaign.status !== "scheduled" && <button className="btn secondary" onClick={schedule} disabled={busy || !form.scheduleAt || nothingToDial}>Schedule</button>}
                      <button className="btn" onClick={() => lifecycle("send-now")} disabled={busy || nothingToDial}>Send now</button>
                    </>
                  )}
                </>
              )}
              {!editable && <button className="btn" onClick={duplicate}>Duplicate as draft</button>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div className="panel" style={{ flex: 1, minWidth: 340 }}>
              <h3>Content</h3>
              <fieldset disabled={!editable} style={{ border: "none" }}>
                <label>Internal name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <label>Title <span style={{ color: form.title.length > 50 ? "var(--amber)" : "var(--text-dim)", fontWeight: 400 }}>({form.title.length}/50)</span></label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                {editable && (
                  <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                    {EMOJI.map((em) => (
                      <button key={em} type="button" onClick={() => setForm({ ...form, title: form.title + em })}
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontSize: 14 }}>
                        {em}
                      </button>
                    ))}
                  </div>
                )}
                <label>Body <span style={{ color: form.body.length > 120 ? "var(--amber)" : "var(--text-dim)", fontWeight: 400 }}>({form.body.length}/120)</span></label>
                <textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />

                <label>When the notification is tapped…</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                  <button type="button" className={"btn small " + (tapAction === "url" ? "" : "secondary")} onClick={() => setTapAction("url")}>🌐 Open website</button>
                  <button type="button" className={"btn small " + (tapAction === "call" ? "" : "secondary")} onClick={() => setTapAction("call")}>📞 Call number</button>
                </div>
                {tapAction === "url" ? (
                  <>
                    <label>Click URL (where the tap lands)</label>
                    <input value={form.clickUrl} placeholder="https://…" onChange={(e) => setForm({ ...form, clickUrl: e.target.value })} />
                  </>
                ) : (
                  <div className="panel" style={{ padding: 12 }}>
                    <label>Phone number(s) — tapping the notification opens the dialer</label>
                    <input
                      value={callNumbers}
                      placeholder="+91 98765 43210, +91 91234 56789, …"
                      onChange={(e) => setCallNumbers(e.target.value)}
                    />
                    {callNumbersList().length > 1 && (
                      <>
                        <label>Distribute calls across numbers</label>
                        <select value={callStrategy} onChange={(e) => setCallStrategy(e.target.value as any)} style={{ width: 200 }}>
                          <option value="round_robin">Round robin (even)</option>
                          <option value="random">Random</option>
                        </select>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                          {callNumbersList().length} numbers — each lead's tap dials one, {callStrategy === "random" ? "picked at random" : "distributed round-robin"}.
                        </div>
                      </>
                    )}
                    <div style={{ fontSize: 11, color: "var(--green)", marginTop: 8 }}>
                      ✅ Works on iPhone, Android &amp; desktop. Tapping opens a secure call page that
                      launches the dialer — this routes around Apple's block on <code>tel:</code> in
                      notifications, so iOS leads dial too. The tap is still tracked (CTR/CDR).
                    </div>
                  </div>
                )}
                <label>Source domain (shown as the notification sender)</label>
                <input
                  value={form.sourceDomain}
                  placeholder={propDomain + "  (defaults to the property domain)"}
                  onChange={(e) => setForm({ ...form, sourceDomain: e.target.value })}
                />
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                  Drives the preview's sender line. Note: on a delivered push the browser always
                  shows the property's real push origin ({propDomain}) — this label can't override that
                  (a browser security rule), but it lets you preview/brand as you like.
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label>Icon URL</label>
                    <input value={form.iconUrl} placeholder="https://… (square, ≥192px)" onChange={(e) => setForm({ ...form, iconUrl: e.target.value })} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Big image URL</label>
                    <input value={form.imageUrl} placeholder="https://… (2:1, Win/Android)" onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
                  </div>
                </div>

                <label>Action buttons (up to 2) — click-to-call supports a number pool</label>
                {actions.map((a, i) => (
                  <div key={i} className="panel" style={{ padding: 10, marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select value={a.kind} style={{ width: 130 }}
                        onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, kind: e.target.value as ActionRow["kind"] } : x)))}>
                        <option value="url">Open URL</option>
                        <option value="call">📞 Call phone</option>
                      </select>
                      <input style={{ width: 140 }} placeholder="Button label" value={a.title}
                        onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                      {a.kind === "call" && (
                        <select value={a.strategy} style={{ width: 150 }}
                          onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, strategy: e.target.value as ActionRow["strategy"] } : x)))}>
                          <option value="round_robin">Round robin</option>
                          <option value="random">Random</option>
                        </select>
                      )}
                      <button type="button" className="btn secondary small" style={{ marginLeft: "auto" }} onClick={() => setActions(actions.filter((_, j) => j !== i))}>✕</button>
                    </div>
                    <input style={{ marginTop: 8 }}
                      placeholder={a.kind === "call" ? "+91 98765 43210, +91 91234 56789, … (leads are distributed across these)" : "https://…"}
                      value={a.value}
                      onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                    {a.kind === "call" && a.value.includes(",") && (
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                        {a.value.split(",").filter((n) => n.trim()).length} numbers — each lead's button dials one, {a.strategy === "random" ? "picked at random" : "distributed round-robin"}.
                      </div>
                    )}
                  </div>
                ))}
                {actions.length < 2 && editable && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn secondary small" onClick={() => setActions([...actions, { kind: "url", title: "", value: "", strategy: "round_robin" }])}>+ Add button</button>
                    <button type="button" className="btn secondary small" onClick={() => setActions([...actions, { kind: "call", title: "Call now", value: "", strategy: "round_robin" }])}>+ 📞 Click-to-call</button>
                  </div>
                )}

                <h3 style={{ marginTop: 22 }}>A/B test</h3>
                <select style={{ width: 220 }} value={ab.enabled ? "on" : "off"} onChange={(e) => setAb({ ...ab, enabled: e.target.value === "on" })}>
                  <option value="off">Off — single message</option>
                  <option value="on">On — 50/50 split A vs B</option>
                </select>
                {ab.enabled && (
                  <div className="panel" style={{ padding: 12, marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>
                      Variant A = the title/body above. Blank B fields reuse A's.
                    </div>
                    <label>Variant B title</label>
                    <input value={ab.titleB} onChange={(e) => setAb({ ...ab, titleB: e.target.value })} placeholder={form.title} />
                    <label>Variant B body</label>
                    <textarea rows={2} value={ab.bodyB} onChange={(e) => setAb({ ...ab, bodyB: e.target.value })} placeholder={form.body} />
                  </div>
                )}

                <h3 style={{ marginTop: 22 }}>Leads &amp; mixing</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, padding: "8px 10px", background: "var(--bg-elevated)", borderRadius: 8 }}>
                  <input type="checkbox" style={{ width: "auto" }}
                    checked={targetAll}
                    onChange={(e) => { setTargetAll(e.target.checked); if (e.target.checked) setSegmentIds([]); }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>🌐 All active subscribers</span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>(ignores segments)</span>
                </div>
                <label>Segments (pick one or more)</label>
                {segments.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, opacity: targetAll ? 0.4 : 1 }}>
                    <input type="checkbox" style={{ width: "auto" }}
                      disabled={targetAll}
                      checked={segmentIds.includes(s.id)}
                      onChange={(e) => setSegmentIds(e.target.checked ? [...segmentIds, s.id] : segmentIds.filter((x) => x !== s.id))} />
                    <span style={{ fontSize: 13 }}>{s.name}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8 }}>
                  {nothingToDial ? (
                    <span className="badge amber">⚠ 0 leads — nothing to dial. Pick segments or enable "All active subscribers".</span>
                  ) : (
                    <span className="badge purple">{audience === null ? "counting…" : `${audience.toLocaleString()} leads (deduped)`}</span>
                  )}
                </div>
                {segmentIds.length > 1 && (
                  <>
                    <label>Lead mix (dialing order across segments)</label>
                    <select value={mixStrategy} onChange={(e) => setMixStrategy(e.target.value)} style={{ width: 280 }}>
                      <option value="mixed">Mix evenly — interleave leads from all segments</option>
                      <option value="sequential">One after another — finish segment 1, then 2…</option>
                      <option value="zone">Zone-wise — group by lead timezone</option>
                    </select>
                  </>
                )}

                <h3 style={{ marginTop: 22 }}>Pacing</h3>
                <label>Sends per minute — type any number (empty = full speed)</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="number" min={1} style={{ width: 140 }} value={pacing} placeholder="full speed"
                    onChange={(e) => setPacing(e.target.value)} />
                  {PACING_PRESETS.map((p) => (
                    <button key={p} type="button" className={"btn small " + (pacing === String(p) ? "" : "secondary")} onClick={() => setPacing(String(p))}>{p}</button>
                  ))}
                  <button type="button" className="btn small secondary" onClick={() => setPacing("")}>Max</button>
                </div>
                {pacing && audience !== null && audience > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                    ≈ {Math.ceil(audience / Number(pacing))} min to complete the blast
                  </div>
                )}

                {editable && campaign.status !== "scheduled" && (
                  <>
                    <h3 style={{ marginTop: 22 }}>Schedule</h3>
                    <input type="datetime-local" value={form.scheduleAt} onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })} />
                    <label>Repeat</label>
                    <select value={repeat} onChange={(e) => setRepeat(e.target.value)} style={{ width: 220 }}>
                      <option value="none">Does not repeat</option>
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                    {repeat === "WEEKLY" && (
                      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                        {WEEKDAYS.map((d, i) => (
                          <button key={d} type="button" className={"btn small " + (weekdays.includes(i) ? "" : "secondary")}
                            onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i])}>
                            {d}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </fieldset>
            </div>

            {/* previews */}
            <div className="panel" style={{ width: 440 }}>
              <div className="flex-between">
                <h3>Popup preview</h3>
                {ab.enabled && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["A", "B"] as const).map((v) => (
                      <button key={v} className={"btn small " + (previewVariant === v ? "" : "secondary")} onClick={() => setPreviewVariant(v)}>
                        Variant {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {(["windows", "mac", "android", "ios", "tablet"] as Platform[]).map((p) => (
                  <button key={p} className={"btn small " + (platform === p ? "" : "secondary")} onClick={() => setPlatform(p)}>
                    {p === "windows" ? "🪟 Windows" : p === "android" ? "🤖 Android" : p === "mac" ? "🍎 macOS" : p === "ios" ? "📱 iPhone" : "📲 Tablet"}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
                {platform === "ios" && <IphonePreview {...previewProps} />}
                {platform === "android" && <AndroidPreview {...previewProps} />}
                {platform === "windows" && <WindowsPreview {...previewProps} />}
                {platform === "mac" && <MacPreview {...previewProps} />}
                {platform === "tablet" && <TabletPreview {...previewProps} />}
              </div>
              <div className="preview-note" style={{ maxWidth: "100%", textAlign: "center" }}>{PREVIEW_NOTES[platform]}</div>
            </div>
          </div>

          {report && campaign.status !== "draft" && (
            <div className="panel">
              <h3>Blast report</h3>
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
      )}
    </>
  );
}
