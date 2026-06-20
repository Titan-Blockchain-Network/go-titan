'use client';

import { useEffect, useState } from 'react';

import {
  applyChessTheme,
  CHESS_THEMES,
  readChessTheme,
  writeChessTheme,
  type ChessTheme,
} from '@/lib/theme';

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ChessTheme>('gold');

  useEffect(() => {
    const initial = readChessTheme();
    setTheme(initial);
    applyChessTheme(initial);
  }, []);

  function select(next: ChessTheme) {
    setTheme(next);
    writeChessTheme(next);
  }

  return (
    <div
      className={`flex items-center gap-1 rounded-xl p-1 ${compact ? 'w-full' : ''}`}
      style={{
        background: 'var(--bg-glass)',
        border: '1px solid var(--bg-glass-border)',
      }}
      role="group"
      aria-label="Color theme"
    >
      {CHESS_THEMES.map((item) => {
        const active = theme === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => select(item.id)}
            className={`flex-1 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors min-h-[36px] ${
              compact ? 'min-h-[40px]' : ''
            }`}
            style={{
              background: active ? 'var(--accent-dim)' : 'transparent',
              color: active ? 'var(--accent-secondary)' : 'var(--text-secondary)',
              border: active ? '1px solid var(--accent-border)' : '1px solid transparent',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}