import { useEffect, useState } from "react";
import { api } from "../api";

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

interface UpdatesData {
  branch: string;
  remote: string | null;
  version: string;
  behind: number | null;
  ahead: number | null;
  commits: Commit[];
}

function relTime(iso: string) {
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

export default function Updates() {
  const [data, setData] = useState<UpdatesData | null>(null);
  const [checking, setChecking] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = (check = false) =>
    api<UpdatesData>(`/updates${check ? "?check=1" : ""}`)
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function checkNow() {
    setChecking(true);
    setMsg("");
    setError("");
    try {
      await load(true);
      setMsg("Checked remote just now");
    } finally {
      setChecking(false);
    }
  }

  async function pull() {
    setPulling(true);
    setError("");
    try {
      await api("/updates/pull", { method: "POST" });
      setMsg("Updated successfully — restart the app to apply.");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPulling(false);
    }
  }

  const groups: { day: string; commits: Commit[] }[] = [];
  for (const c of data?.commits ?? []) {
    const day = dayLabel(c.date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.commits.push(c);
    else groups.push({ day, commits: [c] });
  }

  return (
    <>
      <div className="flex-between">
        <div>
          <div className="page-title">Updates</div>
          <div className="page-sub">
            Product changelog straight from git · branch <span className="commit-hash">{data?.branch ?? "…"}</span> · v{data?.version ?? "…"}
          </div>
        </div>
        {data?.remote && (
          <button className="btn secondary" onClick={checkNow} disabled={checking}>
            {checking ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      {data && !data.remote && (
        <div className="panel">
          <h3>Remote updates</h3>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            No git remote configured yet. Once this repo is pushed to GitHub (or any git host),
            this page will check <span className="commit-hash">origin</span> for new versions and
            let you pull updates with one click.
          </div>
        </div>
      )}

      {data?.remote && data.behind !== null && (
        <div className="panel">
          {data.behind > 0 ? (
            <div className="flex-between">
              <div>
                <span className="badge amber">update available</span>{" "}
                <span style={{ marginLeft: 8 }}>
                  {data.behind} new commit{data.behind > 1 ? "s" : ""} on origin/{data.branch}
                </span>
              </div>
              <button className="btn" onClick={pull} disabled={pulling}>
                {pulling ? "Updating…" : "Update now"}
              </button>
            </div>
          ) : (
            <span className="badge green">up to date with origin/{data.branch}</span>
          )}
        </div>
      )}

      <div className="panel">
        <h3>Changelog</h3>
        {groups.length === 0 && <div className="empty">No commits yet.</div>}
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
                  </div>
                  <div className="commit-meta">
                    <span className="commit-hash">{c.shortHash}</span> · {c.author} ·{" "}
                    {relTime(c.date)}
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
