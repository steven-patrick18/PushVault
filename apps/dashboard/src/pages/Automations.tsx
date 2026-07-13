import { useEffect, useState } from "react";
import { api, getUser } from "../api";

interface Step {
  delay_minutes: number;
  title: string;
  body: string;
  click_url: string;
}

interface Automation {
  id: string;
  propertyId: string;
  name: string;
  trigger: string;
  status: string;
  steps: Step[];
  jobStats: Record<string, number>;
  createdAt: string;
}

interface StepDraft {
  delay: string;
  unit: "minutes" | "hours" | "days";
  title: string;
  body: string;
  click_url: string;
}

const UNIT_MIN = { minutes: 1, hours: 60, days: 1440 };

function fmtDelay(mins: number): string {
  if (mins === 0) return "immediately";
  if (mins % 1440 === 0) return `${mins / 1440}d after subscribe`;
  if (mins % 60 === 0) return `${mins / 60}h after subscribe`;
  return `${mins}m after subscribe`;
}

export default function Automations() {
  const readOnly = getUser()?.role === "client";
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("Welcome series");
  const [propertyId, setPropertyId] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([
    { delay: "0", unit: "minutes", title: "🎉 Thanks for subscribing!", body: "Here's 10% off your first order: WELCOME10", click_url: "http://localhost:8080/?utm_source=push&utm_campaign=welcome" },
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<Automation[]>("/automations").then(setAutomations).catch((e) => setError(e.message));
    api<{ id: string; name: string }[]>("/properties").then((p) => {
      setProperties(p);
      setPropertyId((prev) => prev || p[0]?.id || "");
    });
  };
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/automations", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          name,
          steps: steps.map((s) => ({
            delay_minutes: Math.round(Number(s.delay) * UNIT_MIN[s.unit]),
            title: s.title,
            body: s.body,
            click_url: s.click_url,
          })),
        }),
      });
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a: Automation) {
    await api(`/automations/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: a.status === "active" ? "paused" : "active" }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this automation? Pending drips will stop.")) return;
    await api(`/automations/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Automations</div>
          <div className="page-sub">Drip sequences sent automatically to every new subscriber</div>
        </div>
        {!readOnly && (
          <button className="btn" onClick={() => setShowCreate(true)}>
            + New automation
          </button>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="panel">
        {automations.length === 0 ? (
          <div className="empty">
            No automations yet. Create a welcome series — it fires for every new subscriber.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Steps</th>
                <th>Queued</th>
                <th>Sent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name}
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>on {a.trigger}</div>
                  </td>
                  <td>
                    <span className={"badge " + (a.status === "active" ? "green" : "gray")}>{a.status}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {a.steps.map((s, i) => (
                      <div key={i}>
                        <span className="commit-hash">{fmtDelay(s.delay_minutes)}</span> {s.title}
                      </div>
                    ))}
                  </td>
                  <td>{a.jobStats.queued ?? 0}</td>
                  <td>{a.jobStats.sent ?? 0}</td>
                  <td>
                    {!readOnly && (
                      <div className="row-actions">
                        <button className="btn secondary small" onClick={() => toggle(a)}>
                          {a.status === "active" ? "Pause" : "Resume"}
                        </button>
                        <button className="btn secondary small" onClick={() => remove(a.id)}>🗑</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()} onSubmit={create}>
            <h2>New automation</h2>
            <p className="page-sub">Fires once for every new subscriber of the property.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Property</label>
                <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>

            <label>Steps ({steps.length}/10)</label>
            {steps.map((s, i) => (
              <div key={i} className="panel" style={{ padding: 12, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Send</span>
                  <input type="number" min={0} style={{ width: 80 }} value={s.delay}
                    onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, delay: e.target.value } : x)))} />
                  <select style={{ width: 110 }} value={s.unit}
                    onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, unit: e.target.value as StepDraft["unit"] } : x)))}>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>after subscribe</span>
                  <button type="button" className="btn secondary small" style={{ marginLeft: "auto" }}
                    onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button>
                </div>
                <input style={{ marginTop: 8 }} placeholder="Title" value={s.title}
                  onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <input style={{ marginTop: 8 }} placeholder="Body" value={s.body}
                  onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
                <input style={{ marginTop: 8 }} placeholder="Click URL" value={s.click_url}
                  onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, click_url: e.target.value } : x)))} />
              </div>
            ))}
            {steps.length < 10 && (
              <button type="button" className="btn secondary small"
                onClick={() => setSteps([...steps, { delay: "1", unit: "days", title: "", body: "", click_url: "http://localhost:8080/" }])}>
                + Add step
              </button>
            )}
            {error && <div className="error-msg">{error}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" disabled={busy || !name || steps.length === 0}>
                {busy ? "Creating…" : "Create automation"}
              </button>
              <button type="button" className="btn secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
