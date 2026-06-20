'use client';

import { Loader2 } from 'lucide-react';
import type { useEscrowOperator } from '@/hooks/useEscrowOperator';
import { formatEther } from 'viem';

type OperatorState = ReturnType<typeof useEscrowOperator>;

interface EscrowOperatorPanelProps {
  operator: OperatorState;
}

export function EscrowOperatorPanel({ operator }: EscrowOperatorPanelProps) {
  if (!operator.isOperator) return null;

  return (
    <div
      className="glass rounded-xl px-4 py-3"
      style={{ borderColor: 'rgba(96,165,250,0.35)' }}
    >
      <div className="text-xs uppercase tracking-widest mb-1" style={{ color: '#93c5fd' }}>
        House operator
      </div>
      <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
        Auto-starts queued matches and settles payouts on-chain.
      </p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>House pool</span>
          <p className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatEther(operator.houseBankroll)} T
          </p>
        </div>
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>Queue</span>
          <p className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {operator.queueLength}
          </p>
        </div>
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>Active</span>
          <p className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {operator.activeGames}
          </p>
        </div>
      </div>
      {operator.nextStake != null && operator.queueLength > 0 && operator.activeGames === 0 && (
        <p className="text-[10px] mt-2" style={{ color: 'var(--text-secondary)' }}>
          Next stake: {formatEther(operator.nextStake)} TITAN
        </p>
      )}
      {(operator.isWritePending || operator.isConfirming) && (
        <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: '#93c5fd' }}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Operator transaction…
        </p>
      )}
    </div>
  );
}