import type { ChainFamily } from "./types.ts";

// Entity labeling. Two honest tiers, no guessing:
//
//   Tier 1 — curated address map. A WRONG "Binance" label is worse than none, so
//   this only holds addresses that are stable, public, and verifiable. It is
//   intentionally small; extend it from a labels dataset (Solana FM / Arkham /
//   a maintained list) rather than by guessing.
//
//   Tier 2 — protocol context from Helius. Every enhanced transaction carries a
//   `source` (PUMP_FUN, JUPITER, RAYDIUM…). When a recipient has no curated label,
//   we fall back to the protocol the transfer flowed through. This is accurate
//   (Helius tells us the program) and turns a raw address into "pump.fun".

export interface Label {
  label: string;
  isExchange: boolean;
}

// Tier 1 — curated, high-confidence addresses only.
export const ENTITY_LABELS: Record<ChainFamily, Record<string, Label>> = {
  solana: {
    "1nc1nerator11111111111111111111111111111111": { label: "Burn (Incinerator)", isExchange: false },
    "So11111111111111111111111111111111111111112": { label: "Wrapped SOL", isExchange: false },
  },
  evm: {
    "0x000000000000000000000000000000000000dead": { label: "Burn", isExchange: false },
  },
  bitcoin: {},
  tron: {},
};

// Tier 2 — Helius `source` enum → friendly protocol name. Only well-known DeFi /
// NFT venues; generic sources (SYSTEM_PROGRAM, UNKNOWN…) map to null so we never
// slap a protocol name on an ordinary wallet-to-wallet transfer.
const SOURCE_LABELS: Record<string, string> = {
  PUMP_FUN: "pump.fun",
  PUMP_AMM: "PumpSwap",
  JUPITER: "Jupiter",
  RAYDIUM: "Raydium",
  ORCA: "Orca",
  METEORA: "Meteora",
  PHOENIX: "Phoenix",
  LIFINITY: "Lifinity",
  ALDRIN: "Aldrin",
  SABER: "Saber",
  SERUM: "Serum",
  MAGIC_EDEN: "Magic Eden",
  TENSOR: "Tensor",
  HADESWAP: "Hadeswap",
  JITO: "Jito",
};

export function entityLabel(family: ChainFamily, address: string): Label | null {
  return ENTITY_LABELS[family]?.[address] ?? null;
}

export function sourceLabel(source: string | undefined): string | null {
  if (!source) return null;
  return SOURCE_LABELS[source] ?? null;
}
