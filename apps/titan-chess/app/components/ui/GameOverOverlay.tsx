'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { GameState } from '@/types/chess';
import type { WagerSession } from '@/hooks/useWagerSession';
import type { Color } from 'chess.js';

type SettlementStatus = 'none' | 'pending' | 'submitting' | 'done';

interface GameOverOverlayProps {
  gameState: GameState;
  playerColor: Color;
  wagerSession: WagerSession;
  settlementStatus?: SettlementStatus;
  onRematch: () => void;
}

export function GameOverOverlay({
  gameState,
  playerColor,
  wagerSession,
  settlementStatus = 'none',
  onRematch,
}: GameOverOverlayProps) {
  const { isCheckmate, isDraw, turn } = gameState;
  const show = isCheckmate || isDraw;

  const youWon =
    isCheckmate &&
    ((turn === 'w' && playerColor === 'b') || (turn === 'b' && playerColor === 'w'));

  const winner = isCheckmate ? (turn === 'w' ? 'Black' : 'White') : null;

  const stockfishWon = isCheckmate && !youWon;

  const payoutText = wagerSession.isPractice
    ? 'Practice game — no on-chain payout'
    : settlementStatus === 'pending'
      ? `Outcome recorded — settlement will complete shortly (${wagerSession.potTitan} TITAN)`
      : settlementStatus === 'submitting'
        ? 'Settling wager on Titan…'
        : settlementStatus === 'done'
          ? youWon
            ? `Paid out ${wagerSession.potTitan} TITAN to your wallet`
            : isDraw
              ? `Draw — stakes refunded on-chain`
              : stockfishWon
                ? `${wagerSession.potTitan} TITAN returned to the house pool`
                : `House won ${wagerSession.potTitan} TITAN on-chain`
          : youWon
            ? `You won ${wagerSession.potTitan} TITAN`
            : isDraw
              ? `Draw — ${wagerSession.stake} TITAN refunded`
              : stockfishWon
                ? `Stockfish wins — ${wagerSession.stake} TITAN goes to the house pool`
                : `You lost ${wagerSession.stake} TITAN`;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 flex items-center justify-center z-20"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="glass rounded-2xl p-6 sm:p-8 text-center max-w-xs mx-3 sm:mx-4"
            style={{ borderColor: 'rgba(201,168,76,0.3)' }}
          >
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="text-5xl mb-4"
            >
              {isCheckmate ? (youWon ? '♔' : '♚') : '🤝'}
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-bold mb-1"
              style={{
                background: 'linear-gradient(135deg, var(--gold-primary), var(--gold-secondary))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {isCheckmate ? (youWon ? 'Victory!' : 'Checkmate!') : 'Draw!'}
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-sm mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {winner && !youWon ? `${winner} wins the match` : isDraw ? 'The game ends in a draw' : 'You took the pot'}
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
              className="text-xs mb-6"
              style={{ color: 'var(--gold-secondary)' }}
            >
              {payoutText}
            </motion.p>

            <div
              className="w-16 h-px mx-auto mb-6"
              style={{ background: 'linear-gradient(to right, transparent, var(--gold-primary), transparent)' }}
            />

            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              onClick={onRematch}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="w-full py-3 rounded-xl font-semibold text-sm"
              style={{
                background: 'linear-gradient(135deg, var(--gold-primary), var(--gold-secondary))',
                color: '#0f0f11',
              }}
            >
              New Wagered Game
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}