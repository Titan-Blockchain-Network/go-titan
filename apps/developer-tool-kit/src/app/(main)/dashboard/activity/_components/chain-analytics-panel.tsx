"use client";

import { useMemo } from "react";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  type AnalyticsBlock,
  averageBlockTime,
  computeBlockIntervals,
  computeGasPerBlock,
  computeTxPerBlock,
  totalTransactions,
} from "@/lib/titan/chain-analytics";

const intervalConfig = {
  intervalSec: { label: "Block time", color: "var(--chart-1)" },
} satisfies ChartConfig;

const txConfig = {
  value: { label: "Transactions", color: "var(--chart-2)" },
} satisfies ChartConfig;

const gasConfig = {
  value: { label: "Gas used", color: "var(--chart-3)" },
} satisfies ChartConfig;

interface ChainAnalyticsPanelProps {
  blocks: AnalyticsBlock[];
}

export function ChainAnalyticsPanel({ blocks }: ChainAnalyticsPanelProps) {
  const intervals = useMemo(() => computeBlockIntervals(blocks), [blocks]);
  const txSeries = useMemo(() => computeTxPerBlock(blocks), [blocks]);
  const gasSeries = useMemo(() => computeGasPerBlock(blocks), [blocks]);
  const avgBlockSec = averageBlockTime(intervals);
  const txTotal = totalTransactions(blocks);

  if (blocks.length < 2) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Load at least two blocks to see chain analytics charts.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground font-medium">Avg block time</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">
              {avgBlockSec != null ? `${avgBlockSec.toFixed(2)}s` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">From {intervals.length} intervals</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground font-medium">Tx in sample</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">{txTotal.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Across {blocks.length} blocks</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground font-medium">Avg tx / block</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">
              {(txTotal / Math.max(blocks.length, 1)).toFixed(2)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">In loaded window</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Block time</CardTitle>
            <CardDescription>Seconds between consecutive blocks in the loaded window</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={intervalConfig} className="aspect-[2/1] w-full min-h-[200px]">
              <LineChart data={intervals} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={(v) => `${v}s`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="intervalSec" stroke="var(--color-intervalSec)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transactions per block</CardTitle>
            <CardDescription>Activity density across the loaded chain segment</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={txConfig} className="aspect-[2/1] w-full min-h-[200px]">
              <BarChart data={txSeries} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--color-value)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gas used per block</CardTitle>
          <CardDescription>C-chain execution cost across loaded blocks</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={gasConfig} className="aspect-[3/1] w-full min-h-[180px]">
            <BarChart data={gasSeries} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : String(v))}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}