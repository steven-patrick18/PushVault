import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";

interface PromptConfig {
  trigger: { type: string; seconds?: number; percent?: number };
  pages: { include: string[]; exclude: string[] };
  text: { headline: string; yes: string; no: string };
  style: { position: string; accent: string; logo: string | null; size?: string };
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
  style: { position: "top", accent: "#7C3AED", logo: null, size: "normal" },
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
  const [guide, setGuide] = useState<"html" | "wordpress" | "shopify">("html");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

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
    const exclude = new Set(cfg.pages.exclude);
    if (page.allowed) exclude.add(page.path);
    else {
      exclude.delete(page.path);
      // also drop any glob that blocks it exactly
    }
    const next = { ...cfg, pages: { ...cfg.pages, exclude: [...exclude] } };
    setCfg(next);
    await saveConfig(next);
  }

  if (!property) return <div className="page-sub">{error || "Loading…"}</div>;

  const sizeScale = cfg.style.size === "compact" ? 0.85 : cfg.style.size === "large" ? 1.15 : 1;

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
          {(["html", "wordpress", "shopify"] as const).map((g) => (
            <button key={g} className={"btn small " + (guide === g ? "" : "secondary")} onClick={() => setGuide(g)}>
              {g === "html" ? "🌐 Any website" : g === "wordpress" ? "🅦 WordPress" : "🛍 Shopify"}
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

            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>Position</label>
                <select value={cfg.style.position} onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, position: e.target.value } })}>
                  <option value="top">Top of page</option>
                  <option value="bottom">Bottom of page</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Size</label>
                <select value={cfg.style.size ?? "normal"} onChange={(e) => setCfg({ ...cfg, style: { ...cfg.style, size: e.target.value } })}>
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div style={{ width: 120 }}>
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
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" className={"btn small " + (previewDevice === "desktop" ? "" : "secondary")} onClick={() => setPreviewDevice("desktop")}>🖥 Desktop</button>
                <button type="button" className={"btn small " + (previewDevice === "mobile" ? "" : "secondary")} onClick={() => setPreviewDevice("mobile")}>📱 Mobile</button>
              </div>
            </div>

            {(() => {
              const banner = (scale: number) => (
                <div
                  style={{
                    position: "absolute",
                    left: 8,
                    right: 8,
                    ...(cfg.style.position === "bottom" ? { bottom: 8 } : { top: previewDevice === "desktop" ? 8 : 42 }),
                    display: "flex",
                    alignItems: "center",
                    gap: 8 * scale,
                    flexWrap: "wrap",
                    background: "#fff",
                    color: "#1a1a2a",
                    borderRadius: 10,
                    padding: `${9 * scale * sizeScale}px ${12 * scale * sizeScale}px`,
                    boxShadow: "0 4px 20px rgba(0,0,0,.25)",
                    fontSize: 11.5 * scale * sizeScale,
                    zIndex: 5,
                  }}
                >
                  {cfg.style.logo && <img src={cfg.style.logo} style={{ width: 20 * scale * sizeScale, height: 20 * scale * sizeScale, borderRadius: 5, objectFit: "cover" }} />}
                  <span style={{ flex: 1, fontWeight: 600, minWidth: 90 }}>{cfg.text.headline || "Get notified?"}</span>
                  <span style={{ display: "flex", gap: 5 }}>
                    <span style={{ background: cfg.style.accent, color: "#fff", borderRadius: 7, padding: `${5 * scale * sizeScale}px ${9 * scale * sizeScale}px`, fontWeight: 600, whiteSpace: "nowrap" }}>{cfg.text.yes || "Yes"}</span>
                    <span style={{ background: "#f5f5f7", color: "#333", border: "1px solid #ddd", borderRadius: 7, padding: `${5 * scale * sizeScale}px ${9 * scale * sizeScale}px`, fontWeight: 600, whiteSpace: "nowrap" }}>{cfg.text.no || "No"}</span>
                    <span style={{ color: "#999", padding: `${5 * scale * sizeScale}px 3px` }}>✕</span>
                  </span>
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

              if (previewDevice === "desktop") {
                return (
                  <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #333", boxShadow: "0 14px 40px rgba(0,0,0,.4)", marginTop: 10 }}>
                    {/* browser chrome */}
                    <div style={{ background: "#202124", padding: "6px 10px 0", display: "flex", gap: 6, alignItems: "flex-end" }}>
                      <span style={{ display: "flex", gap: 5, paddingBottom: 8, paddingRight: 4 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff5f57" }} />
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#febc2e" }} />
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#28c840" }} />
                      </span>
                      <div style={{ background: "#35363a", color: "#ddd", borderRadius: "8px 8px 0 0", padding: "5px 14px", fontSize: 10, display: "flex", gap: 6, alignItems: "center" }}>
                        <span>⚡</span> {property.name}
                        <span style={{ color: "#888", marginLeft: 8 }}>✕</span>
                      </div>
                    </div>
                    <div style={{ background: "#35363a", padding: "5px 10px", display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: "#aaa", fontSize: 11 }}>← → ⟳</span>
                      <div style={{ flex: 1, background: "#202124", borderRadius: 999, padding: "4px 12px", fontSize: 10, color: "#ccc" }}>
                        🔒 {property.domains[0]}
                      </div>
                    </div>
                    {/* viewport */}
                    <div style={{ position: "relative", background: "#fafafa", height: 250, overflow: "hidden" }}>
                      {pageSkeleton}
                      {banner(1)}
                    </div>
                  </div>
                );
              }
              return (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                  <div style={{ width: 240, height: 470, borderRadius: 30, border: "8px solid #1c1e22", background: "#fafafa", position: "relative", overflow: "hidden", boxShadow: "0 16px 44px rgba(0,0,0,.45)" }}>
                    {/* mobile browser bar */}
                    <div style={{ background: "#202124", padding: "8px 10px 6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", color: "#ccc", fontSize: 8, marginBottom: 5 }}>
                        <span>9:41</span>
                        <span>📶 🔋</span>
                      </div>
                      <div style={{ background: "#35363a", borderRadius: 999, padding: "4px 10px", fontSize: 9, color: "#ccc" }}>
                        🔒 {property.domains[0]}
                      </div>
                    </div>
                    <div style={{ position: "relative", height: "100%" }}>
                      {pageSkeleton}
                      {banner(0.92)}
                    </div>
                    <div style={{ position: "absolute", bottom: 5, left: "50%", transform: "translateX(-50%)", width: 80, height: 4, borderRadius: 2, background: "rgba(0,0,0,.3)" }} />
                  </div>
                </div>
              );
            })()}

            <div className="preview-note" style={{ maxWidth: "100%", textAlign: "center" }}>
              Appears{" "}
              {cfg.trigger.type === "delay"
                ? `${cfg.trigger.seconds ?? 12}s after page load`
                : cfg.trigger.type === "scroll"
                  ? `after scrolling ${cfg.trigger.percent ?? 40}%`
                  : "on exit intent"}{" "}
              · {cfg.style.position} of page · size {cfg.style.size ?? "normal"} · never blocks the page content.
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
