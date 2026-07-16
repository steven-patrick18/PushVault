import { useEffect, useRef, useState } from "react";
import { api, getUser } from "../api";

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

interface UpdatesData {
  source: "github" | "local";
  repo: string;
  branch: string;
  version: string;
  deployedCommit: string | null;
  latestCommit: string | null;
  behind: number | null;
  ahead: number | null;
  canApply: boolean;
  commits: Commit[];
}

interface Status {
  state: "idle" | "requested" | "pulling" | "building" | "done" | "failed";
  at?: string;
  detail?: string;
}

function relTime(iso: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

const BUSY: Status["state"][] = ["requested", "pulling", "building"];
const STEP: Record<string, string> = {
  requested: "Queued — the server will start in a few seconds…",
  pulling: "Downloading the latest version…",
  building: "Rebuilding & restarting (this takes a few minutes — safe to leave this page)…",
};

export default function Updates() {
  const [data, setData] = useState<UpdatesData | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAdmin = getUser()?.role === "admin";

  const load = (check = false) =>
    api<UpdatesData>(`/updates${check ? "?check=1" : ""}`).then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api<Status>("/updates/status").then(setStatus).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // while an update is running, poll status until it finishes
  useEffect(() => {
    if (BUSY.includes(status.state) && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await api<Status>("/updates/status");
          setStatus(s);
          if (!BUSY.includes(s.state)) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            if (s.state === "done") { setMsg("✅ Update complete — you're on the latest version."); load(); }
            if (s.state === "failed") setError("Update failed — the previous version is still running. " + (s.detail ?? ""));
          }
        } catch {
          /* the API may briefly restart during the update — keep polling */
        }
      }, 5000);
    }
    if (!BUSY.includes(status.state) && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
  }, [status.state]);

  async function checkNow() {
    setChecking(true); setMsg(""); setError("");
    try { await load(true); setMsg("Checked GitHub just now."); }
    finally { setChecking(false); }
  }

  async function applyUpdate() {
    if (!confirm("Update PushVault to the latest version now? The app rebuilds and restarts (a few minutes). In-progress blasts finish first.")) return;
    setApplying(true); setError(""); setMsg("");
    try {
      await api("/updates/apply", { method: "POST" });
      setStatus({ state: "requested", at: new Date().toISOString() });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  const groups: { day: string; commits: Commit[] }[] = [];
  for (const c of data?.commits ?? []) {
    const day = dayLabel(c.date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.commits.push(c);
    else groups.push({ day, commits: [c] });
  }

  const behind = data?.behind ?? null;
  const busy = BUSY.includes(status.state);

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Updates</div>
          <div className="page-sub">
            Product changelog from{" "}
            <a href={`https://github.com/${data?.repo ?? ""}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              {data?.repo ?? "GitHub"}
            </a>{" "}
            · branch <span className="commit-hash">{data?.branch ?? "…"}</span>
            {data?.deployedCommit && <> · running <span className="commit-hash">{data.deployedCommit}</span></>}
          </div>
        </div>
        <button className="btn secondary" onClick={checkNow} disabled={checking || busy}>
          {checking ? "Checking…" : "🔄 Check for updates"}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      {/* live progress while an update runs */}
      {busy && (
        <div className="panel" style={{ borderColor: "var(--accent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="spin" />
            <div>
              <b>Updating…</b>
              <div className="page-sub" style={{ marginBottom: 0 }}>{STEP[status.state] ?? "Working…"}</div>
            </div>
          </div>
        </div>
      )}

      {/* update-available / up-to-date banner */}
      {!busy && data && (
        <div className="panel">
          {data.source === "local" ? (
            <div className="page-sub" style={{ marginBottom: 0 }}>
              Local development checkout — update with <span className="commit-hash">git pull</span> in your terminal.
            </div>
          ) : behind === null ? (
            <div className="page-sub" style={{ marginBottom: 0 }}>
              Couldn't compare with GitHub right now (the deployed version may be newer than the last 30 commits, or GitHub is unreachable). Try <b>Check for updates</b>.
            </div>
          ) : behind > 0 ? (
            <div className="flex-between">
              <div>
                <span className="badge amber">update available</span>{" "}
                <span style={{ marginLeft: 8 }}>
                  {behind} new commit{behind > 1 ? "s" : ""} on GitHub
                  {data.latestCommit && <> · latest <span className="commit-hash">{data.latestCommit}</span></>}
                </span>
              </div>
              {isAdmin ? (
                <button className="btn" onClick={applyUpdate} disabled={applying}>
                  {applying ? "Starting…" : "⬇ Update now"}
                </button>
              ) : (
                <span className="page-sub" style={{ margin: 0 }}>Ask an admin to apply.</span>
              )}
            </div>
          ) : (
            <span className="badge green">✓ Up to date — running the latest version</span>
          )}
        </div>
      )}

      <div className="panel">
        <h3>Changelog</h3>
        {groups.length === 0 && <div className="empty">No commits found.</div>}
        {groups.map((g) => (
          <div key={g.day}>
            <div className="date-group">{g.day}</div>
            {g.commits.map((c, i) => (
              <div className="commit-row" key={c.hash}>
                <div className="commit-dot" />
                <div>
                  <div className="commit-msg">
                    {c.subject}{" "}
                    {groups[0] === g && i === 0 && <span className="badge purple">latest</span>}
                    {data?.deployedCommit && c.shortHash === data.deployedCommit && (
                      <span className="badge green" style={{ marginLeft: 6 }}>you are here</span>
                    )}
                  </div>
                  <div className="commit-meta">
                    <span className="commit-hash">{c.shortHash}</span> · {c.author} · {relTime(c.date)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
