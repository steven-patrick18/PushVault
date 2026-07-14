import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";

interface PromptConfig {
  trigger: { type: string; seconds?: number; percent?: number };
  pages: { include: string[]; exclude: string[] };
  text: { headline: string; yes: string; no: string };
  style: {
    position: string;
    accent: string;
    logo: string | null;
    size?: string; // legacy presets
    x?: number;
    y?: number;
    width?: number;
    radius?: number;
    theme?: string;
    bg?: string;
    text_color?: string;
    shadow?: string;
    scale?: number;
  };
  reask: {
    enabled: boolean;
    cooldown_days?: number; // legacy
    cooldown_value?: number;
    cooldown_unit?: "seconds" | "minutes" | "hours" | "days";
  };
}

interface Property {
  id: string;
  name: string;
  propertyKey: string;
  domains: string[];
  status: string;
  promptConfig: PromptConfig;
  frequencyCapPerDay: number;
  frequencyCapPerWeek: number;
  verifiedAt: string | null;
  verification: { checkedAt: string; results: { domain: string; url: string | null; ok: boolean; status: number | null }[] } | null;
  install?: { script: string; serviceWorker: string };
}

interface PageRow {
  id: string;
  path: string;
  views: number;
  lastSeenAt: string;
  allowed: boolean;
}

