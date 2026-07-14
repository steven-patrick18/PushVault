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
  { to: "/troubleshoot", label: "Troubleshoot", icon: "🩺" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

// client-role users get a read-only portal with a reduced menu
const CLIENT_NAV = ["/", "/subscribers", "/campaigns", "/automations"];
// operators run daily campaigns; they can't manage properties or settings
const OPERATOR_NAV = ["/", "/subscribers", "/segments", "/campaigns", "/automations"];
// Troubleshoot + Settings + Properties expose cross-property / config → staff only
const ADMIN_ONLY = ["/troubleshoot"];

export default function Layout() {
  const user = getUser();
  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const nav = NAV.filter((n) => {
    if (user?.role === "client") return CLIENT_NAV.includes(n.to);
    if (user?.role === "operator") return OPERATOR_NAV.includes(n.to);
    return isAdmin || !ADMIN_ONLY.includes(n.to);
  });
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
