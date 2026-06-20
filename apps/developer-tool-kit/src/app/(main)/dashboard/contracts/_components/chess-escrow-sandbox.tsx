"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Coins, FlaskConical, Loader2, Play, RefreshCw, Swords } from "lucide-react";
import { formatEther, parseEther, type Abi } from "viem";

import { APP_CONFIG } from "@/config/app-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  contractHasBytecode,
  readContractFunction,
  writeContractFunction,
} from "@/lib/titan/contract-interact";
import { getTitanRuntimeConfig } from "@/lib/titan/network-runtime";
import { shortAddress } from "@/lib/titan/format";
import { parseWalletError } from "@/lib/titan/wallet-errors";
import { isOnTitanChain, isWalletConnected, useWalletStore } from "@/stores/wallet/wallet-store";

type ChessEscrowSandboxProps = {
  contractAddress: string;
  recordId: string;
  abi: Abi;
};

const GAME_STATUS = ["Active", "Finished", "Cancelled"] as const;
const OUTCOMES = [
  { value: 1, label: "Player wins" },
  { value: 2, label: "Stockfish wins" },
  { value: 3, label: "Draw" },
] as const;

type ActiveGameInfo = {
  gameId: string;
  player: string;
  stake: string;
  status: string;
};

type EscrowState = {
  owner: string;
  operator: string;
  houseBankroll: string;
  queueLength: string;
  activeGames: string;
  minStake: string;
  maxStake: string;
  activeGame: ActiveGameInfo | null;
};

