import { redirect } from "next/navigation";

import { getTitanPublicConfig } from "@/lib/titan/network-config";
import { getTitanHomePath } from "@/lib/titan/nav";

export default function Home() {
  redirect(getTitanHomePath(getTitanPublicConfig()));
}