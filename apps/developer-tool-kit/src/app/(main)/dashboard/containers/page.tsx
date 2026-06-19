import { redirectIfNotLocalDev } from "@/lib/titan/local-dev-guard";

import { ContainersView } from "./containers-view";

export default function ContainersPage() {
  redirectIfNotLocalDev();
  return <ContainersView />;
}