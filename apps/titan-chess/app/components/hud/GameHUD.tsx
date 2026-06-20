'use client';

import { motion } from 'framer-motion';
import { TitanBalance } from './TitanBalance';
import { DifficultySlider } from './DifficultySlider';
import { MoveList } from './MoveList';
import { StatusBar } from './StatusBar';
import { WalletButton } from '@/components/wallet/WalletButton';
import { WagerBanner } from '@/components/ui/WagerBanner';
import { EscrowOperatorPanel } from '@/components/hud/EscrowOperatorPanel';
import { MobilePanel } from '@/components/hud/MobilePanel';
import type { GameState } from '@/types/chess';
import type { OpponentType, WagerSession } from '@/hooks/useWagerSession';
import type { useEscrowOperator } from '@/hooks/useEscrowOperator';

interface GameHUDProps {
  gameState: GameState;
  isAiThinking: boolean;
  stockfishDepth: number;
  playerColor: 'w' | 'b';
  opponentType: OpponentType | null;
  isMatchActive: boolean;
  wagerSession: WagerSession;
  houseUnderfunded?: boolean;
  escrowOperator: ReturnType<typeof useEscrowOperator>;
  onDifficultyChange: (v: number) => void;
  onNewGame: () => void;
  onFlipBoard: () => void;
  onCancelWager: () => void;
}

function ActionButtons({
  onFlipBoard,
  onNewGame,
  className = '',
}: {
  onFlipBoard: () => void;
  onNewGame: () => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 ${className}`}>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onFlipBoard}
        className="flex-1 py-3 sm:py-2.5 rounded-xl text-sm font-medium min-h-[44px]"
        style={{
          background: 'var(--bg-glass)',
          border: '1px solid var(--bg-glass-border)',
          color: 'var(--text-secondary)',
        }}
      >
        Flip Board
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onNewGame}
        className="flex-1 py-3 sm:py-2.5 rounded-xl text-sm font-semibold min-h-[44px]"
        style={{
          background: 'var(--gold-dim)',
          border: '1px solid rgba(201,168,76,0.3)',
          color: 'var(--gold-secondary)',
        }}
      >
        New Game
      </motion.button>
    </div>
  );
}

export function GameHUD({
  gameState,
  isAiThinking,
  stockfishDepth,
  playerColor,
  opponentType,
  isMatchActive,
  wagerSession,
  houseUnderfunded,
  escrowOperator,
  onDifficultyChange,
  onNewGame,
  onFlipBoard,
  onCancelWager,
}: GameHUDProps) {
  const showAiSlider = opponentType === 'stockfish' || opponentType === null;

  const statusBar = (
    <StatusBar
      gameState={gameState}
      isAiThinking={isAiThinking}
      playerColor={playerColor}
      opponentType={opponentType}
      isMatchActive={isMatchActive}
      wagerPhase={wagerSession.phase}
      houseUnderfunded={houseUnderfunded}
    />
  );

  const wagerBanner = (
    <WagerBanner
      session={wagerSession}
      houseUnderfunded={houseUnderfunded}
      onCancel={onCancelWager}
    />
  );

  return (
    <>
      {/* Desktop sidebar */}
      <motion.aside
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="hidden lg:flex flex-col gap-3 w-full lg:w-72 xl:w-80 shrink-0"
      >
        <div
          className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-2"
          style={{ borderColor: 'rgba(201,168,76,0.15)' }}
        >
          <div>
            <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-secondary)' }}>
              Titan Chess
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Avalanche L1
            </div>
          </div>
          <WalletButton compact />
        </div>

        <TitanBalance />
        {wagerBanner}
        <EscrowOperatorPanel operator={escrowOperator} />

        <div className="glass rounded-xl px-4 py-3">{statusBar}</div>

        {showAiSlider && (
          <DifficultySlider
            value={stockfishDepth}
            onChange={onDifficultyChange}
            disabled={isAiThinking || !isMatchActive}
          />
        )}

        <MoveList moves={gameState.moveHistory} />
        <ActionButtons onFlipBoard={onFlipBoard} onNewGame={onNewGame} />

        <div className="text-center">
          <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
            Practice free · wagers on-chain · chess.js
          </span>
        </div>
      </motion.aside>

      {/* Mobile panels — board stays on top in GamePage */}
      <div className="flex flex-col gap-3 w-full lg:hidden pb-24">
        <div className="glass rounded-xl px-4 py-3">{statusBar}</div>
        {wagerBanner}

        <MobilePanel title="Wallet & balance" defaultOpen={false}>
          <div className="space-y-3 pt-3">
            <WalletButton compact />
            <TitanBalance embedded />
          </div>
        </MobilePanel>

        {escrowOperator.isOperator && (
          <MobilePanel title="House operator" defaultOpen>
            <div className="pt-3">
              <EscrowOperatorPanel operator={escrowOperator} />
            </div>
          </MobilePanel>
        )}

        {showAiSlider && (
          <MobilePanel title="AI difficulty" defaultOpen={!isMatchActive}>
            <div className="pt-3">
              <DifficultySlider
                value={stockfishDepth}
                onChange={onDifficultyChange}
                disabled={isAiThinking || !isMatchActive}
                embedded
              />
            </div>
          </MobilePanel>
        )}

        <MobilePanel title="Move history" defaultOpen={isMatchActive}>
          <div className="pt-3">
            <MoveList moves={gameState.moveHistory} mobile />
          </div>
        </MobilePanel>
      </div>

      {/* Mobile sticky controls */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden glass border-t px-safe pb-safe pt-2"
        style={{ borderColor: 'var(--bg-glass-border)' }}
      >
        <div className="max-w-7xl mx-auto px-3">
          <ActionButtons onFlipBoard={onFlipBoard} onNewGame={onNewGame} />
        </div>
      </div>
    </>
  );
}