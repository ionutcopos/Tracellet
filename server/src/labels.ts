import type { ChainFamily, LabelType } from "./types.ts";
import { SOLANA_LABELS } from "./labels/solana.ts";

// Entity labeling. Two honest tiers, no guessing:
//
//   Tier 1 — curated address map (per chain, in ./labels/). A WRONG "Binance"
//   label is worse than none, so entries are stable, public, Solscan/Etherscan-
//   verified addresses only. Extend from a labels dataset, not by guessing.
//
//   Tier 2 — protocol context from Helius. Every enhanced transaction carries a
//   `source` (PUMP_FUN, JUPITER, RAYDIUM…). When a counterparty has no curated
//   label, we fall back to the protocol the transfer flowed through — accurate
//   (Helius tells us the program) and turns a raw address into "pump.fun".

export interface Label {
  label: string;
  type: LabelType;
}

// isExchange is derived, never stored, so it can't drift from `type`.
export function isExchangeType(type: LabelType | null): boolean {
  return type === "cex";
}

export const ENTITY_LABELS: Record<ChainFamily, Record<string, Label>> = {
  solana: SOLANA_LABELS,
  evm: {
    "0x000000000000000000000000000000000000dead": { label: "Burn", type: "burn" },
  },
  bitcoin: {},
  tron: {},
};

// Tier 2 — Helius `source` enum → protocol label + category. Only well-known
// venues; generic sources (SYSTEM_PROGRAM, UNKNOWN…) map to null so we never slap
// a protocol name on an ordinary wallet-to-wallet transfer.
const SOURCE_LABELS: Record<string, Label> = {
  PUMP_FUN: { label: "pump.fun", type: "dex" },
  PUMP_AMM: { label: "PumpSwap", type: "dex" },
  JUPITER: { label: "Jupiter", type: "dex" },
  RAYDIUM: { label: "Raydium", type: "dex" },
  ORCA: { label: "Orca", type: "dex" },
  METEORA: { label: "Meteora", type: "dex" },
  PHOENIX: { label: "Phoenix", type: "dex" },
  LIFINITY: { label: "Lifinity", type: "dex" },
  ALDRIN: { label: "Aldrin", type: "dex" },
  SABER: { label: "Saber", type: "dex" },
  SERUM: { label: "Serum", type: "dex" },
  MAGIC_EDEN: { label: "Magic Eden", type: "program" },
  TENSOR: { label: "Tensor", type: "program" },
  HADESWAP: { label: "Hadeswap", type: "dex" },
  JITO: { label: "Jito", type: "staking" },
};

export function entityLabel(family: ChainFamily, address: string): Label | null {
  return ENTITY_LABELS[family]?.[address] ?? null;
}

export function sourceLabel(source: string | undefined): Label | null {
  if (!source) return null;
  return SOURCE_LABELS[source] ?? null;
}
