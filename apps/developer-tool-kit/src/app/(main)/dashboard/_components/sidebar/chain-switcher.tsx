"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TITAN_CHAIN_META, TITAN_VM_CHAINS, type TitanVmChain } from "@/lib/titan/chains";
import { useTitanChainStore } from "@/stores/titan/chain-store";

export function ChainSwitcher() {
  const chain = useTitanChainStore((s) => s.chain);
  const setChain = useTitanChainStore((s) => s.setChain);

  return (
    <ToggleGroup
      type="single"
      value={chain}
      onValueChange={(value) => {
        if (value === "C" || value === "P" || value === "X") {
          setChain(value);
        }
      }}
      variant="outline"
      size="sm"
      className="bg-background"
      aria-label="Select Avalanche VM chain"
    >
      {TITAN_VM_CHAINS.map((id) => {
        const meta = TITAN_CHAIN_META[id];
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={id}
                className="min-w-9 px-2.5 font-mono text-xs font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                aria-label={meta.name}
              >
                {meta.label}
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-center">
              <p className="font-medium">{meta.name}</p>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}

export function ChainSwitcherLabel({ chain }: { chain: TitanVmChain }) {
  const meta = TITAN_CHAIN_META[chain];
  return (
    <span className="text-muted-foreground">
      {meta.name}
    </span>
  );
}