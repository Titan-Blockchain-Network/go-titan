"use client";

import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TITAN_CHAIN_META, TITAN_VM_CHAINS, type TitanVmChain } from "@/lib/titan/chains";
import { cn } from "@/lib/utils";
import { useTitanChainStore } from "@/stores/titan/chain-store";

export function ChainSwitcher() {
  const chain = useTitanChainStore((s) => s.chain);
  const setChain = useTitanChainStore((s) => s.setChain);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ width: 0, left: 0 });

  useEffect(() => {
    const track = trackRef.current;
    const active = track?.querySelector<HTMLElement>(`[data-chain="${chain}"]`);
    if (!track || !active) return;

    setThumb({
      width: active.offsetWidth,
      left: active.offsetLeft,
    });
  }, [chain]);

  return (
    <div
      ref={trackRef}
      className="relative inline-flex rounded-lg border bg-muted/40 p-0.5"
      role="tablist"
      aria-label="Select Avalanche VM chain"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 rounded-[calc(var(--radius-md)-2px)] bg-primary shadow-sm transition-[left,width] duration-250 ease-out"
        style={{ width: thumb.width, left: thumb.left }}
      />
      {TITAN_VM_CHAINS.map((id) => {
        const meta = TITAN_CHAIN_META[id];
        const active = chain === id;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-chain={id}
                role="tab"
                aria-selected={active}
                aria-label={meta.name}
                onClick={() => setChain(id)}
                className={cn(
                  "relative z-10 min-w-9 px-3 py-1.5 font-mono text-xs font-semibold transition-colors duration-200",
                  active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {meta.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-center">
              <p className="font-medium">{meta.name}</p>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function ChainSwitcherLabel({ chain }: { chain: TitanVmChain }) {
  const meta = TITAN_CHAIN_META[chain];
  return <span className="text-muted-foreground">{meta.name}</span>;
}