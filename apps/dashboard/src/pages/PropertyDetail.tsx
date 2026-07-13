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
        <label>Step 1 — add the snippet to every page (before &lt;/body&gt;)</label>
        <div className="code-block">{property.install?.script}</div>
        <label>Step 2 — upload the key file to the website ROOT folder</label>
        <div className="code-block">
          {`Download: http://localhost:3000/cdn/pv-sw.js\nUpload to: https://${property.domains[0]}/pv-sw.js  (must be at the root)`}
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

          {/* live preview */}
          <div style={{ width: 340 }}>
            <label>Live preview</label>
            <div style={{ background: "#e8eaf0", borderRadius: 12, padding: "14px 10px", minHeight: 220, display: "flex", flexDirection: "column", justifyContent: cfg.style.position === "bottom" ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10 * sizeScale,
                  background: "#fff",
                  color: "#1a1a2a",
                  borderRadius: 12,
                  padding: `${12 * sizeScale}px ${16 * sizeScale}px`,
                  boxShadow: "0 4px 24px rgba(0,0,0,.18)",
                  fontSize: 14 * sizeScale,
                }}
              >
                {cfg.style.logo && <img src={cfg.style.logo} style={{ width: 28 * sizeScale, height: 28 * sizeScale, borderRadius: 6 }} />}
                <span style={{ flex: 1, fontWeight: 600 }}>{cfg.text.headline}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                <button style={{ background: cfg.style.accent, color: "#fff", border: "none", borderRadius: 8, padding: `${8 * sizeScale}px ${14 * sizeScale}px`, fontWeight: 600, fontSize: 13 * sizeScale }}>
                  {cfg.text.yes}
                </button>
                <button style={{ background: "#f5f5f7", color: "#333", border: "1px solid #ddd", borderRadius: 8, padding: `${8 * sizeScale}px ${14 * sizeScale}px`, fontWeight: 600, fontSize: 13 * sizeScale }}>
                  {cfg.text.no}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#667", marginTop: 12, textAlign: "center" }}>
                trigger:{" "}
                {cfg.trigger.type === "delay"
                  ? `${cfg.trigger.seconds ?? 12}s after load`
                  : cfg.trigger.type === "scroll"
                    ? `${cfg.trigger.percent ?? 40}% scrolled`
                    : "exit intent"}{" "}
                · {cfg.style.position} · {cfg.style.size ?? "normal"}
              </div>
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
