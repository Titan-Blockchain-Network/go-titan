import {
  UnsignedTx,
  messageHashFromUnsignedTx,
  secp256k1,
  utils as flareUtils,
} from "@flarenetwork/flarejs";
import { bytesToHex, keccak256, parseSignature, toBytes, type Hex } from "viem";

import { parseWalletError } from "@/lib/titan/wallet-errors";
import {
  getCoreProvider,
  isCoreInstalled,
  listenForCoreProvider,
  type EthereumProvider,
} from "@/lib/titan/wallet-providers";

export {
  isCoreInstalled as hasAvalancheWallet,
  listenForCoreProvider as listenForAvalancheWallet,
};

export function getAvalancheWallet(): EthereumProvider | undefined {
  return getCoreProvider();
}

export type AtomicTxSignMeta = {
  unsignedTxJson?: string;
  utxoIds?: string[];
  cAddress?: string;
};

function ensure0xHex(txHex: string): Hex {
  const trimmed = txHex.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

function extractSignedHex(result: unknown): string | null {
  if (typeof result === "string" && result.length > 2) {
    return ensure0xHex(result);
  }
  if (!result || typeof result !== "object") return null;

  const record = result as Record<string, unknown>;
  for (const key of ["signedTransactionHex", "signedTx", "tx", "transactionHex"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 2) {
      return ensure0xHex(value);
    }
  }
  return null;
}

function formatAttemptError(error: unknown): string {
  return parseWalletError(error, "Unknown wallet error");
}

function isUnrecognizedNetworkError(message: string): boolean {
  return /unrecognized network|eip155:888/i.test(message);
}

function ethSignatureToAvaxBytes(signature: Hex): Uint8Array {
  const { r, s, yParity } = parseSignature(signature);
  const out = new Uint8Array(65);
  out.set(flareUtils.hexToBuffer(r), 0);
  out.set(flareUtils.hexToBuffer(s), 32);
  out[64] = yParity;
  return out;
}

function ethMessageDigestHex(message: string): Hex {
  const prefix = `\x19Ethereum Signed Message:\n${message.length}${message}`;
  return keccak256(toBytes(prefix));
}

function utf8HexParam(message: string): Hex {
  return bytesToHex(new TextEncoder().encode(message));
}

function applyEthSignature(unsignedTx: UnsignedTx, signature: Hex, digest: Hex): void {
  const sigBytes = ethSignatureToAvaxBytes(signature);
  const publicKey = secp256k1.recoverPublicKey(flareUtils.hexToBuffer(digest), sigBytes);
  const coordinates = unsignedTx.getSigIndicesForPubKey(publicKey);
  if (!coordinates?.length) {
    throw new Error("Signed key does not match any input on this transaction.");
  }
  for (const [index, subIndex] of coordinates) {
    unsignedTx.addSignatureAt(sigBytes, index, subIndex);
  }
}

function signedTxHexFromUnsigned(unsignedTx: UnsignedTx): string {
  const bytes = unsignedTx.getSignedTx().toBytes();
  return flareUtils.bufferToHex(flareUtils.addChecksum(bytes));
}

async function broadcastViaExplorer(txHex: string, chain: "C" | "P"): Promise<string> {
  const res = await fetch("/api/titan/staking/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHex, chain }),
  });
  const json = (await res.json()) as { txID?: string; error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? "Titan node refused to broadcast the signed transaction.");
  }
  if (!json.txID) {
    throw new Error("Titan node accepted the broadcast but returned no transaction ID.");
  }
  return json.txID;
}

async function signWithCore(
  wallet: EthereumProvider,
  transactionHex: string,
  chain: "C" | "P" | "X",
  utxoIds: string[] = [],
): Promise<{ signedHex: string | null; errors: string[] }> {
  const errors: string[] = [];
  const base = { transactionHex, chainAlias: chain };
  const utxos = utxoIds.length ? utxoIds : undefined;

  const attempts: Array<{ method: string; params: unknown }> = [
    { method: "avalanche_signTransaction", params: [transactionHex, chain, utxos] },
    { method: "avalanche_signTransaction", params: [transactionHex, chain, utxoIds] },
    { method: "avalanche_signTransaction", params: { ...base, utxos } },
    { method: "avalanche_signTransaction", params: base },
    { method: "avalanche_signTransaction", params: [transactionHex, chain] },
    { method: "avalanche_signTransaction", params: [{ ...base, externalIndices: [0], utxos }] },
    {
      method: "avalanche_signTransaction",
      params: [{ ...base, externalIndices: [0], internalIndices: [], utxos }],
    },
    { method: "avalanche_signTransaction", params: [{ transactionHex, chainAlias: chain, utxos }] },
  ];

  for (const attempt of attempts) {
    try {
      const result = await wallet.request(attempt);
      const signedHex = extractSignedHex(result);
      if (signedHex) {
        return { signedHex, errors };
      }
      errors.push(`${attempt.method}: missing signedTransactionHex`);
    } catch (error) {
      errors.push(`${attempt.method}: ${formatAttemptError(error)}`);
    }
  }

  return { signedHex: null, errors };
}

