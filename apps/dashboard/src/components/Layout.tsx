import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearSession, getUser } from "../api";

const NAV = [
  { to: "/", label: "Overview", icon: "▦", end: true },
  { to: "/properties", label: "Properties", icon: "🌐" },
  { to: "/subscribers", label: "Subscribers", icon: "👥" },
  { to: "/segments", label: "Segments", icon: "🎯" },
  { to: "/campaigns", label: "Campaigns", icon: "📣" },
  { to: "/automations", label: "Automations", icon: "🔁" },
  { to: "/updates", label: "Updates", icon: "⬇" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

// client-role users get a read-only portal with a reduced menu
const CLIENT_NAV = ["/", "/subscribers", "/campaigns", "/automations"];

export default function Layout() {
  const user = getUser();
  const nav = user?.role === "client" ? NAV.filter((n) => CLIENT_NAV.includes(n.to)) : NAV;
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          Push<span>Vault</span>
        </div>
        {nav.map((item) => (
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
