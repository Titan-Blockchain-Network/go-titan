import {
  Blocks,
  Code2,
  Container,
  FileJson,
  type LucideIcon,
  Network,
  Rocket,
  ScrollText,
  Server,
} from "lucide-react";

export interface NavSubItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 0,
    label: "Ecosystem",
    items: [
      {
        title: "Launchpad",
        url: "/dashboard/ecosystem",
        icon: Rocket,
        isNew: true,
      },
    ],
  },
  {
    id: 1,
    label: "Blockchain",
    items: [
      {
        title: "Chain Explorer",
        url: "/dashboard/activity",
        icon: Blocks,
      },
      {
        title: "Network",
        url: "/dashboard/default",
        icon: Network,
      },
      {
        title: "Nodes",
        url: "/dashboard/nodes",
        icon: Server,
      },
    ],
  },
  {
    id: 2,
    label: "Developers",
    items: [
      {
        title: "Contract Studio",
        url: "/dashboard/contracts",
        icon: Code2,
        isNew: true,
      },
      {
        title: "Origin",
        url: "/dashboard/origin",
        icon: FileJson,
      },
      {
        title: "Docker Logs",
        url: "/dashboard/logs",
        icon: ScrollText,
      },
      {
        title: "Containers",
        url: "/dashboard/containers",
        icon: Container,
      },
    ],
  },
];