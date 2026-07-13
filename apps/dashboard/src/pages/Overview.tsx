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

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<OverviewData>("/dashboard/overview").then(setData).catch((e) => setError(e.message));
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