const DEFAULT_CFG: PromptConfig = {
  trigger: { type: "delay", seconds: 12 },
  pages: { include: ["*"], exclude: [] },
  text: { headline: "🔔 Get offers & price-drop alerts?", yes: "Yes, notify me", no: "No thanks" },
  style: {
    position: "top",
    accent: "#7C3AED",
    logo: null,
    x: 50,
    y: 50,
    width: 460,
    radius: 12,
    theme: "light",
    bg: "",
    text_color: "",
    shadow: "soft",
    scale: 1,
  },
  reask: { enabled: false, cooldown_value: 7, cooldown_unit: "days" },
};

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [cfg, setCfg] = useState<PromptConfig>(DEFAULT_CFG);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [guide, setGuide] = useState<"html" | "wordpress" | "shopify" | "hosted">("html");
  const [hostedDomain, setHostedDomain] = useState("");
  const [hostedBusy, setHostedBusy] = useState(false);
  const [hostedResult, setHostedResult] = useState<any>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mac" | "tablet" | "android" | "iphone">("desktop");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  // free drag: drop near the top/bottom edge → classic bar; anywhere else →
  // floating banner anchored exactly where it was dropped (viewport %)
  function startBannerDrag(e: React.MouseEvent) {
    e.preventDefault();
    const pct = (ev: MouseEvent) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: clamp(((ev.clientX - rect.left) / rect.width) * 100, 4, 96),
        y: clamp(((ev.clientY - rect.top) / rect.height) * 100, 4, 96),
      };
    };
    const move = (ev: MouseEvent) => {
      const p = pct(ev);
      if (p) setDragPos(p);
    };
    const up = (ev: MouseEvent) => {
      const p = pct(ev);
      if (p) {
        setCfg((c) => ({
          ...c,
          style: {
            ...c.style,
            ...(p.y < 15
              ? { position: "top" }
              : p.y > 85
                ? { position: "bottom" }
                : { position: "float", x: Math.round(p.x), y: Math.round(p.y) }),
          },
        }));
      }
      setDragPos(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const legacyScale = { compact: 0.85, normal: 1, large: 1.15 } as const;
  const bannerScale =
    cfg.style.scale ?? legacyScale[(cfg.style.size ?? "normal") as keyof typeof legacyScale] ?? 1;
  function stepScale(dir: 1 | -1) {
    setCfg({
      ...cfg,
      style: { ...cfg.style, scale: +clamp(bannerScale + dir * 0.1, 0.7, 1.5).toFixed(2) },
    });
  }

  const load = useCallback(() => {
    api<Property>(`/properties/${id}`).then((p) => {
      setProperty(p);
      setCfg({ ...DEFAULT_CFG, ...p.promptConfig,
        trigger: { ...DEFAULT_CFG.trigger, ...p.promptConfig?.trigger },
        pages: { ...DEFAULT_CFG.pages, ...p.promptConfig?.pages },
        text: { ...DEFAULT_CFG.text, ...p.promptConfig?.text },
        style: { ...DEFAULT_CFG.style, ...p.promptConfig?.style },
        reask: {
          ...DEFAULT_CFG.reask,
          ...p.promptConfig?.reask,
          // migrate legacy cooldown_days into value/unit
          cooldown_value:
            p.promptConfig?.reask?.cooldown_value ?? p.promptConfig?.reask?.cooldown_days ?? 7,
          cooldown_unit: p.promptConfig?.reask?.cooldown_unit ?? "days",
        },
      });
    }).catch((e) => setError(e.message));
    api<PageRow[]>(`/properties/${id}/pages`).then(setPages).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  async function verify() {
    setVerifying(true);
    setMsg("");
    try {
      const res = await api<{ verified: boolean }>(`/properties/${id}/verify`, { method: "POST" });
      setMsg(res.verified ? "✅ Installation verified on all domains" : "❌ pv-sw.js not found — see results below");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  }

  async function saveConfig(next?: PromptConfig) {
    setSaving(true);
    setMsg("");
    try {
      await api(`/properties/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ promptConfig: next ?? cfg }),
      });
      setMsg("Prompt configuration saved — live within 1h (snippet config cache), immediately for new visitors");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function togglePage(page: PageRow) {
    const toRegex = (glob: string) =>
      new RegExp(
        "^" + glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
      );
    let exclude = [...cfg.pages.exclude];
    let include = [...(cfg.pages.include?.length ? cfg.pages.include : ["*"])];
    if (page.allowed) {
      // Block: add an exact exclude for this page
      if (!exclude.includes(page.path)) exclude.push(page.path);
    } else {
      // Allow: drop the exact exclude AND any glob exclude that matches this
      // page; if include list is specific and doesn't cover it, add it.
      exclude = exclude.filter((g) => !toRegex(g).test(page.path));
      const covered = include.some((g) => g === "*" || toRegex(g).test(page.path));
      if (!covered) include.push(page.path);
    }
    const next = { ...cfg, pages: { ...cfg.pages, include, exclude } };
    setCfg(next);
    await saveConfig(next);
  }

  if (!property) return <div className="page-sub">{error || "Loading…"}</div>;

  const sizeScale = bannerScale;

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">
            <Link to="/properties" style={{ color: "var(--text-dim)" }}>Properties</Link> / {property.name}
          </div>
          <div className="page-sub">
            {property.domains.join(", ")} ·{" "}
            {property.verifiedAt ? (
              <span className="badge green">verified {new Date(property.verifiedAt).toLocaleDateString()}</span>
            ) : (
              <span className="badge amber">not verified</span>
            )}
          </div>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      {/* ---- 1. Install & verify ---- */}
      <div className="panel">
        <div className="flex-between">
          <h3>1 · Install &amp; verify</h3>
          <button className="btn secondary small" onClick={verify} disabled={verifying}>
            {verifying ? "Checking domains…" : "Verify installation"}
          </button>
        </div>
        <label>Property key (identifies this site to PushVault)</label>
        <div className="code-block">{property.propertyKey}</div>

        <div style={{ display: "flex", gap: 6, margin: "14px 0 4px" }}>
          {(["html", "wordpress", "shopify", "hosted"] as const).map((g) => (
            <button key={g} className={"btn small " + (guide === g ? "" : "secondary")} onClick={() => setGuide(g)}>
              {g === "html" ? "🌐 Any website" : g === "wordpress" ? "🅦 WordPress" : g === "shopify" ? "🛍 Shopify" : "✨ Hosted page"}
            </button>
          ))}
        </div>

        {guide === "html" && (
          <>
            <label>Step 1 — add the snippet to every page (before &lt;/body&gt;)</label>
            <div className="code-block">{property.install?.script}</div>
            <label>Step 2 — upload the key file to the website ROOT folder</label>
            <div className="code-block">
              {`Download: http://localhost:3000/cdn/pv-sw.js\nUpload to: https://${property.domains[0]}/pv-sw.js  (must be at the root)`}
            </div>
          </>
        )}
        {guide === "wordpress" && (
          <>
            <label>Step 1 — add the snippet via your theme (Appearance → Theme File Editor → footer.php, before &lt;/body&gt;) or a header/footer plugin like WPCode</label>
            <div className="code-block">{property.install?.script}</div>
            <label>Step 2 — upload pv-sw.js to the WordPress ROOT folder (where wp-config.php lives), via FTP or your host's file manager</label>
            <div className="code-block">
              {`Download: http://localhost:3000/cdn/pv-sw.js\nUpload to: /public_html/pv-sw.js  →  https://${property.domains[0]}/pv-sw.js`}
            </div>
            <div className="page-sub" style={{ marginBottom: 0 }}>
              Tip: some caching plugins (WP Rocket, LiteSpeed) exclude .js at root by default — no changes needed. If using Cloudflare, keep pv-sw.js cache TTL short.
            </div>
          </>
        )}
        {guide === "shopify" && (
          <>
            <label>Step 1 — Online Store → Themes → Edit code → layout/theme.liquid, paste before &lt;/body&gt;</label>
            <div className="code-block">{property.install?.script}</div>
            <label>Step 2 — Shopify cannot serve files at the domain root, so upload pv-sw.js via an app proxy or use Settings → Files + a redirect. Easiest supported route:</label>
            <div className="code-block">
              {`1. Settings → Apps → develop a tiny app proxy that serves /pv-sw.js, OR\n2. host pv-sw.js on your primary domain via your DNS provider's worker\n   (Cloudflare Worker route: ${property.domains[0]}/pv-sw.js)`}
            </div>
            <div className="page-sub" style={{ marginBottom: 0 }}>
              Note: web push requires the service worker on the SAME domain visitors browse. Shopify's asset CDN (cdn.shopify.com) does not qualify.
            </div>
          </>
        )}

        {guide === "hosted" && (() => {
          const base = (property.domains[0] || "yourdomain.com").replace(/^www\./, "");
          const suggested = `alerts.${base}`;
          const value = hostedDomain || suggested;
          const activate = async () => {
            setHostedBusy(true);
            setHostedResult(null);
            try {
              const r = await api(`/properties/${id}/hosted-domain`, {
                method: "POST",
                body: JSON.stringify({ domain: value }),
              });
              setHostedResult(r);
              if (r?.active) setProperty(await api(`/properties/${id}`));
            } catch (e: any) {
              setHostedResult({ active: false, message: e?.message || "Failed — try again." });
            } finally {
              setHostedBusy(false);
            }
          };
          return (
            <>
              <div className="page-sub">
                Best for site builders (Hostinger, Wix, Shopify) where you can't upload files. PushVault
                hosts a branded opt-in page (your prompt design) on a subdomain you own — no snippet, no file upload.
              </div>
              <label>Step 1 — in your DNS panel, point a subdomain at the PushVault server</label>
              <div className="code-block">{`Type: A    Name: ${value.split(".")[0]}    Points to: 192.255.142.123`}</div>
              <label>Step 2 — enter the subdomain and press Activate (checks DNS, registers it, issues HTTPS)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ flex: 1 }}
                  value={value}
                  onChange={(e) => setHostedDomain(e.target.value)}
                  placeholder={suggested}
                />
                <button className="btn" disabled={hostedBusy} onClick={activate}>
                  {hostedBusy ? "Checking…" : "⚡ Activate"}
                </button>
              </div>
              {hostedResult && (
                <div
                  className="page-sub"
                  style={{ marginTop: 10, color: hostedResult.active ? "#34d399" : "#fbbf24" }}
                >
                  {hostedResult.active ? "✅ " : "⏳ "}
                  {hostedResult.message}
                  {hostedResult.active && (
                    <>
                      {" "}Your opt-in page: <a href={hostedResult.url} target="_blank" rel="noreferrer" style={{ color: "#a78bfa" }}>{hostedResult.url}</a>
                    </>
                  )}
                </div>
              )}
              <label style={{ marginTop: 14 }}>Step 3 — link to it from your site</label>
              <div className="code-block">{`<a href="https://${value}/">🔔 Get alerts &amp; offers</a>`}</div>
              <div className="page-sub" style={{ marginBottom: 0 }}>
                Visitors who tap Enable become subscribers of this property — campaigns, drips and CDR
                work exactly the same. DNS changes can take a few minutes; just press Activate again.
              </div>
            </>
          );
        })()}

        <label>Revenue tracking (optional) — call after a completed order</label>
        <div className="code-block">
          {`window.PushVault.trackConversion({ amount: 1499, order_id: "ORD-1234", currency: "INR" });\n// or server-side: POST /api/v1/webhooks/conversion with X-Api-Key`}
        </div>

        <label>Push identity (VAPID)</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className={"badge " + ((property as any).vapidPublic ? "green" : "gray")}>
            {(property as any).vapidPublic ? "dedicated keys" : "platform shared keys"}
          </span>
          {!(property as any).vapidPublic && (
            <button
              className="btn secondary small"
              onClick={async () => {
                if (!confirm("Generate dedicated VAPID keys? Do this BEFORE collecting subscribers — existing subscribers would stop receiving pushes.")) return;
                await api(`/properties/${id}/generate-vapid`, { method: "POST" });
                setMsg("Dedicated VAPID keys generated");
                load();
              }}
            >
              Generate dedicated keys
            </button>
          )}
        </div>
        {property.verification && (
          <>
            <label>Last check — {new Date(property.verification.checkedAt).toLocaleString()}</label>
            <table>
              <tbody>
                {property.verification.results.map((r) => (
                  <tr key={r.domain}>
                    <td>{r.domain}</td>
                    <td>
                      <span className={"badge " + (r.ok ? "green" : "amber")}>
                        {r.ok ? "pv-sw.js found" : r.status ? `HTTP ${r.status}` : "unreachable"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ---- 2. Pages ---- */}
      <div className="panel">
        <h3>2 · Discovered pages — allow / block the prompt per page</h3>
        {pages.length === 0 ? (
          <div className="empty">
            No pages seen yet. Once the snippet is installed and visitors browse the site, every
            page appears here automatically.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Views</th>
                <th>Last seen</th>
                <th>Prompt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id}>
                  <td><span className="commit-hash">{p.path}</span></td>
                  <td>{p.views}</td>
                  <td style={{ fontSize: 12 }}>{new Date(p.lastSeenAt).toLocaleString()}</td>
                  <td>
                    <span className={"badge " + (p.allowed ? "green" : "gray")}>
                      {p.allowed ? "allowed" : "blocked"}
                    </span>
                  </td>
                  <td>
                    <button className="btn secondary small" onClick={() => togglePage(p)}>
                      {p.allowed ? "Block" : "Allow"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>
          Glob rules also apply — exclude patterns: {cfg.pages.exclude.length ? cfg.pages.exclude.join(", ") : "(none)"}
        </div>
      </div>

      {/* ---- 3. Prompt designer ---- */}
      <div className="panel">
        <h3>3 · Prompt designer — how the popup generates &amp; looks</h3>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <label>When does it appear? (trigger)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={cfg.trigger.type}
                onChange={(e) => setCfg({ ...cfg, trigger: { ...cfg.trigger, type: e.target.value } })}
                style={{ width: 180 }}
              >
                <option value="delay">After a delay</option>
                <option value="scroll">After scrolling</option>
                <option value="exit_intent">On exit intent</option>
              </select>
              {cfg.trigger.type === "delay" && (
                <input
                  type="number"
                  min={0}
                  style={{ width: 110 }}
                  value={cfg.trigger.seconds ?? 12}
                  onChange={(e) => setCfg({ ...cfg, trigger: { ...cfg.trigger, seconds: Number(e.target.value) } })}
                  placeholder="seconds"
                />
              )}
              {cfg.trigger.type === "scroll" && (
                <input
                  type="number"
                  min={1}
                  max={100}
                  style={{ width: 110 }}
                  value={cfg.trigger.percent ?? 40}
                  onChange={(e) => setCfg({ ...cfg, trigger: { ...cfg.trigger, percent: Number(e.target.value) } })}
                  placeholder="% scrolled"
                />
              )}
            </div>

            <label>Headline (what we write)</label>
            <input value={cfg.text.headline} onChange={(e) => setCfg({ ...cfg, text: { ...cfg.text, headline: e.target.value } })} />
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>Yes button</label>
                <input value={cfg.text.yes} onChange={(e) => setCfg({ ...cfg, text: { ...cfg.text, yes: e.target.value } })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>No button</label>
                <input value={cfg.text.no} onChange={(e) => setCfg({ ...cfg, text: { ...cfg.text, no: e.target.value } })} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ width: 190 }}>
                <label>Placement</label>
                <select value={cfg.style.position} onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, position: e.target.value } })}>
                  <option value="top">Bar — top of page</option>
                  <option value="bottom">Bar — bottom of page</option>
                  <option value="float">Floating — place anywhere</option>
                </select>
              </div>
              {cfg.style.position === "float" && (
                <>
                  <div style={{ width: 90 }}>
                    <label>X (%)</label>
                    <input type="number" min={4} max={96} value={cfg.style.x ?? 50}
                      onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, x: clamp(Number(e.target.value), 4, 96) } })} />
                  </div>
                  <div style={{ width: 90 }}>
                    <label>Y (%)</label>
                    <input type="number" min={4} max={96} value={cfg.style.y ?? 50}
                      onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, y: clamp(Number(e.target.value), 4, 96) } })} />
                  </div>
                </>
              )}
              <div style={{ width: 110 }}>
                <label>Width (px)</label>
                <input type="number" min={220} max={900} step={10} value={cfg.style.width ?? 460}
                  onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, width: clamp(Number(e.target.value), 220, 900) } })} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 4 }}>
              <div style={{ width: 170 }}>
                <label>Size scale — {bannerScale.toFixed(2)}×</label>
                <input type="range" min={0.7} max={1.5} step={0.05} value={bannerScale}
                  style={{ padding: 0, height: 28 }}
                  onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, scale: Number(e.target.value) } })} />
              </div>
              <div style={{ width: 170 }}>
                <label>Corner radius — {cfg.style.radius ?? 12}px</label>
                <input type="range" min={0} max={28} step={1} value={cfg.style.radius ?? 12}
                  style={{ padding: 0, height: 28 }}
                  onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, radius: Number(e.target.value) } })} />
              </div>
              <div style={{ width: 120 }}>
                <label>Shadow</label>
                <select value={cfg.style.shadow ?? "soft"} onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, shadow: e.target.value } })}>
                  <option value="none">None</option>
                  <option value="soft">Soft</option>
                  <option value="strong">Strong</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 4 }}>
              <div style={{ width: 130 }}>
                <label>Theme</label>
                <select
                  value={cfg.style.theme ?? "light"}
                  onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, theme: e.target.value, bg: "", text_color: "" } })}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div style={{ width: 110 }}>
                <label>Background</label>
                <input type="color" style={{ padding: 2, height: 38 }}
                  value={cfg.style.bg || (cfg.style.theme === "dark" ? "#20212b" : "#ffffff")}
                  onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, bg: e.target.value } })} />
              </div>
              <div style={{ width: 110 }}>
                <label>Text color</label>
                <input type="color" style={{ padding: 2, height: 38 }}
                  value={cfg.style.text_color || (cfg.style.theme === "dark" ? "#f0f0f5" : "#1a1a2a")}
                  onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, text_color: e.target.value } })} />
              </div>
              <div style={{ width: 110 }}>
                <label>Accent color</label>
                <input type="color" value={cfg.style.accent} style={{ padding: 2, height: 38 }} onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, accent: e.target.value } })} />
              </div>
            </div>

            <label>Logo URL (optional)</label>
            <input value={cfg.style.logo ?? ""} placeholder="https://…" onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, logo: e.target.value || null } })} />

            <label>Re-ask after "No"</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={cfg.reask.enabled ? "yes" : "no"}
                style={{ width: 140 }}
                onChange={(e) => setCfg({ ...cfg, reask: { ...cfg.reask, enabled: e.target.value === "yes" } })}
              >
                <option value="no">Never re-ask</option>
                <option value="yes">Re-ask after</option>
              </select>
              {cfg.reask.enabled && (
                <>
                  <input
                    type="number"
                    min={1}
                    style={{ width: 90 }}
                    value={cfg.reask.cooldown_value ?? 7}
                    onChange={(e) => setCfg({ ...cfg, reask: { ...cfg.reask, cooldown_value: Number(e.target.value) } })}
                  />
                  <select
                    style={{ width: 130 }}
                    value={cfg.reask.cooldown_unit ?? "days"}
                    onChange={(e) => setCfg({ ...cfg, reask: { ...cfg.reask, cooldown_unit: e.target.value as any } })}
                  >
                    <option value="seconds">seconds</option>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                </>
              )}
            </div>

            <button className="btn" style={{ marginTop: 20 }} onClick={() => saveConfig()} disabled={saving}>
              {saving ? "Saving…" : "Save prompt settings"}
            </button>
          </div>

          {/* live preview — realistic browser/phone mockups */}
          <div style={{ width: 480 }}>
            <div className="flex-between">
              <label>Live preview — how visitors see it on {property.domains[0]}</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {([
                  ["desktop", "🖥 Windows"],
                  ["mac", "🍎 Mac"],
                  ["tablet", "📲 Tablet"],
                  ["android", "🤖 Android"],
                  ["iphone", "📱 iPhone"],
                ] as const).map(([key, label]) => (
                  <button key={key} type="button" className={"btn small " + (previewDevice === key ? "" : "secondary")} onClick={() => setPreviewDevice(key)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const banner = (scale: number) => {
                const dark = cfg.style.theme === "dark";
                const bg = cfg.style.bg || (dark ? "#20212b" : "#ffffff");
                const textColor = cfg.style.text_color || (dark ? "#f0f0f5" : "#1a1a2a");
                const radius = cfg.style.radius ?? 12;
                const shadowCss =
                  cfg.style.shadow === "none"
                    ? "none"
                    : cfg.style.shadow === "strong"
                      ? "0 12px 40px rgba(0,0,0,.42)"
                      : "0 4px 20px rgba(0,0,0,.25)";
                const isFloat = cfg.style.position === "float";
                // mockup is a shrunken page, so the configured px width is scaled down
                const widthFactor =
                  previewDevice === "desktop" || previewDevice === "mac" ? 0.45 : previewDevice === "tablet" ? 0.62 : 0.8;
                const widthPx = Math.round((cfg.style.width ?? 460) * widthFactor);
                const s = scale * sizeScale;
                const place: React.CSSProperties =
                  dragPos !== null
                    ? { left: `${dragPos.x}%`, top: `${dragPos.y}%`, transform: "translate(-50%,-50%)", width: widthPx, maxWidth: "92%" }
                    : isFloat
                      ? { left: `${cfg.style.x ?? 50}%`, top: `${cfg.style.y ?? 50}%`, transform: "translate(-50%,-50%)", width: widthPx, maxWidth: "92%" }
                      : cfg.style.position === "bottom"
                        ? { left: 8, right: 8, bottom: 8, maxWidth: widthPx, margin: "0 auto" }
                        : { left: 8, right: 8, top: 8, maxWidth: widthPx, margin: "0 auto" };
                const noBg = dark ? "#34353f" : "#f5f5f7";
                const noColor = dark ? "#d5d5dd" : "#333";
                const noBorder = dark ? "#4a4b55" : "#ddd";
                const btnRadius = Math.max(3, Math.round(radius * 0.6));
                return (
                  <div
                    onMouseDown={startBannerDrag}
                    title="Drag me anywhere — dropping near the top/bottom edge makes it a bar"
                    style={{
                      position: "absolute",
                      cursor: dragPos !== null ? "grabbing" : "grab",
                      userSelect: "none",
                      outline: dragPos !== null ? `2px dashed ${cfg.style.accent}` : undefined,
                      outlineOffset: 3,
                      ...place,
                      display: "flex",
                      alignItems: "center",
                      gap: 8 * s,
                      flexWrap: "wrap",
                      background: bg,
                      color: textColor,
                      borderRadius: radius,
                      padding: `${9 * s}px ${12 * s}px`,
                      boxShadow: shadowCss,
                      fontSize: 11.5 * s,
                      zIndex: 5,
                    }}
                  >
                    {cfg.style.logo && <img src={cfg.style.logo} style={{ width: 20 * s, height: 20 * s, borderRadius: 5, objectFit: "cover" }} />}
                    <span style={{ flex: 1, fontWeight: 600, minWidth: 80 }}>{cfg.text.headline || "Get notified?"}</span>
                    <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      <span style={{ background: cfg.style.accent, color: "#fff", borderRadius: btnRadius, padding: `${5 * s}px ${9 * s}px`, fontWeight: 600, whiteSpace: "nowrap" }}>{cfg.text.yes || "Yes"}</span>
                      <span style={{ background: noBg, color: noColor, border: `1px solid ${noBorder}`, borderRadius: btnRadius, padding: `${5 * s}px ${9 * s}px`, fontWeight: 600, whiteSpace: "nowrap" }}>{cfg.text.no || "No"}</span>
                      <span style={{ color: "#999", padding: `${5 * s}px 3px` }}>✕</span>
                    </span>
                  </div>
                );
              };

              const chip = (label: string, onClick: () => void, active = false, tip = "") => (
                <button
                  type="button"
                  title={tip}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={onClick}
                  style={{
                    background: active ? cfg.style.accent : "rgba(20,20,28,.85)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );

              // on-screen placement + resize controls, overlaid on the mockup
              const overlayControls = (
                <div style={{ position: "absolute", top: 6, right: 6, zIndex: 10, display: "flex", gap: 4 }}>
                  {chip("▲", () => setCfg({ ...cfg, style: { ...cfg.style, position: "top" } }), cfg.style.position === "top", "Top bar")}
                  {chip("◎", () => setCfg({ ...cfg, style: { ...cfg.style, position: "float", x: 50, y: 50 } }), cfg.style.position === "float", "Float — center (then drag anywhere)")}
                  {chip("▼", () => setCfg({ ...cfg, style: { ...cfg.style, position: "bottom" } }), cfg.style.position === "bottom", "Bottom bar")}
                  {chip("A−", () => stepScale(-1), false, "Smaller banner")}
                  {chip("A+", () => stepScale(1), false, "Bigger banner")}
                </div>
              );

              const pageSkeleton = (
                <>
                  {/* fake store page */}
                  <div style={{ background: "#10213f", height: 26, display: "flex", alignItems: "center", padding: "0 10px", gap: 8 }}>
                    <span style={{ color: "#fff", fontSize: 9, fontWeight: 700 }}>⚡ {property.name}</span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      {[24, 30, 26].map((w, i) => <span key={i} style={{ width: w, height: 5, borderRadius: 3, background: "rgba(255,255,255,.35)" }} />)}
                    </span>
                  </div>
                  <div style={{ background: "linear-gradient(120deg,#10213f,#2b4a8b)", padding: "14px 10px", textAlign: "center" }}>
                    <div style={{ width: "55%", height: 9, borderRadius: 4, background: "rgba(255,255,255,.85)", margin: "0 auto" }} />
                    <div style={{ width: "38%", height: 6, borderRadius: 3, background: "rgba(255,255,255,.4)", margin: "7px auto 0" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7, padding: 10 }}>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <div key={i} style={{ background: "#fff", border: "1px solid #e5e5ea", borderRadius: 6, overflow: "hidden" }}>
                        <div style={{ height: 26, background: "#eef0f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{["🎧", "⌚", "🔊", "📷", "🖱️", "⌨️"][i]}</div>
                        <div style={{ padding: 5 }}>
                          <div style={{ width: "80%", height: 4, borderRadius: 2, background: "#d9dce3" }} />
                          <div style={{ width: "45%", height: 4, borderRadius: 2, background: "#c3c9d4", marginTop: 4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );

              // -------- desktop browsers: Windows Chrome (dark) / Mac Safari-ish (light) --------
              if (previewDevice === "desktop" || previewDevice === "mac") {
                const isMac = previewDevice === "mac";
                const chromeBg = isMac ? "#e9e9ee" : "#202124";
                const barBg = isMac ? "#f6f6f8" : "#35363a";
                const pillBg = isMac ? "#e3e3ea" : "#202124";
                const fg = isMac ? "#333" : "#ddd";
                const dim = isMac ? "#8a8a92" : "#aaa";
                return (
                  <div style={{ borderRadius: 10, overflow: "hidden", border: isMac ? "1px solid #c8c8d0" : "1px solid #333", boxShadow: "0 14px 40px rgba(0,0,0,.4)", marginTop: 10 }}>
                    {/* browser chrome */}
                    <div style={{ background: chromeBg, padding: "6px 10px 0", display: "flex", gap: 6, alignItems: "flex-end" }}>
                      <span style={{ display: "flex", gap: 5, paddingBottom: 8, paddingRight: 4 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff5f57" }} />
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#febc2e" }} />
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#28c840" }} />
                      </span>
                      <div style={{ background: barBg, color: fg, borderRadius: "8px 8px 0 0", padding: "5px 14px", fontSize: 10, display: "flex", gap: 6, alignItems: "center" }}>
                        <span>⚡</span> {property.name}
                        <span style={{ color: dim, marginLeft: 8 }}>✕</span>
                      </div>
                      {isMac && <span style={{ marginLeft: "auto", color: dim, fontSize: 9, paddingBottom: 8 }}> macOS</span>}
                    </div>
                    <div style={{ background: barBg, padding: "5px 10px", display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: dim, fontSize: 11 }}>← → ⟳</span>
                      <div style={{ flex: 1, background: pillBg, borderRadius: 999, padding: "4px 12px", fontSize: 10, color: fg, textAlign: isMac ? "center" : "left" }}>
                        🔒 {property.domains[0]}
                      </div>
                    </div>
                    {/* viewport */}
                    <div ref={viewportRef} style={{ position: "relative", background: "#fafafa", height: 250, overflow: "hidden" }}>
                      {pageSkeleton}
                      {banner(1)}
                      {overlayControls}
                    </div>
                  </div>
                );
              }

              // -------- tablet (iPad-style portrait) --------
              if (previewDevice === "tablet") {
                return (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                    <div style={{ width: 330, height: 430, borderRadius: 22, border: "11px solid #1a1a1e", background: "#fafafa", position: "relative", overflow: "hidden", boxShadow: "0 16px 44px rgba(0,0,0,.45)", display: "flex", flexDirection: "column" }}>
                      <div style={{ background: "#202124", padding: "6px 12px 6px", flexShrink: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", color: "#ccc", fontSize: 8, marginBottom: 4 }}>
                          <span>9:41 · Tue 14 Jul</span>
                          <span>📶 82% 🔋</span>
                        </div>
                        <div style={{ background: "#35363a", borderRadius: 999, padding: "4px 12px", fontSize: 9, color: "#ccc", textAlign: "center" }}>
                          🔒 {property.domains[0]}
                        </div>
                      </div>
                      <div ref={viewportRef} style={{ position: "relative", flex: 1, overflow: "hidden" }}>
                        {pageSkeleton}
                        {banner(0.96)}
                        {overlayControls}
                      </div>
                      <div style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 110, height: 4, borderRadius: 2, background: "rgba(0,0,0,.3)", zIndex: 20 }} />
                    </div>
                  </div>
                );
              }

              // -------- phones: Android (punch-hole) / iPhone (dynamic island, Safari) --------
              const isIphone = previewDevice === "iphone";
              return (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                  <div style={{ width: 240, height: 470, borderRadius: isIphone ? 36 : 30, border: "8px solid #1c1e22", background: "#fafafa", position: "relative", overflow: "hidden", boxShadow: "0 16px 44px rgba(0,0,0,.45)", display: "flex", flexDirection: "column" }}>
                    {/* mobile browser bar */}
                    <div style={{ background: "#202124", padding: "6px 10px 6px", flexShrink: 0, position: "relative" }}>
                      {isIphone ? (
                        <div style={{ position: "absolute", top: 5, left: "50%", transform: "translateX(-50%)", width: 74, height: 16, borderRadius: 10, background: "#000" }} />
                      ) : (
                        <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, borderRadius: "50%", background: "#000" }} />
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", color: "#ccc", fontSize: 8, marginBottom: 5, paddingTop: isIphone ? 14 : 8 }}>
                        <span>9:41</span>
                        <span>📶 🔋</span>
                      </div>
                      <div style={{ background: "#35363a", borderRadius: 999, padding: "4px 10px", fontSize: 9, color: "#ccc", textAlign: isIphone ? "center" : "left" }}>
                        {isIphone ? "🔒 " + property.domains[0] + "  ↻" : "🔒 " + property.domains[0]}
                      </div>
                    </div>
                    {/* viewport: its own box so a bottom-placed banner stays fully visible */}
                    <div ref={viewportRef} style={{ position: "relative", flex: 1, overflow: "hidden" }}>
                      {pageSkeleton}
                      {banner(0.92)}
                      {overlayControls}
                    </div>
                    <div style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 80, height: 4, borderRadius: 2, background: isIphone ? "rgba(0,0,0,.55)" : "rgba(0,0,0,.3)", zIndex: 20 }} />
                  </div>
                </div>
              );
            })()}

            <div className="preview-note" style={{ maxWidth: "100%", textAlign: "center" }}>
              ✋ <b>Drag the banner anywhere</b> — the middle floats it exactly there, near the top/bottom edge
              makes it a bar. Chips: ▲ ◎ ▼ place, A− A+ resize.
              Appears{" "}
              {cfg.trigger.type === "delay"
                ? `${cfg.trigger.seconds ?? 12}s after page load`
                : cfg.trigger.type === "scroll"
                  ? `after scrolling ${cfg.trigger.percent ?? 40}%`
                  : "on exit intent"}{" "}
              ·{" "}
              {cfg.style.position === "float"
                ? `floating at ${cfg.style.x ?? 50}% / ${cfg.style.y ?? 50}%`
                : `${cfg.style.position} bar`}{" "}
              · scale {bannerScale.toFixed(2)}× · never blocks the page content.
              Remember to hit <b>Save prompt settings</b>.
            </div>
          </div>
        </div>
      </div>

      {/* ---- 4. frequency caps ---- */}
      <div className="panel">
        <h3>4 · Frequency caps</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div>
            <label>Max pushes / day</label>
            <input
              type="number"
              min={0}
              style={{ width: 120 }}
              defaultValue={property.frequencyCapPerDay}
              id="capDay"
            />
          </div>
          <div>
            <label>Max pushes / week</label>
            <input
              type="number"
              min={0}
              style={{ width: 120 }}
              defaultValue={property.frequencyCapPerWeek}
              id="capWeek"
            />
          </div>
          <button
            className="btn secondary"
            disabled={saving}
            onClick={async () => {
              const day = Number((document.getElementById("capDay") as HTMLInputElement).value);
              const week = Number((document.getElementById("capWeek") as HTMLInputElement).value);
              await api(`/properties/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ frequencyCapPerDay: day, frequencyCapPerWeek: week }),
              });
              setMsg("Frequency caps saved");
              load();
            }}
          >
            Save caps
          </button>
        </div>
      </div>
    </>
  );
}
