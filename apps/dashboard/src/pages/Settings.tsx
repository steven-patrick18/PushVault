import { useEffect, useState } from "react";
import { api } from "../api";

interface Tenant {
  id: string;
  name: string;
  brandName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  plan: string;
}

interface User {
  id: string;
  email: string;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  user: string;
  at: string;
}

interface Billing {
  plan: string;
  planLabel: string;
  quota: number | null;
  used: number;
  remaining: number | null;
  resetsAt: string;
  plans: { key: string; label: string; quota: number | null }[];
  stripeConfigured: boolean;
  rates: { per_send: number; per_click: number; currency: string };
  spend: { sent: number; clicked: number; sendCost: number; clickCost: number; total: number };
}

export default function Settings() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "manager", propertyIds: [] as string[] });
  const [rates, setRates] = useState({ per_send: "0", per_click: "0", currency: "INR" });
  const [gads, setGads] = useState<any>(null);
  const [gadsSaving, setGadsSaving] = useState(false);

  const load = () => {
    api<Tenant>("/tenant").then(setTenant).catch((e) => setError(e.message));
    api<User[]>("/users").then(setUsers).catch(() => {});
    api<AuditRow[]>("/audit").then(setAudit).catch(() => {});
    api<Billing>("/billing").then((b) => {
      setBilling(b);
      setRates({
        per_send: String(b.rates.per_send),
        per_click: String(b.rates.per_click),
        currency: b.rates.currency,
      });
    }).catch(() => {});
    api<{ id: string; name: string }[]>("/properties").then(setProperties).catch(() => {});
    api("/google-ads/config").then(setGads).catch(() => {});
  };
  useEffect(load, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/users", { method: "POST", body: JSON.stringify(newUser) });
      setShowAddUser(false);
      setNewUser({ email: "", password: "", role: "manager", propertyIds: [] });
      setMsg("User created");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function removeUser(id: string) {
    if (!confirm("Remove this user?")) return;
    await api(`/users/${id}`, { method: "DELETE" });
    load();
  }

  async function changePlan(plan: string) {
    await api("/tenant", { method: "PATCH", body: JSON.stringify({ plan }) });
    setMsg(`Plan changed to ${plan}`);
    load();
  }

  async function save() {
    if (!tenant) return;
    setSaving(true);
    setMsg("");
    try {
      await api("/tenant", {
        method: "PATCH",
        body: JSON.stringify({
          brandName: tenant.brandName ?? undefined,
          brandLogoUrl: tenant.brandLogoUrl ?? undefined,
          brandPrimaryColor: tenant.brandPrimaryColor ?? undefined,
        }),
      });
      setMsg("Branding saved");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-title">Settings</div>
      <div className="page-sub">Workspace branding and team</div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      <div className="panel">
        <h3>White-label branding</h3>
        {tenant && (
          <div style={{ maxWidth: 460 }}>
            <label>Brand name (shown in the dashboard)</label>
            <input
              value={tenant.brandName ?? ""}
              onChange={(e) => setTenant({ ...tenant, brandName: e.target.value })}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Logo URL</label>
                <input
                  value={tenant.brandLogoUrl ?? ""}
                  placeholder="https://…"
                  onChange={(e) => setTenant({ ...tenant, brandLogoUrl: e.target.value })}
                />
              </div>
              <div style={{ width: 130 }}>
                <label>Primary color</label>
                <input
                  type="color"
                  style={{ padding: 2, height: 38 }}
                  value={tenant.brandPrimaryColor ?? "#7C3AED"}
                  onChange={(e) => setTenant({ ...tenant, brandPrimaryColor: e.target.value })}
                />
              </div>
            </div>
            <button className="btn" style={{ marginTop: 16 }} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save branding"}
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Plan &amp; usage</h3>
        {billing && (
          <>
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <span className="badge purple">{billing.planLabel}</span>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                resets {new Date(billing.resetsAt).toLocaleDateString()}
              </span>
            </div>
            <div style={{ height: 10, background: "var(--bg-elevated)", borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
              <div
                style={{
                  height: "100%",
                  width: billing.quota ? `${Math.min((billing.used / billing.quota) * 100, 100)}%` : "4%",
                  background: billing.quota && billing.used / billing.quota > 0.9 ? "var(--red)" : "var(--accent)",
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14 }}>
              {billing.used.toLocaleString()} pushes used this month
              {billing.quota !== null && <> of {billing.quota.toLocaleString()} ({billing.remaining!.toLocaleString()} left)</>}
              {billing.quota === null && <> — unlimited</>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {billing.plans.map((p) => (
                <button
                  key={p.key}
                  className={"btn small " + (p.key === billing.plan ? "" : "secondary")}
                  onClick={() => changePlan(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>
              {billing.stripeConfigured
                ? "Stripe connected — checkout enabled."
                : "Self-serve payments are stubbed: set STRIPE_SECRET_KEY to enable Stripe checkout. Plan changes here are unmetered (dev mode). Quotas ARE enforced on sends."}
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h3>Pay-per-use rates &amp; spend (CDR billing)</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label>Rate per push sent</label>
            <input type="number" min={0} step="0.01" style={{ width: 140 }} value={rates.per_send}
              onChange={(e) => setRates({ ...rates, per_send: e.target.value })} />
          </div>
          <div>
            <label>Rate per click (pay-per-click)</label>
            <input type="number" min={0} step="0.01" style={{ width: 140 }} value={rates.per_click}
              onChange={(e) => setRates({ ...rates, per_click: e.target.value })} />
          </div>
          <div>
            <label>Currency</label>
            <input style={{ width: 90 }} value={rates.currency} maxLength={3}
              onChange={(e) => setRates({ ...rates, currency: e.target.value.toUpperCase() })} />
          </div>
          <button
            className="btn secondary"
            onClick={async () => {
              await api("/tenant", {
                method: "PATCH",
                body: JSON.stringify({
                  billingRates: {
                    per_send: Number(rates.per_send) || 0,
                    per_click: Number(rates.per_click) || 0,
                    currency: rates.currency || "INR",
                  },
                }),
              });
              setMsg("Billing rates saved");
              load();
            }}
          >
            Save rates
          </button>
        </div>
        {billing && (
          <div style={{ marginTop: 14, fontSize: 13 }}>
            <span className="badge green">
              This month: {billing.rates.currency} {billing.spend.total.toLocaleString()}
            </span>
            <span style={{ color: "var(--text-dim)", marginLeft: 10 }}>
              = {billing.spend.sent.toLocaleString()} sends × {billing.rates.per_send} + {billing.spend.clicked.toLocaleString()} clicks × {billing.rates.per_click}
            </span>
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>
          Every campaign has a CDR (per-lead record with cost) on its page — export as CSV for invoicing clients.
        </div>
      </div>

      <div className="panel">
        <div className="flex-between">
          <h3>📢 Google Ads integration</h3>
          <span className={"badge " + (gads?.connected ? "green" : "gray")}>
            {gads?.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="page-sub">
          Connect once here; then every property gets a "Google norms" compliance check and a
          create-ad-campaign panel. Get credentials at{" "}
          <a href="https://developers.google.com/google-ads/api/docs/get-started/introduction" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            Google Ads API get-started
          </a>{" "}
          (developer token from your MCC → API Center; OAuth client + refresh token from Google Cloud Console).
        </div>
        {gads && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>Developer token</label>
                <input value={gads.developerToken ?? ""} placeholder="from MCC → API Center"
                  onChange={(e) => setGads({ ...gads, developerToken: e.target.value })} />
              </div>
              <div>
                <label>Customer ID (the ad account, e.g. 123-456-7890)</label>
                <input value={gads.customerId ?? ""} placeholder="1234567890"
                  onChange={(e) => setGads({ ...gads, customerId: e.target.value })} />
              </div>
              <div>
                <label>OAuth client ID</label>
                <input value={gads.clientId ?? ""} placeholder="xxx.apps.googleusercontent.com"
                  onChange={(e) => setGads({ ...gads, clientId: e.target.value })} />
              </div>
              <div>
                <label>OAuth client secret</label>
                <input value={gads.clientSecret ?? ""} placeholder="GOCSPX-…"
                  onChange={(e) => setGads({ ...gads, clientSecret: e.target.value })} />
              </div>
              <div>
                <label>Refresh token</label>
                <input value={gads.refreshToken ?? ""} placeholder="1//…"
                  onChange={(e) => setGads({ ...gads, refreshToken: e.target.value })} />
              </div>
              <div>
                <label>Manager (MCC) ID — only if the account is under a manager</label>
                <input value={gads.loginCustomerId ?? ""} placeholder="optional"
                  onChange={(e) => setGads({ ...gads, loginCustomerId: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn" disabled={gadsSaving} onClick={async () => {
                setGadsSaving(true); setError(""); setMsg("");
                try {
                  const r = await api("/google-ads/config", { method: "PUT", body: JSON.stringify(gads) });
                  setGads(r);
                  setMsg("Google Ads connected — open any property to run the compliance check or create ads.");
                } catch (e: any) { setError(e.message); } finally { setGadsSaving(false); }
              }}>
                {gadsSaving ? "Saving…" : gads.connected ? "Update credentials" : "Connect Google Ads"}
              </button>
              {gads.connected && (
                <button className="btn secondary" onClick={async () => {
                  if (!confirm("Disconnect Google Ads? Stored credentials will be deleted.")) return;
                  await api("/google-ads/config", { method: "DELETE" });
                  load();
                }}>
                  Disconnect
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="flex-between">
          <h3>Team</h3>
          <button className="btn secondary small" onClick={() => setShowAddUser(true)}>+ Add user</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Last login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <span className="badge purple">{u.role}</span>
                </td>
                <td style={{ fontSize: 12 }}>
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}
                </td>
                <td>
                  <button className="btn secondary small" onClick={() => removeUser(u.id)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddUser && (
        <div className="modal-backdrop" onClick={() => setShowAddUser(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={addUser}>
            <h2>Add user</h2>
            <label>Email</label>
            <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} autoFocus />
            <label>Password (min 8 chars)</label>
            <input type="text" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            <label>Role</label>
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="admin">Admin — full access</option>
              <option value="manager">Manager — full access, no user management</option>
              <option value="operator">Operator — run/pause campaigns + live reports only</option>
              <option value="client">Client — read-only portal, selected properties</option>
            </select>
            {newUser.role === "client" && (
              <>
                <label>Properties this client may view</label>
                {properties.map((p) => (
                  <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={newUser.propertyIds.includes(p.id)}
                      onChange={(e) =>
                        setNewUser({
                          ...newUser,
                          propertyIds: e.target.checked
                            ? [...newUser.propertyIds, p.id]
                            : newUser.propertyIds.filter((x) => x !== p.id),
                        })
                      }
                    />
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                  </div>
                ))}
              </>
            )}
            {error && <div className="error-msg">{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" disabled={!newUser.email || newUser.password.length < 8}>Create user</button>
              <button type="button" className="btn secondary" onClick={() => setShowAddUser(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <h3>API keys</h3>
        <div className="page-sub" style={{ marginBottom: 0 }}>
          Per-property API keys are managed on each property's page (rotate from there). Keys are
          stored hashed and shown only once at creation.
        </div>
      </div>

      <div className="panel">
        <h3>Audit log — last 100 actions</h3>
        {audit.length === 0 ? (
          <div className="empty">No audited actions yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity</th>
                <th>Who</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="commit-hash">{a.action}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {a.entityType}
                    {a.entityId && (
                      <span style={{ color: "var(--text-dim)" }}> · {a.entityId.slice(0, 8)}…</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{a.user}</td>
                  <td style={{ fontSize: 12 }}>{new Date(a.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
