import { Context, evm, networkIDs, pvm, utils, type UnsignedTx } from "@flarenetwork/flarejs";
import { isAddress } from "viem";

import { cChainRpc } from "@/lib/titan/c-chain-rpc";
import { cAddressToPChainAddress, resolveNetworkHrp } from "@/lib/titan/p-chain-address";
import { getPrimaryNodeBaseUrl, titanToNano } from "@/lib/titan/platform-rpc";

const EXPORT_FEE_TITAN = 0.01;
const MIN_DELEGATION_DAYS = 1;

function serializeUnsignedTx(tx: { toBytes(): Uint8Array }): string {
  return utils.bufferToHex(tx.toBytes());
}

/** Metadata Core / personal_sign need to finish signing on custom L1 (network 888). */
export function walletSigningMeta(tx: UnsignedTx) {
  return {
    unsignedTxJson: JSON.stringify(tx.toJSON()),
    utxoIds: tx.utxos.map((utxo) => utxo.ID()),
  };
}

async function loadContext(baseUrl: string) {
  const context = await Context.getContextFromURI(baseUrl);
  const hrp = resolveNetworkHrp(context.networkID, context.hrp);
  return hrp === context.hrp ? context : { ...context, hrp };
}

export async function getPChainBalance(cAddress: string): Promise<{
  pAddress: string;
  balanceNano: string;
  balanceTitan: number;
  hrp: string;
}> {
  const baseUrl = await getPrimaryNodeBaseUrl();
  const context = await loadContext(baseUrl);
  const pAddress = cAddressToPChainAddress(cAddress, context.hrp);
  const pvmapi = new pvm.PVMApi(baseUrl);

  const { balance } = await pvmapi.getBalance({ addresses: [pAddress] });

  return {
    pAddress,
    balanceNano: balance.toString(),
    balanceTitan: Number(balance) / 1_000_000_000,
    hrp: context.hrp,
  };
}

export async function buildCtoPTransfer(cAddress: string, amountTitan: number) {
  if (!isAddress(cAddress)) {
    throw new Error("Invalid C-chain address");
  }
  if (amountTitan <= 0) {
    throw new Error("Amount must be positive");
  }

  const baseUrl = await getPrimaryNodeBaseUrl();
  const context = await loadContext(baseUrl);
  const pAddress = cAddressToPChainAddress(cAddress, context.hrp);
  const amountNano = titanToNano(amountTitan);
  const feeNano = titanToNano(EXPORT_FEE_TITAN);

  const nonceHex = await cChainRpc<string>("eth_getTransactionCount", [cAddress, "latest"]);
  const nonce = BigInt(nonceHex);

  const exportTx = evm.newExportTx(
    context,
    amountNano,
    context.pBlockchainID,
    utils.hexToBuffer(cAddress),
    [utils.bech32ToBytes(pAddress)],
    feeNano,
    nonce,
  );

  return {
    pAddress,
    exportTxHex: serializeUnsignedTx(exportTx),
    ...walletSigningMeta(exportTx),
    exportChain: "C" as const,
    importChain: "P" as const,
    feeTitan: EXPORT_FEE_TITAN,
    note:
      "Sign and issue the export on C-chain, wait for acceptance, then build/import on P-chain.",
  };
}

export async function countPendingImportUtxos(cAddress: string): Promise<number> {
  if (!isAddress(cAddress)) {
    return 0;
  }

  const baseUrl = await getPrimaryNodeBaseUrl();
  const context = await loadContext(baseUrl);
  const pAddress = cAddressToPChainAddress(cAddress, context.hrp);
  const pvmapi = new pvm.PVMApi(baseUrl);

  const { utxos } = await pvmapi.getUTXOs({
    sourceChain: "C",
    addresses: [pAddress],
  });

  return utxos.length;
}

export async function buildPChainImport(cAddress: string) {
  if (!isAddress(cAddress)) {
    throw new Error("Invalid C-chain address");
  }

  const baseUrl = await getPrimaryNodeBaseUrl();
  const context = await loadContext(baseUrl);
  const pAddress = cAddressToPChainAddress(cAddress, context.hrp);
  const pvmapi = new pvm.PVMApi(baseUrl);

  const { utxos } = await pvmapi.getUTXOs({
    sourceChain: "C",
    addresses: [pAddress],
  });

  if (!utxos.length) {
    throw new Error("No importable UTXOs on P-chain yet. Wait for the C-chain export to finalize.");
  }

  const feeState = await pvmapi.getFeeState();
  const importTx = pvm.e.newImportTx(
    {
      feeState,
      utxos,
      sourceChainId: context.cBlockchainID,
      fromAddressesBytes: [utils.bech32ToBytes(pAddress)],
      toAddressesBytes: [utils.bech32ToBytes(pAddress)],
    },
    context,
  );

  return {
    pAddress,
    importTxHex: serializeUnsignedTx(importTx),
    ...walletSigningMeta(importTx),
    importChain: "P" as const,
  };
}

export async function buildDelegatorStake(input: {
  cAddress: string;
  nodeId: string;
  amountTitan: number;
  days: number;
}) {
  const { cAddress, nodeId, amountTitan, days } = input;

  if (!isAddress(cAddress)) {
    throw new Error("Invalid C-chain address");
  }
  if (!nodeId.startsWith("NodeID-")) {
    throw new Error("Invalid validator NodeID");
  }
  if (amountTitan <= 0) {
    throw new Error("Stake amount must be positive");
  }
  if (days < MIN_DELEGATION_DAYS) {
    throw new Error(`Minimum delegation period is ${MIN_DELEGATION_DAYS} day(s)`);
  }

  const baseUrl = await getPrimaryNodeBaseUrl();
  const context = await loadContext(baseUrl);
  const pAddress = cAddressToPChainAddress(cAddress, context.hrp);
  const pvmapi = new pvm.PVMApi(baseUrl);

  const { utxos } = await pvmapi.getUTXOs({ addresses: [pAddress] });
  const feeState = await pvmapi.getFeeState();

  const now = Math.floor(Date.now() / 1000);
  const start = BigInt(now + 60);
  const end = BigInt(now + days * 86_400);
  const weight = titanToNano(amountTitan);

  const tx = pvm.e.newAddPermissionlessDelegatorTx(
    {
      feeState,
      utxos,
      nodeId,
      subnetId: networkIDs.PrimaryNetworkID.toString(),
      start,
      end,
      weight,
      fromAddressesBytes: [utils.bech32ToBytes(pAddress)],
      rewardAddresses: [utils.bech32ToBytes(pAddress)],
    },
    context,
  );

  return {
    pAddress,
    delegateTxHex: serializeUnsignedTx(tx),
    ...walletSigningMeta(tx),
    chain: "P" as const,
    startTime: Number(start),
    endTime: Number(end),
    amountTitan,
    nodeId,
  };
}