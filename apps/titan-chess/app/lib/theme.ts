export type ChessTheme = 'gold' | 'blue' | 'green';

export const CHESS_THEMES: { id: ChessTheme; label: string }[] = [
  { id: 'gold', label: 'Gold' },
  { id: 'blue', label: 'Blue' },
  { id: 'green', label: 'Green' },
];

const STORAGE_KEY = 'titan-chess-theme';

export function readChessTheme(): ChessTheme {
  if (typeof window === 'undefined') return 'gold';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'blue' || raw === 'green' || raw === 'gold') return raw;
  } catch {
    /* ignore */
  }
  return 'gold';
}

export function writeChessTheme(theme: ChessTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.dataset.theme = theme;
  } catch {
    /* ignore */
  }
}

export function applyChessTheme(theme: ChessTheme) {
  document.documentElement.dataset.theme = theme;
}