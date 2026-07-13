import { useEffect, useState } from "react";
import { api } from "../api";

interface OverviewData {
  properties: number;
  activeSubscribers: number;
  newSubscribers30d: number;
  recentCampaigns: {
    id: string;
    name: string;
    status: string;
    totalSent: number;
    totalClicked: number;
    ctr: number | null;
    createdAt: string;
  }[];
}

interface Stats {
  byDay: { date: string; count: number }[];
  byCampaign: { campaign: string; count: number }[];
}

function GrowthChart({ byDay }: { byDay: Stats["byDay"] }) {
  const max = Math.max(...byDay.map((d) => d.count), 1);
  const W = 900;
  const H = 160;
  const bw = W / byDay.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} style={{ width: "100%", height: "auto" }}>
      {byDay.map((d, i) => {
        const h = (d.count / max) * H;
        return (
          <g key={d.date}>
            <rect
              x={i * bw + 2}
              y={H - h}
              width={bw - 4}
              height={Math.max(h, d.count > 0 ? 3 : 1)}
              rx={3}
              fill={d.count > 0 ? "var(--accent)" : "var(--border)"}
              opacity={d.count > 0 ? 0.9 : 0.5}
            >
              <title>{`${d.date}: ${d.count} new subscribers`}</title>
            </rect>
            {i % 5 === 0 && (
              <text x={i * bw + bw / 2} y={H + 16} fontSize={10} fill="var(--text-dim)" textAnchor="middle">
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<OverviewData>("/dashboard/overview").then(setData).catch((e) => setError(e.message));
    api<Stats>("/subscribers/stats").then(setStats).catch(() => {});
  }, []);

  return (
    <>
      <div className="page-title">Overview</div>
      <div className="page-sub">Your push notification platform at a glance</div>

      {error && <div className="error-msg">{error}</div>}

      <div className="cards">
        <div className="card">
          <div className="label">Properties</div>
          <div className="value">{data?.properties ?? "–"}</div>
          <div className="hint">connected websites</div>
        </div>
        <div className="card">
          <div className="label">Active subscribers</div>
          <div className="value">{data?.activeSubscribers ?? "–"}</div>
          <div className="hint">opted-in devices</div>
        </div>
        <div className="card">
          <div className="label">New (30 days)</div>
          <div className="value">{data?.newSubscribers30d ?? "–"}</div>
          <div className="hint">subscriber growth</div>
        </div>
      </div>

      {stats && (
        <div className="panel">
          <h3>Subscriber growth — last 30 days</h3>
          <GrowthChart byDay={stats.byDay} />
        </div>
      )}

      {stats && stats.byCampaign.length > 0 && (
        <div className="panel">
          <h3>Leads by campaign</h3>
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Leads</th>
              </tr>
            </thead>
            <tbody>
              {stats.byCampaign.map((c) => (
                <tr key={c.campaign}>
                  <td>{c.campaign}</td>
                  <td>{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h3>Recent campaigns</h3>
        {data && data.recentCampaigns.length === 0 ? (
          <div className="empty">
            No campaigns yet — campaigns arrive with milestone M3 (send engine).
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Clicked</th>
                <th>CTR</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentCampaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <span className={"badge " + (c.status === "sent" ? "green" : "gray")}>
                      {c.status}
                    </span>
                  </td>
                  <td>{c.totalSent}</td>
                  <td>{c.totalClicked}</td>
                  <td>{c.ctr === null ? "–" : c.ctr + "%"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
