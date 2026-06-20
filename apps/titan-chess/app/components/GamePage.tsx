'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Chess } from 'chess.js';
import { ChessBoard } from '@/components/board/ChessBoard';
import { GameHUD } from '@/components/hud/GameHUD';
import { GameOverOverlay } from '@/components/ui/GameOverOverlay';
import { NewGameModal } from '@/components/ui/NewGameModal';
import { WalletButton } from '@/components/wallet/WalletButton';
import { useChessGame } from '@/hooks/useChessGame';
import { useEscrowOperator } from '@/hooks/useEscrowOperator';
import { useWagerSession } from '@/hooks/useWagerSession';
import { EscrowOutcome } from '@/lib/escrow-abi';
import { TITAN_NETWORK } from '@/lib/titan-config';
import { parseEther } from 'viem';
import type { Color } from 'chess.js';

export function GamePage() {
  const {
    gameState,
    selectedSquare,
    legalMoves,
    stockfishDepth,
    isAiThinking,
    playerColor,
    opponentType,
    isMatchActive,
    selectSquare,
    startMatch,
    endMatch,
    updateDifficulty,
    applyRemoteFen,
    setMoveSyncHandler,
  } = useChessGame();

  const wagerCallbacks = useRef({
    onMatchStart: (_type: 'stockfish' | 'human', _color: Color) => {},
    onMatchEnd: () => {},
  });

  wagerCallbacks.current.onMatchStart = (type, color) => startMatch(type, color);
  wagerCallbacks.current.onMatchEnd = () => endMatch();

  const wager = useWagerSession({
    onMatchStart: (type, color) => wagerCallbacks.current.onMatchStart(type, color),
    onMatchEnd: () => wagerCallbacks.current.onMatchEnd(),
  });

  const operator = useEscrowOperator();
  const [settlementStatus, setSettlementStatus] = useState<
    'none' | 'pending' | 'submitting' | 'done'
  >('none');
  const settledGameIdRef = useRef<bigint | null>(null);

  const [boardFlipped, setBoardFlipped] = useState(false);
  const lastRoomFenRef = useRef('');

  const handleFlipBoard = useCallback(() => {
    setBoardFlipped((f) => !f);
  }, []);

  const effectiveColor: Color = boardFlipped
    ? playerColor === 'w' ? 'b' : 'w'
    : playerColor;

  // Sync local moves to PvP room
  useEffect(() => {
    if (wager.session.phase !== 'playing' || wager.session.opponentType !== 'human') {
      setMoveSyncHandler(null);
      return;
    }
    if (!wager.session.roomId) return;

    setMoveSyncHandler((fen, lastMove) => {
      let winner: 'white' | 'black' | 'draw' | undefined;
      const chess = new Chess(fen);
      if (chess.isGameOver()) {
        if (chess.isDraw()) winner = 'draw';
        else winner = chess.turn() === 'w' ? 'black' : 'white';
        wager.settleSession();
      }
      wager.matchmaking.syncRoom(wager.session.roomId!, fen, lastMove, winner);
    });
  }, [
    wager.session.phase,
    wager.session.opponentType,
    wager.session.roomId,
    setMoveSyncHandler,
    wager.matchmaking,
    wager.settleSession,
  ]);

  // Poll opponent moves in PvP
  useEffect(() => {
    if (wager.session.phase !== 'playing' || wager.session.opponentType !== 'human') return;
    if (!wager.session.roomId) return;

    const room = wager.matchmaking.activeRoom;
    if (!room || room.id !== wager.session.roomId) return;
    if (room.fen === lastRoomFenRef.current) return;
    if (room.fen === gameState.fen) {
      lastRoomFenRef.current = room.fen;
      return;
    }

    lastRoomFenRef.current = room.fen;
    applyRemoteFen(room.fen, room.lastMove);

    if (room.status === 'finished') {
      wager.settleSession();
    }
  }, [
    wager.session,
    wager.matchmaking.activeRoom,
    gameState.fen,
    applyRemoteFen,
    wager.settleSession,
  ]);

  // Settle Stockfish wagers on game over + operator payout
  useEffect(() => {
    if (!isMatchActive || opponentType !== 'stockfish') return;
    if (!gameState.isGameOver) return;

    wager.settleSession();

    const gameId = wager.session.escrowGameId;
    if (!wager.escrow.enabled || gameId == null || wager.session.isPractice) {
      setSettlementStatus('none');
      return;
    }

    if (settledGameIdRef.current === gameId) return;

    const playerWon =
      gameState.isCheckmate &&
      ((gameState.turn === 'w' && playerColor === 'b') ||
        (gameState.turn === 'b' && playerColor === 'w'));

    let outcome = EscrowOutcome.Draw;
    if (gameState.isCheckmate) {
      outcome = playerWon ? EscrowOutcome.PlayerWins : EscrowOutcome.StockfishWins;
    }

    if (operator.isOperator) {
      settledGameIdRef.current = gameId;
      setSettlementStatus('submitting');
      operator.reportResult(gameId, outcome);
    } else {
      setSettlementStatus('pending');
    }
  }, [
    isMatchActive,
    opponentType,
    gameState.isGameOver,
    gameState.isCheckmate,
    gameState.isDraw,
    gameState.turn,
    playerColor,
    wager.settleSession,
    wager.session.escrowGameId,
    wager.session.isPractice,
    wager.escrow.enabled,
    operator.isOperator,
    operator.reportResult,
  ]);

  useEffect(() => {
    if (operator.isConfirmed && settlementStatus === 'submitting') {
      setSettlementStatus('done');
    }
  }, [operator.isConfirmed, settlementStatus]);

  const handleNewGame = useCallback(() => {
    settledGameIdRef.current = null;
    setSettlementStatus('none');
    wager.resetSession();
    endMatch();
    wager.openNewGameModal();
  }, [wager, endMatch]);

  const showOverlay =
    isMatchActive && gameState.isGameOver && wager.session.phase !== 'idle';

  const queuedStakeWei =
    wager.session.phase === 'waiting' && wager.session.opponentType === 'stockfish'
      ? parseEther(wager.session.stake || '0')
      : BigInt(0);
  const houseUnderfunded =
    wager.escrow.enabled &&
    wager.session.phase === 'waiting' &&
    wager.session.opponentType === 'stockfish' &&
    wager.escrow.houseBankroll < queuedStakeWei;

  return (
    <div
      className="min-h-screen min-h-[100dvh] flex flex-col overflow-x-hidden w-full max-w-[100vw]"
      style={{
        background:
          'radial-gradient(ellipse at top, #1a1a22 0%, #0f0f11 60%)',
      }}
    >
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between gap-2 px-safe py-3 sm:px-6 sm:py-4 border-b pt-safe shrink-0"
        style={{ borderColor: 'var(--bg-glass-border)' }}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div
            className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--gold-primary), var(--bronze))',
              color: '#0f0f11',
            }}
          >
            ♟
          </div>
          <div className="min-w-0">
            <h1
              className="text-base sm:text-lg font-bold tracking-tight leading-none truncate"
              style={{
                background: 'linear-gradient(135deg, var(--gold-primary), var(--gold-secondary))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              TITAN CHESS
            </h1>
            <p
              className="text-[10px] sm:text-xs leading-none mt-0.5 truncate hidden sm:block"
              style={{ color: 'var(--text-secondary)' }}
            >
              {TITAN_NETWORK.name} · On-Chain
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{
              background: 'var(--gold-dim)',
              border: '1px solid rgba(201,168,76,0.2)',
              color: 'var(--gold-secondary)',
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: 'var(--gold-primary)',
                boxShadow: '0 0 4px var(--gold-primary)',
              }}
            />
            {TITAN_NETWORK.name}
          </div>
          <div className="lg:hidden max-w-[9.5rem] sm:max-w-none">
            <WalletButton compact />
          </div>
        </div>
      </motion.header>

      <main className="flex-1 flex flex-col lg:flex-row gap-3 sm:gap-4 lg:gap-6 px-safe py-3 sm:p-4 lg:p-6 max-w-7xl mx-auto w-full min-h-0 min-w-0 overflow-x-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex-1 flex items-start lg:items-center justify-center w-full min-w-0 max-w-full overflow-hidden shrink-0"
        >
          <div className="relative w-full min-w-0 max-w-full overflow-hidden">
            {!isMatchActive && wager.session.phase !== 'waiting' && (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl px-6"
                style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
              >
                <button
                  onClick={() => wager.startStockfishPractice()}
                  className="px-6 py-3.5 rounded-xl font-semibold text-sm w-full max-w-xs min-h-[48px]"
                  style={{
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--bg-glass-border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Practice vs Stockfish
                </button>
                <button
                  onClick={handleNewGame}
                  className="px-6 py-3.5 rounded-xl font-semibold text-sm w-full max-w-xs min-h-[48px]"
                  style={{
                    background: 'linear-gradient(135deg, var(--gold-primary), var(--gold-secondary))',
                    color: '#0f0f11',
                  }}
                >
                  Wagered Game
                </button>
                <p className="text-xs text-center max-w-xs" style={{ color: 'var(--text-secondary)' }}>
                  Practice is free and instant. Wagers use on-chain escrow.
                </p>
              </div>
            )}
            <ChessBoard
              gameState={gameState}
              selectedSquare={selectedSquare}
              legalMoves={legalMoves}
              onSquareClick={selectSquare}
              playerColor={effectiveColor}
              isAiThinking={isAiThinking}
            />
            <AnimatePresence>
              {showOverlay && (
                <GameOverOverlay
                  gameState={gameState}
                  playerColor={playerColor}
                  wagerSession={wager.session}
                  settlementStatus={settlementStatus}
                  onRematch={handleNewGame}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <GameHUD
          gameState={gameState}
          isAiThinking={isAiThinking}
          stockfishDepth={stockfishDepth}
          playerColor={playerColor}
          opponentType={opponentType}
          isMatchActive={isMatchActive}
          wagerSession={wager.session}
          houseUnderfunded={houseUnderfunded}
          escrowOperator={operator}
          onDifficultyChange={updateDifficulty}
          onNewGame={handleNewGame}
          onFlipBoard={handleFlipBoard}
          onCancelWager={wager.cancelWaiting}
        />
      </main>

      <NewGameModal
        open={wager.showModal}
        onClose={wager.closeModal}
        onPlayPractice={wager.startStockfishPractice}
        onPlayStockfish={wager.startStockfishWager}
        onPlayHuman={wager.startHumanWager}
        waitingPlayers={wager.waitingPlayers}
        stakeBounds={wager.escrow.stakeBounds}
        escrowEnabled={wager.escrow.enabled}
        isConnected={wager.isConnected}
        isLoading={wager.escrow.isWritePending || wager.escrow.isConfirming || wager.matchmaking.isJoining}
        error={wager.session.error}
      />
    </div>
  );
}