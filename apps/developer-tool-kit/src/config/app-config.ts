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
    title: "Titan Explorer — Browse the Titan Blockchain",
    description:
      "Explore blocks, transactions, and validators on the Titan C-Chain. Search addresses, browse chain history, and connect MetaMask to network 888.",
  },
};
