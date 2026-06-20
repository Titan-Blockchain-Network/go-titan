'use client';

import { motion } from 'framer-motion';
import type { WagerSession } from '@/hooks/useWagerSession';

interface WagerBannerProps {
  session: WagerSession;
  houseUnderfunded?: boolean;
  onCancel?: () => void;
}

export function WagerBanner({ session, houseUnderfunded, onCancel }: WagerBannerProps) {
  if (session.phase === 'idle' || session.phase === 'modal') return null;

  const isWaiting = session.phase === 'waiting';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-xl px-4 py-3 mb-3"
      style={{
        borderColor: isWaiting ? 'rgba(201,168,76,0.25)' : 'rgba(34,197,94,0.25)',
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-secondary)' }}>
            {isWaiting ? 'Waiting for match' : session.phase === 'settled' ? 'Wager settled' : 'Active wager'}
          </div>
          <div className="text-sm font-medium break-words" style={{ color: 'var(--gold-secondary)' }}>
            {session.opponentType === 'stockfish' ? '🤖' : '👤'} vs {session.opponentLabel}
            {' · '}
            {session.stake} TITAN
            {session.potTitan !== '0' && ` · Pot ${session.potTitan}`}
            {session.isPractice && ' · Practice'}
          </div>
          {isWaiting && session.queuePosition != null && (
            <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Queue position #{session.queuePosition}
            </div>
          )}
          {isWaiting && houseUnderfunded && session.opponentType === 'stockfish' && (
            <div className="text-xs mt-1.5 leading-relaxed" style={{ color: '#ff8a8a' }}>
              House pool is empty — owner must call <span className="font-mono">depositHouse()</span> with
              at least {session.stake} TITAN before the operator can start your match. Leave queue or play
              Practice instead.
            </div>
          )}
        </div>
        {isWaiting && onCancel && (
          <button
            onClick={onCancel}
            className="text-xs px-3 py-2.5 rounded-lg shrink-0 min-h-[44px] sm:min-h-0 sm:py-1.5 w-full sm:w-auto"
            style={{
              background: 'rgba(255,107,107,0.1)',
              border: '1px solid rgba(255,107,107,0.25)',
              color: '#ff8a8a',
            }}
          >
            Leave queue
          </button>
        )}
      </div>
    </motion.div>
  );
}