import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Check {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
}
interface LoggedError {
  at: string;
  status: number;
  method: string;
  path: string;
  message: string;
}
interface Diag {
  overall: "healthy" | "attention" | "problem";
  failCount: number;
  warnCount: number;
  checks: Check[];
  recentErrors: LoggedError[];
  at: string;
}

const ICON = { ok: "✅", warn: "⚠️", fail: "❌" } as const;

export default function Troubleshoot() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api<Diag>("/troubleshoot")
      .then(setDiag)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const banner =
    diag?.overall === "healthy"
      ? { color: "#34d399", text: "✅ Everything looks healthy" }
      : diag?.overall === "attention"
        ? { color: "#fbbf24", text: `⚠️ ${diag.warnCount} thing(s) need attention` }
        : { color: "#f87171", text: `❌ ${diag?.failCount ?? 0} problem(s) found` };

  return (
    <>
      <div className="flex-between">
        <div>
          <h2 style={{ marginBottom: 4 }}>Troubleshoot</h2>
          <div className="page-sub" style={{ margin: 0 }}>
            A self-check of your PushVault. Run this whenever something feels off — it tells you
            what's wrong and how to fix it, no developer needed.
          </div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Checking…" : "↻ Run checks"}
        </button>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--red)" }}>
          <b style={{ color: "var(--red)" }}>Could not run diagnostics:</b> {error}
        </div>
      )}

      {diag && (
        <>
          <div className="panel" style={{ borderColor: banner.color }}>
            <h3 style={{ color: banner.color, margin: 0 }}>{banner.text}</h3>
            <div className="page-sub" style={{ margin: "6px 0 0" }}>
              Last checked {new Date(diag.at).toLocaleString()}
            </div>
          </div>

          <div className="panel">
            <h3>System checks</h3>
            <table>
              <tbody>
                {diag.checks.map((c) => (
                  <tr key={c.id}>
                    <td style={{ width: 30, fontSize: 18 }}>{ICON[c.status]}</td>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{c.label}</td>
                    <td>
                      {c.detail}
                      {c.fix && (
                        <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 4 }}>
                          → {c.fix}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Recent server errors {diag.recentErrors.length > 0 && `(${diag.recentErrors.length})`}</h3>
            {diag.recentErrors.length === 0 ? (
              <div className="page-sub" style={{ margin: 0 }}>
                No server errors recorded. 🎉
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Request</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.recentErrors.map((e, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap", color: "var(--text-dim)" }}>
                        {new Date(e.at).toLocaleTimeString()}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="badge red">{e.status}</span> {e.method} {e.path}
                      </td>
                      <td style={{ fontSize: 12 }}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>
              This list holds the last 100 server errors since the app last restarted. If you see the
              same error repeating, note the request path and error text — that's exactly what to
              share when asking for help.
            </div>
          </div>

          <div className="panel">
            <h3>Common fixes</h3>
            <ul style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
              <li>
                <b>Leads not arriving?</b> Open the property → run <b>Verify installation</b>, and make
                sure the subscribe link (or hosted page) opens over HTTPS.
              </li>
              <li>
                <b>Pushes not delivered?</b> Check the property has push keys (VAPID). Re-generating
                keys invalidates existing subscribers — only do it on a fresh property.
              </li>
              <li>
                <b>A campaign is stuck "sending"?</b> Open it → Pause, then Resume. If it stays stuck,
                Cancel it; the hourly maintenance job also clears truly stuck blasts.
              </li>
              <li>
                <b>iPhone users can't subscribe?</b> Apple requires the visitor to use{" "}
                <b>Share → Add to Home Screen</b> and open it from the home-screen icon first.
              </li>
              <li>
                <b>Everything red / app not loading?</b> The server may be restarting. Wait a minute
                and run the checks again.
              </li>
            </ul>
          </div>
        </>
      )}
    </>
  );
}
