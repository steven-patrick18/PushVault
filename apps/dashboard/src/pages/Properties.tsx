import { useEffect, useState } from "react";
import { api } from "../api";

interface Property {
  id: string;
  name: string;
  propertyKey: string;
  domains: string[];
  status: string;
  frequencyCapPerDay: number;
  frequencyCapPerWeek: number;
  createdAt: string;
  apiKey?: string;
  install?: { script: string; serviceWorker: string };
}

export default function Properties() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<Property | null>(null);
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Property | null>(null);

  const load = () => api<Property[]>("/properties").then(setProperties).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<Property>("/properties", {
        method: "POST",
        body: JSON.stringify({
          name,
          domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
        }),
      });
      setCreated(res);
      setShowCreate(false);
      setName("");
      setDomains("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    const res = await api<Property>(`/properties/${id}`);
    setDetail(res);
  }

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Properties</div>
          <div className="page-sub">Client websites connected to PushVault</div>
        </div>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + New property
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="panel">
        {properties.length === 0 ? (
          <div className="empty">No properties yet. Create your first one.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Domains</th>
                <th>Property key</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.domains.join(", ")}</td>
                  <td>
                    <span className="commit-hash">{p.propertyKey.slice(0, 16)}…</span>
                  </td>
                  <td>
                    <span className={"badge " + (p.status === "active" ? "green" : "gray")}>
                      {p.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn secondary small" onClick={() => openDetail(p.id)}>
                      Install code
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={create}>
            <h2>New property</h2>
            <p className="page-sub">A property is one client website.</p>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Store" autoFocus />
            <label>Domains (comma-separated)</label>
            <input
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="acme.com, www.acme.com"
            />
            {error && <div className="error-msg">{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn" disabled={busy}>
                {busy ? "Creating..." : "Create property"}
              </button>
              <button type="button" className="btn secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {created && (
        <div className="modal-backdrop" onClick={() => setCreated(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{created.name} created ✅</h2>
            <label>API key — shown only once, store it safely</label>
            <div className="code-block">{created.apiKey}</div>
            <label>Install snippet</label>
            <div className="code-block">{created.install?.script}</div>
            <label>Service worker</label>
            <div className="code-block">{created.install?.serviceWorker}</div>
            <button className="btn" style={{ marginTop: 16 }} onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{detail.name}</h2>
            <label>Property key</label>
            <div className="code-block">{detail.propertyKey}</div>
            <label>Install snippet</label>
            <div className="code-block">{detail.install?.script}</div>
            <label>Service worker</label>
            <div className="code-block">{detail.install?.serviceWorker}</div>
            <label>Frequency caps</label>
            <div className="page-sub">
              {detail.frequencyCapPerDay}/day · {detail.frequencyCapPerWeek}/week
            </div>
            <button className="btn" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
