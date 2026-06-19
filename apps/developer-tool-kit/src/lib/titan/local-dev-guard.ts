import { redirect } from "next/navigation";

import { getTitanPublicConfig } from "@/lib/titan/network-config";
import { getTitanHomePath } from "@/lib/titan/nav";

/** Redirect to chain explorer when ops pages are accessed in production. */
export function redirectIfNotLocalDev(): void {
  const config = getTitanPublicConfig();
  if (!config.isLocalDev) {
    redirect(getTitanHomePath(config));
  }
}