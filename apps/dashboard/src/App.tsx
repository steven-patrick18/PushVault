import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Properties from "./pages/Properties";
import Subscribers from "./pages/Subscribers";
import Updates from "./pages/Updates";
import Placeholder from "./pages/Placeholder";

function RequireAuth({ children }: { children: React.ReactElement }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Overview />} />
        <Route path="properties" element={<Properties />} />
        <Route path="subscribers" element={<Subscribers />} />
        <Route
          path="segments"
          element={<Placeholder title="Segments" milestone="M3 — Send engine" />}
        />
        <Route
          path="campaigns"
          element={<Placeholder title="Campaigns" milestone="M3 — Send engine" />}
        />
        <Route path="updates" element={<Updates />} />
        <Route
          path="settings"
          element={<Placeholder title="Settings" milestone="M4 — Dashboard v1" />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