export function ChessEscrowSandbox({ contractAddress, recordId, abi }: ChessEscrowSandboxProps) {
  const address = useWalletStore((s) => s.address);
  const chainId = useWalletStore((s) => s.chainId);
  const walletReady = isWalletConnected({ address });
  const onTitanChain = isOnTitanChain(chainId);

  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [hasBytecode, setHasBytecode] = useState<boolean | null>(null);
  const [networkName, setNetworkName] = useState("Titan Network");
  const [depositTitan, setDepositTitan] = useState("2");
  const [resolveOutcome, setResolveOutcome] = useState("2");
  const [state, setState] = useState<EscrowState | null>(null);

  useEffect(() => {
    void getTitanRuntimeConfig().then((cfg) => setNetworkName(cfg.networkName));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const exists = await contractHasBytecode(contractAddress);
      setHasBytecode(exists);
      if (!exists) {
        throw new Error(`No contract at ${contractAddress} on ${networkName}.`);
      }

      const [owner, operator, houseBankroll, queueLength, activeGames, minStake, maxStake, nextGameId] =
        await Promise.all([
          readContractFunction<string>({ contractAddress, abi, functionName: "owner" }),
          readContractFunction<string>({ contractAddress, abi, functionName: "stockfishOperator" }),
          readContractFunction<bigint>({ contractAddress, abi, functionName: "houseBankroll" }),
          readContractFunction<bigint>({ contractAddress, abi, functionName: "queueLength" }),
          readContractFunction<bigint>({ contractAddress, abi, functionName: "activeGames" }),
          readContractFunction<bigint>({ contractAddress, abi, functionName: "minStake" }),
          readContractFunction<bigint>({ contractAddress, abi, functionName: "maxStake" }),
          readContractFunction<bigint>({ contractAddress, abi, functionName: "nextGameId" }),
        ]);

      let activeGame: ActiveGameInfo | null = null;
      if (Number(activeGames) > 0) {
        for (let id = Number(nextGameId) - 1; id >= 0; id--) {
          const game = await readContractFunction<
            readonly [string, bigint, bigint, number, number, string, bigint, bigint]
          >({
            contractAddress,
            abi,
            functionName: "getGame",
            args: [BigInt(id)],
          });
          const statusIdx = Number(game[3]);
          if (statusIdx === 0) {
            activeGame = {
              gameId: String(id),
              player: game[0],
              stake: formatEther(game[1]),
              status: GAME_STATUS[statusIdx] ?? "Unknown",
            };
            break;
          }
        }
      }

      setState({
        owner,
        operator,
        houseBankroll: formatEther(houseBankroll),
        queueLength: queueLength.toString(),
        activeGames: activeGames.toString(),
        minStake: formatEther(minStake),
        maxStake: formatEther(maxStake),
        activeGame,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read escrow.");
    } finally {
      setLoading(false);
    }
  }, [abi, contractAddress, networkName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isOwner =
    walletReady && state?.owner && address?.toLowerCase() === state.owner.toLowerCase();
  const isOperator =
    walletReady && state?.operator && address?.toLowerCase() === state.operator.toLowerCase();

  async function runWrite(
    functionName: string,
    args: readonly unknown[] = [],
    valueWei?: bigint,
  ) {
    if (!walletReady) {
      setError("Connect MetaMask to send transactions.");
      return;
    }
    if (!onTitanChain) {
      setError(`Switch MetaMask to ${networkName} (chain ${APP_CONFIG.titan.chainIdDec}).`);
      return;
    }
    if (hasBytecode === false) {
      setError("Contract is not deployed on this network.");
      return;
    }

    setWriting(true);
    setError("");
    setLastTx(null);
    try {
      const txHash = await writeContractFunction({
        from: address,
        contractAddress,
        abi,
        functionName,
        args,
        valueWei,
      });
      setLastTx(txHash);
      await refresh();
    } catch (err) {
      setError(parseWalletError(err, "Transaction failed."));
    } finally {
      setWriting(false);
    }
  }

  async function depositHouse() {
    const trimmed = depositTitan.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed) || Number(trimmed) <= 0) {
      setError("Enter a valid TITAN amount (e.g. 2 or 0.5).");
      return;
    }
    await runWrite("depositHouse", [], parseEther(trimmed));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isOwner && (
          <Badge variant="default" className="text-[10px]">
            You are owner
          </Badge>
        )}
        {isOperator && (
          <Badge variant="secondary" className="text-[10px]">
            You are operator
          </Badge>
        )}
        {!isOwner && walletReady && state && (
          <Badge variant="outline" className="text-[10px]">
            Owner: {shortAddress(state.owner)}
          </Badge>
        )}
      </div>

      {hasBytecode === false && (
        <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          No bytecode at this address on the live network.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="House pool" value={state ? `${state.houseBankroll} T` : "—"} highlight />
        <Stat label="Queue" value={state?.queueLength ?? "—"} />
        <Stat label="Active games" value={state?.activeGames ?? "—"} />
        <Stat label="Stake range" value={state ? `${state.minStake}–${state.maxStake} T` : "—"} />
        <Stat label="Operator" value={state ? shortAddress(state.operator) : "—"} mono />
        <Stat label="Owner" value={state ? shortAddress(state.owner) : "—"} mono />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
        {isOperator && state && Number(state.queueLength) > 0 && Number(state.activeGames) === 0 && (
          <Button size="sm" onClick={() => void runWrite("startNextMatch")} disabled={writing}>
            {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            startNextMatch()
          </Button>
        )}
      </div>

      {state?.activeGame && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Stuck match — Game #{state.activeGame.gameId} still active on-chain
              </p>
              <p className="text-muted-foreground">
                The chess game may have ended in the browser, but{" "}
                <span className="font-mono">reportResult()</span> was never sent. Player{" "}
                <span className="font-mono">{shortAddress(state.activeGame.player)}</span> ·{" "}
                {state.activeGame.stake} T stake locked until settled.
              </p>
            </div>
          </div>

          {isOperator ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`outcome-${recordId}`} className="text-xs">
                  reportResult(gameId, outcome)
                </Label>
                <select
                  id={`outcome-${recordId}`}
                  value={resolveOutcome}
                  onChange={(e) => setResolveOutcome(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                >
                  {OUTCOMES.map((o) => (
                    <option key={o.value} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  void runWrite("reportResult", [
                    BigInt(state.activeGame!.gameId),
                    Number(resolveOutcome),
                  ])
                }
                disabled={writing}
              >
                {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Swords className="h-3.5 w-3.5" />}
                Settle Game #{state.activeGame.gameId}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Connect the <strong>operator</strong> wallet ({shortAddress(state.operator)}) to call{" "}
              <span className="font-mono">reportResult</span>.
            </p>
          )}

          {isOwner && (
            <div className="pt-1 border-t border-amber-500/20">
              <p className="text-[10px] text-muted-foreground mb-2">
                Emergency only — refunds the player and returns house stake to the pool (not a Stockfish win payout).
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runWrite("cancelActiveGame", [BigInt(state.activeGame!.gameId)])}
                disabled={writing}
              >
                cancelActiveGame(#{state.activeGame.gameId})
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border bg-background/80 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Coins className="h-4 w-4 text-primary" />
          Fund house pool
        </div>
        <p className="text-xs text-muted-foreground">
          Owner wallet calls <span className="font-mono">depositHouse()</span> and sends TITAN into the
          contract. Needs at least the next player&apos;s stake before matches can start.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor={`deposit-${recordId}`} className="text-xs">
              depositHouse() — amount ({APP_CONFIG.titan.nativeToken.symbol})
            </Label>
            <Input
              id={`deposit-${recordId}`}
              value={depositTitan}
              onChange={(e) => setDepositTitan(e.target.value)}
              className="font-mono text-xs"
              inputMode="decimal"
              placeholder="2"
            />
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => void depositHouse()}
            disabled={writing || !isOwner}
          >
            {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            Deposit to house
          </Button>
        </div>
        {!isOwner && walletReady && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Connect the <strong>owner</strong> wallet ({state ? shortAddress(state.owner) : "deployer"}) to
            fund the pool.
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-600 break-all">{error}</p>}
      {lastTx && (
        <p className="text-[10px] font-mono text-muted-foreground break-all">Last tx: {lastTx}</p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 ${highlight ? "border-primary/40 bg-primary/5" : "bg-background/60"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}