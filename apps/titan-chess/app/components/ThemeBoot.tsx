'use client';

import { useEffect } from 'react';

import { applyChessTheme, readChessTheme } from '@/lib/theme';

/** Applies saved theme on mount (layout is server-rendered). */
export function ThemeBoot() {
  useEffect(() => {
    applyChessTheme(readChessTheme());
  }, []);
  return null;
}