/**
 * Flare TX SDK pattern: Core cannot avalanche_signTransaction on custom L1 P-chain,
 * but personal_sign / eth_sign over the tx digest works with the same XP key.
 */
async function signViaDigest(
  wallet: EthereumProvider,
  cAddress: string,
  unsignedTxJson: string,
): Promise<string> {
  const unsignedTx = UnsignedTx.fromJSON(unsignedTxJson);
  const digest = flareUtils.bufferToHex(messageHashFromUnsignedTx(unsignedTx)) as Hex;
  const digestNoPrefix = digest.slice(2);
  const errors: string[] = [];

  const digestAttempts: Array<{ label: string; digestForRecover: Hex; request: { method: string; params: unknown } }> =
    [
      {
        label: "personal_sign",
        digestForRecover: ethMessageDigestHex(digestNoPrefix),
        request: {
          method: "personal_sign",
          params: [utf8HexParam(digestNoPrefix), cAddress],
        },
      },
      {
        label: "eth_sign",
        digestForRecover: digest,
        request: {
          method: "eth_sign",
          params: [cAddress, digest],
        },
      },
    ];

  for (const attempt of digestAttempts) {
    try {
      const signature = ensure0xHex((await wallet.request(attempt.request)) as string);
      applyEthSignature(unsignedTx, signature, attempt.digestForRecover);
      if (!unsignedTx.hasAllSignatures()) {
        throw new Error("Incomplete signatures after wallet approval.");
      }
      return signedTxHexFromUnsigned(unsignedTx);
    } catch (error) {
      errors.push(`${attempt.label}: ${formatAttemptError(error)}`);
    }
  }

  throw new Error(
    errors.length
      ? `Core could not sign via message digest. ${errors.slice(0, 2).join(" · ")}`
      : "Core could not sign via message digest.",
  );
}

/**
 * Sign in Core, broadcast via Titan RPC.
 * C-chain export: avalanche_signTransaction usually works on eip155:888.
 * P-chain import/delegate: falls back to digest signing when Core rejects the network.
 */
export async function issueAtomicTx(
  txHex: string,
  chain: "C" | "P" | "X",
  meta: AtomicTxSignMeta = {},
): Promise<string> {
  const wallet = getAvalancheWallet();
  if (!wallet) {
    throw new Error(
      "Avalanche Core wallet not detected. Install Core (core.app) or use the CLI with your operator key.",
    );
  }

  const transactionHex = ensure0xHex(txHex);
  const broadcastChain: "C" | "P" = chain === "X" ? "P" : chain;
  const utxoIds = meta.utxoIds ?? [];

  const { signedHex, errors: signErrors } = await signWithCore(
    wallet,
    transactionHex,
    chain,
    utxoIds,
  );

  if (signedHex) {
    return broadcastViaExplorer(signedHex, broadcastChain);
  }

  const shouldTryDigest =
    Boolean(meta.unsignedTxJson && meta.cAddress) &&
    (chain === "P" || signErrors.some((e) => isUnrecognizedNetworkError(e)));

  if (shouldTryDigest) {
    try {
      const digestSignedHex = await signViaDigest(wallet, meta.cAddress!, meta.unsignedTxJson!);
      return broadcastViaExplorer(digestSignedHex, broadcastChain);
    } catch (digestError) {
      const digestMessage =
        digestError instanceof Error ? digestError.message : "Digest signing failed";
      const coreDetail = signErrors.filter(Boolean).slice(0, 2).join(" · ");
      throw new Error(
        `Core could not sign the ${chain}-chain transaction for Titan (network 888). ${coreDetail} — Fallback: ${digestMessage} — Approve the Core popup; amount may show as "0 AVAX" but the value is TITAN.`,
      );
    }
  }

  const detail = signErrors.filter(Boolean).slice(0, 3).join(" · ");
  throw new Error(
    detail
      ? `Core could not sign the ${chain}-chain transaction for Titan (network 888). ${detail} — Core may show "0 AVAX" in the prompt; the real amount is TITAN. If signing is unsupported for custom L1s, use the Avalanche CLI against rpc.titan-network.xyz.`
      : `Core could not sign the ${chain}-chain transaction. Unlock Core and approve the popup in the extension toolbar.`,
  );
}