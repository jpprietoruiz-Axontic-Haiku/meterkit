import "./App.css";
import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";
import { AuthProvider, useAuth } from "./lib/AuthContext";

function Shell() {
  const { token, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  return token && profile ? <Dashboard /> : <AuthScreen />;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
