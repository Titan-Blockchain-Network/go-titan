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

function utf8HexParam(message: string): Hex {
  return bytesToHex(new TextEncoder().encode(message));
}

/** Mirrors go-titan secp256k1fx.VerifyCredentials (TextHash + EVM owner). */
function titanAcceptsEthPrefixedSignature(
  unsignedTx: UnsignedTx,
  signature: Hex,
  cAddress: string,
): boolean {
  const txHash = messageHashFromUnsignedTx(unsignedTx);
  const txHashStr = bytesToHex(txHash).slice(2);
  const txHashEth = ethMessageDigestHex(txHashStr);
  const sigBytes = ethSignatureToAvaxBytes(signature);
  const publicKey = secp256k1.recoverPublicKey(flareUtils.hexToBuffer(txHashEth), sigBytes);
  const ethAddr = secp256k1.publicKeyToEthAddress(publicKey);
  const expected = flareUtils.hexToBuffer(cAddress.toLowerCase());
  if (ethAddr.length !== expected.length) return false;
  return ethAddr.every((byte, i) => byte === expected[i]);
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
 * Titan/Flare P-chain: personal_sign over hex(sha256(tx)) — matches TextHash verification.
 * Requires go-titan nodes with EVM-owner support in secp256k1fx (ownerMatchesPubKey).
 */
async function signViaDigest(
  wallet: EthereumProvider,
  cAddress: string,
  unsignedTxJson: string,
): Promise<string> {
  const unsignedTx = loadUnsignedTx(unsignedTxJson);
  const digestNoPrefix = bytesToHex(messageHashFromUnsignedTx(unsignedTx)).slice(2);

  let signature: Hex;
  try {
    signature = ensure0xHex(
      (await wallet.request({
        method: "personal_sign",
        params: [utf8HexParam(digestNoPrefix), cAddress],
      })) as string,
    );
  } catch (error) {
    throw new Error(`personal_sign: ${formatAttemptError(error)}`);
  }

  if (!titanAcceptsEthPrefixedSignature(unsignedTx, signature, cAddress)) {
    throw new Error(
      "personal_sign returned a signature for a different account than this transaction. Use the same Core wallet that performed the export.",
    );
  }

  if (
    !applyRecoveredSignature(unsignedTx, signature, ethMessageDigestHex(digestNoPrefix))
  ) {
    throw new Error("Could not attach wallet signature to the P-chain transaction inputs.");
  }

  return signedTxHexFromUnsigned(unsignedTx);
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
        `Core could not sign the ${chain}-chain transaction for Titan (network 888). ${coreDetail} — Fallback: ${digestMessage} — P-chain import needs Titan nodes running the latest go-titan (EVM-owner verify fix). Use the same Core account that exported.`,
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