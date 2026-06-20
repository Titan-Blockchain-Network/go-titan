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

const EMPTY_SIG_HEX =
  "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

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

function loadUnsignedTx(unsignedTxJson: string): UnsignedTx {
  return UnsignedTx.fromJSON(unsignedTxJson);
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

function ethMessageDigestForBytes(message: Uint8Array): Hex {
  const prefix = new TextEncoder().encode(
    `\x19Ethereum Signed Message:\n${message.length}`,
  );
  const combined = new Uint8Array(prefix.length + message.length);
  combined.set(prefix);
  combined.set(message, prefix.length);
  return keccak256(combined);
}

function utf8HexParam(message: string): Hex {
  return bytesToHex(new TextEncoder().encode(message));
}

function hasWalletSignatures(unsignedTx: UnsignedTx): boolean {
  return unsignedTx.getCredentials().some((cred) =>
    cred.getSignatures().some((sig) => sig.toLowerCase() !== EMPTY_SIG_HEX),
  );
}

function applyRecoveredSignature(
  unsignedTx: UnsignedTx,
  signature: Hex,
  digestForRecover: Hex,
): boolean {
  const sigBytes = ethSignatureToAvaxBytes(signature);
  const publicKey = secp256k1.recoverPublicKey(flareUtils.hexToBuffer(digestForRecover), sigBytes);
  const coordinates = unsignedTx.getSigIndicesForPubKey(publicKey);
  if (!coordinates?.length) {
    return false;
  }
  for (const [index, subIndex] of coordinates) {
    unsignedTx.addSignatureAt(sigBytes, index, subIndex);
  }
  return hasWalletSignatures(unsignedTx);
}

function applySha256Signature(unsignedTx: UnsignedTx, signature: Hex): boolean {
  unsignedTx.addSignature(ethSignatureToAvaxBytes(signature));
  return hasWalletSignatures(unsignedTx);
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

type DigestAttempt = {
  label: string;
  request: { method: string; params: unknown };
  apply: (unsignedTx: UnsignedTx, signature: Hex) => boolean;
};

/**
 * Flare TX SDK pattern for MetaMask/Core on custom L1s: sign the sha256 digest
 * via personal_sign or eth_sign, attach to the unsigned tx, broadcast ourselves.
 */
async function signViaDigest(
  wallet: EthereumProvider,
  cAddress: string,
  unsignedTxJson: string,
): Promise<string> {
  const digest = flareUtils.bufferToHex(
    messageHashFromUnsignedTx(loadUnsignedTx(unsignedTxJson)),
  ) as Hex;
  const digestNoPrefix = digest.slice(2);
  const errors: string[] = [];

  const attempts: DigestAttempt[] = [
    {
      label: "personal_sign",
      request: {
        method: "personal_sign",
        params: [utf8HexParam(digestNoPrefix), cAddress],
      },
      apply: (unsignedTx, signature) =>
        applyRecoveredSignature(unsignedTx, signature, ethMessageDigestHex(digestNoPrefix)),
    },
    {
      label: "eth_sign",
      request: {
        method: "eth_sign",
        params: [cAddress, digest],
      },
      apply: (unsignedTx, signature) =>
        applySha256Signature(unsignedTx, signature) ||
        applyRecoveredSignature(unsignedTx, signature, digest),
    },
    {
      label: "personal_sign (raw hash)",
      request: {
        method: "personal_sign",
        params: [digest, cAddress],
      },
      apply: (unsignedTx, signature) =>
        applyRecoveredSignature(unsignedTx, signature, ethMessageDigestForBytes(toBytes(digest))),
    },
  ];

  for (const attempt of attempts) {
    const unsignedTx = loadUnsignedTx(unsignedTxJson);
    try {
      const signature = ensure0xHex((await wallet.request(attempt.request)) as string);
      if (attempt.apply(unsignedTx, signature)) {
        return signedTxHexFromUnsigned(unsignedTx);
      }
      errors.push(`${attempt.label}: signature did not match transaction inputs`);
    } catch (error) {
      errors.push(`${attempt.label}: ${formatAttemptError(error)}`);
    }
  }

  throw new Error(
    errors.length
      ? `Core could not sign via message digest. ${errors.slice(0, 3).join(" · ")}`
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
        `Core could not sign the ${chain}-chain transaction for Titan (network 888). ${coreDetail} — Fallback: ${digestMessage} — Use the same Core account that exported; the popup signs a hash, not a transfer amount.`,
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