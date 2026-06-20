"use client";

import { useEffect } from "react";

import { useNetworkStatusStore } from "@/stores/titan/network-status-store";

const POLL_MS = 10_000;

/** Hydrates cached network snapshot and keeps it fresh across dashboard navigation. */
export function NetworkStatusSync() {
  const hydrate = useNetworkStatusStore((s) => s.hydrate);
  const refresh = useNetworkStatusStore((s) => s.refresh);

  useEffect(() => {
    hydrate();
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [hydrate, refresh]);

  return null;
}