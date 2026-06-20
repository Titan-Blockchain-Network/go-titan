'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { titanSubnet } from '@/lib/web3';
import { EscrowOutcome, TITAN_CHESS_ESCROW_ABI } from '@/lib/escrow-abi';
import { ESCROW_ADDRESS, ESCROW_ENABLED } from '@/lib/escrow-config';

export function useEscrowOperator() {
  const { address } = useAccount();

  const { data: operatorAddress, refetch: refetchOperator } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'stockfishOperator',
    chainId: titanSubnet.id,
    query: { enabled: ESCROW_ENABLED },
  });

  const { data: queueLengthRaw, refetch: refetchQueue } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'queueLength',
    chainId: titanSubnet.id,
    query: { enabled: ESCROW_ENABLED, refetchInterval: 4_000 },
  });

  const { data: activeGamesRaw, refetch: refetchActive } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'activeGames',
    chainId: titanSubnet.id,
    query: { enabled: ESCROW_ENABLED, refetchInterval: 3_000 },
  });

  const { data: peekNext, refetch: refetchPeek } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'peekNextPlayer',
    chainId: titanSubnet.id,
    query: {
      enabled: ESCROW_ENABLED && Number(queueLengthRaw ?? 0) > 0,
      refetchInterval: 4_000,
    },
  });

  const isOperator =
    ESCROW_ENABLED &&
    Boolean(
      address &&
        operatorAddress &&
        address.toLowerCase() === (operatorAddress as string).toLowerCase()
    );

  const queueLength = Number(queueLengthRaw ?? 0);
  const activeGames = Number(activeGamesRaw ?? 0);
  const nextStake = peekNext?.[1];

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: titanSubnet.id,
  });

  const startingRef = useRef(false);

  const { data: houseBankrollRaw, refetch: refetchBankroll } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: TITAN_CHESS_ESCROW_ABI,
    functionName: 'houseBankroll',
    chainId: titanSubnet.id,
    query: { enabled: ESCROW_ENABLED, refetchInterval: 6_000 },
  });

  const houseBankroll = houseBankrollRaw ?? BigInt(0);

  const startNextMatch = useCallback(() => {
    if (!ESCROW_ENABLED || !ESCROW_ADDRESS || !isOperator || !nextStake) return;
    if (houseBankroll < nextStake) return;
    startingRef.current = true;
    writeContract({
      address: ESCROW_ADDRESS,
      abi: TITAN_CHESS_ESCROW_ABI,
      functionName: 'startNextMatch',
      chain: titanSubnet,
      account: address,
    });
  }, [isOperator, nextStake, houseBankroll, writeContract, address]);

  const reportResult = useCallback(
    (gameId: bigint, outcome: EscrowOutcome) => {
      if (!ESCROW_ENABLED || !ESCROW_ADDRESS || !isOperator) return;
      writeContract({
        address: ESCROW_ADDRESS,
        abi: TITAN_CHESS_ESCROW_ABI,
        functionName: 'reportResult',
        args: [gameId, outcome],
        chain: titanSubnet,
        account: address,
      });
    },
    [isOperator, writeContract, address]
  );

  const refetchAll = useCallback(() => {
    refetchOperator();
    refetchQueue();
    refetchActive();
    refetchPeek();
    refetchBankroll();
  }, [refetchOperator, refetchQueue, refetchActive, refetchPeek, refetchBankroll]);

  // House wallet: auto-open the next queued match when idle.
  useEffect(() => {
    if (!isOperator || isWritePending || isConfirming) return;
    if (queueLength === 0 || activeGames > 0 || !nextStake) return;
    if (houseBankroll < nextStake) return;
    if (startingRef.current) return;

    startNextMatch();
  }, [
    isOperator,
    isWritePending,
    isConfirming,
    queueLength,
    activeGames,
    nextStake,
    houseBankroll,
    startNextMatch,
  ]);

  useEffect(() => {
    if (isConfirmed) {
      startingRef.current = false;
      refetchAll();
    }
  }, [isConfirmed, refetchAll]);

  return {
    enabled: ESCROW_ENABLED,
    isOperator,
    operatorAddress: operatorAddress as `0x${string}` | undefined,
    queueLength,
    activeGames,
    nextPlayer: peekNext?.[0] as `0x${string}` | undefined,
    nextStake,
    houseBankroll,
    startNextMatch,
    reportResult,
    txHash,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,
    resetWrite,
    refetchAll,
  };
}