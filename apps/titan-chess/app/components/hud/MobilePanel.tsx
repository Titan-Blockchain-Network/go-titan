'use client';

import type { ReactNode } from 'react';

interface MobilePanelProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function MobilePanel({ title, defaultOpen = false, children }: MobilePanelProps) {
  return (
    <details
      className="glass rounded-xl overflow-hidden lg:hidden"
      open={defaultOpen}
    >
      <summary
        className="px-4 py-3.5 cursor-pointer list-none flex items-center justify-between text-xs uppercase tracking-widest min-h-[48px] [&::-webkit-details-marker]:hidden"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span>{title}</span>
        <span
          className="panel-chevron text-[10px] transition-transform"
          style={{ color: 'var(--gold-secondary)' }}
          aria-hidden
        >
          ▼
        </span>
      </summary>
      <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--bg-glass-border)' }}>
        {children}
      </div>
    </details>
  );
}