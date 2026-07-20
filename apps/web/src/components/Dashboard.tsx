import { useAuth } from "../lib/AuthContext";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { BillingPanel } from "./BillingPanel";
import { QuotasPanel } from "./QuotasPanel";
import { UsageHistoryChart } from "./UsageHistoryChart";
import { UsageTiles } from "./UsageTiles";

export function Dashboard() {
  const { token, profile, logout } = useAuth();

  if (!token || !profile) return null;

  const canManage = profile.user.role === "owner" || profile.user.role === "admin";

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>{profile.tenant.name}</h1>
          <p className="muted">
            {profile.user.email} — {profile.user.role}
          </p>
        </div>
        <button type="button" className="secondary" onClick={logout}>
          Cerrar sesion
        </button>
      </header>

      <UsageTiles token={token} />
      <UsageHistoryChart token={token} />
      <QuotasPanel token={token} canEdit={canManage} />
      <BillingPanel token={token} profile={profile} canManage={canManage} />
      <ApiKeyPanel token={token} profile={profile} canRotate={canManage} />
    </div>
  );
}
