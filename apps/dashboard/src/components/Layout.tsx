import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearSession, getUser } from "../api";

const NAV = [
  { to: "/", label: "Overview", icon: "▦", end: true },
  { to: "/properties", label: "Properties", icon: "🌐" },
  { to: "/subscribers", label: "Subscribers", icon: "👥" },
  { to: "/segments", label: "Segments", icon: "🎯" },
  { to: "/campaigns", label: "Campaigns", icon: "📣" },
  { to: "/updates", label: "Updates", icon: "⬇" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export default function Layout() {
  const user = getUser();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          Push<span>Vault</span>
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="userbox">
          <div className="email">{user?.email}</div>
          <div>
            {user?.tenantName} · {user?.role}
          </div>
          <button
            onClick={() => {
              clearSession();
              navigate("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
