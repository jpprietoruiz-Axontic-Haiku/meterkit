import { useEffect, useState } from "react";
import { usageStreamUrl } from "./api";
import type { UsageSnapshot } from "./types";

export type StreamStatus = "connecting" | "open" | "error";

export function useUsageStream(token: string | null) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(() => {
    if (!token) return;

    setStatus("connecting");
    const source = new EventSource(usageStreamUrl(token));

    source.addEventListener("usage-snapshot", (event) => {
      setStatus("open");
      setSnapshot(JSON.parse((event as MessageEvent<string>).data));
    });
    source.onerror = () => setStatus("error");

    return () => source.close();
  }, [token]);

  return { snapshot, status };
}
