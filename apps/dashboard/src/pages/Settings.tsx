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

export default function Settings() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [audit, setAudit] = useState<AuditRow[]>([]);

  useEffect(() => {
    api<Tenant>("/tenant").then(setTenant).catch((e) => setError(e.message));
    api<User[]>("/users").then(setUsers).catch(() => {});
    api<AuditRow[]>("/audit").then(setAudit).catch(() => {});
  }, []);

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
        <h3>Team</h3>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Last login</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
