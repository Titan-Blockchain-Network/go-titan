import { utils } from "@flarenetwork/flarejs";
import { isAddress } from "viem";

import { APP_CONFIG } from "@/config/app-config";

/** flarejs maps unknown network IDs to HRP "custom"; Titan chain 888 uses "titan". */
export function resolveNetworkHrp(networkId: number, flareHrp: string): string {
  if (networkId === APP_CONFIG.titan.networkId || flareHrp === "custom") {
    return "titan";
  }
  return flareHrp;
}

/** Derive the P-chain bech32 address for the same key as an EVM address on Titan. */
export function cAddressToPChainAddress(cAddress: string, hrp = "titan"): string {
  if (!isAddress(cAddress)) {
    throw new Error("Invalid C-chain address");
  }
  const bytes = utils.hexToBuffer(cAddress);
  const bech32 = utils.formatBech32(hrp, bytes);
  return bech32.startsWith("P-") ? bech32 : `P-${bech32}`;
}