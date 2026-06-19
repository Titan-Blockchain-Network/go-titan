import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Titan Explorer",
  version: packageJson.version,
  copyright: `© ${currentYear}, Titan Explorer.`,
  titan: {
    networkName: "Titan",
    networkId: 888,
    chainIdDec: 888,
    chainIdHex: "0x378",
    rpcUrl: "https://rpc.titan-network.xyz/ext/bc/C/rpc",
    dashboardUrl: "http://localhost:3000/dashboard/default",
    explorerUrl: "https://explorer.titan-network.xyz/dashboard/activity",
    nativeToken: {
      name: "Titan",
      symbol: "TITAN",
      decimals: 18,
    },
  },
  meta: {
    title: "Titan Explorer - Modern Next.js Dashboard Starter Template",
    description:
      "Titan Explorer is a modern, open-source dashboard starter template built with Next.js 16, Tailwind CSS v4, and shadcn/ui. Perfect for SaaS apps, admin panels, and internal tools—fully customizable and production-ready.",
  },
};
