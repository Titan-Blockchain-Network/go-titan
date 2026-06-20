export interface AnalyticsBlock {
  number: string;
  timestamp: string;
  gasUsed: string;
  transactionCount?: number;
  transactions?: unknown[];
}

export interface BlockIntervalPoint {
  block: number;
  intervalSec: number;
  label: string;
}

export interface BlockMetricPoint {
  block: number;
  value: number;
  label: string;
}

function hexToNumber(hex?: string): number | null {
  if (!hex) return null;
  try {
    return Number.parseInt(hex, 16);
  } catch {
    return null;
  }
}

function txCount(block: AnalyticsBlock): number {
  if (block.transactionCount != null) return block.transactionCount;
  return Array.isArray(block.transactions) ? block.transactions.length : 0;
}

/** Blocks sorted newest-first → interval between consecutive blocks (seconds). */
export function computeBlockIntervals(blocks: AnalyticsBlock[]): BlockIntervalPoint[] {
  const sorted = [...blocks]
    .map((b) => ({
      block: hexToNumber(b.number) ?? 0,
      ts: hexToNumber(b.timestamp) ?? 0,
    }))
    .filter((b) => b.block > 0 && b.ts > 0)
    .sort((a, b) => b.block - a.block);

  const points: BlockIntervalPoint[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const newer = sorted[i];
    const older = sorted[i + 1];
    const intervalSec = Math.max(0, newer.ts - older.ts);
    points.push({
      block: newer.block,
      intervalSec,
      label: `#${newer.block.toLocaleString()}`,
    });
  }
  return points.reverse();
}

export function computeTxPerBlock(blocks: AnalyticsBlock[]): BlockMetricPoint[] {
  return [...blocks]
    .map((b) => {
      const block = hexToNumber(b.number) ?? 0;
      return {
        block,
        value: txCount(b),
        label: `#${block.toLocaleString()}`,
      };
    })
    .filter((p) => p.block > 0)
    .sort((a, b) => a.block - b.block);
}

export function computeGasPerBlock(blocks: AnalyticsBlock[]): BlockMetricPoint[] {
  return [...blocks]
    .map((b) => {
      const block = hexToNumber(b.number) ?? 0;
      return {
        block,
        value: hexToNumber(b.gasUsed) ?? 0,
        label: `#${block.toLocaleString()}`,
      };
    })
    .filter((p) => p.block > 0)
    .sort((a, b) => a.block - b.block);
}

export function averageBlockTime(intervals: BlockIntervalPoint[]): number | null {
  if (intervals.length === 0) return null;
  const sum = intervals.reduce((a, p) => a + p.intervalSec, 0);
  return sum / intervals.length;
}

export function totalTransactions(blocks: AnalyticsBlock[]): number {
  return blocks.reduce((sum, b) => sum + txCount(b), 0);
}