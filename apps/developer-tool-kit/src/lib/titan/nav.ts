import type { NavGroup } from "@/navigation/sidebar/sidebar-items";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

export interface TitanNavContext {
  isLocalDev: boolean;
  logsEnabled: boolean;
}

const LOCAL_ONLY_URLS = new Set([
  "/dashboard/origin",
  "/dashboard/logs",
  "/dashboard/containers",
]);

/** Primary landing path: chain explorer in prod, network overview locally. */
export function getTitanHomePath(ctx: Pick<TitanNavContext, "isLocalDev">): string {
  return ctx.isLocalDev ? "/dashboard/default" : "/dashboard/activity";
}

export function getSidebarItems(ctx: TitanNavContext): NavGroup[] {
  const showLocalOps = ctx.isLocalDev && ctx.logsEnabled;

  return sidebarItems
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (LOCAL_ONLY_URLS.has(item.url)) {
          return showLocalOps;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}