import { redirectIfNotLocalDev } from "@/lib/titan/local-dev-guard";

import { OriginView } from "./origin-view";

export default function OriginPage() {
  redirectIfNotLocalDev();
  return <OriginView />;
}