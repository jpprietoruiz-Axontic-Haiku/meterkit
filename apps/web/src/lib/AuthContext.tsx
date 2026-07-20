import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "./api";
import type { MeResponse } from "./types";

const STORAGE_KEY = "meterkit.token";

type AuthContextValue = {
  token: string | null;
  profile: MeResponse | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (tenantName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!token) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await api.me(token));
    } catch {
      setToken(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    refreshProfile().finally(() => setLoading(false));
  }, [refreshProfile]);

  function persistToken(next: string) {
    localStorage.setItem(STORAGE_KEY, next);
    setToken(next);
  }

  async function login(email: string, password: string) {
    const res = await api.login(email, password);
    persistToken(res.token);
  }

  async function register(tenantName: string, email: string, password: string) {
    const res = await api.register(tenantName, email, password);
    persistToken(res.token);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider
      value={{ token, profile, loading, login, register, logout, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
