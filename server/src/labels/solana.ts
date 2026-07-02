import type { Label } from "../labels.ts";

// Curated Solana entity labels — Solscan-verified addresses only.
// Grouped by category. `type: "cex"` is what makes "to exchanges" fire, so those
// must be real exchange-owned addresses (hot/omnibus wallets). Per-user CEX
// deposit addresses are ephemeral and NOT enumerable here — that needs a labels
// API (documented limitation). Extend this map as addresses are verified.
export const SOLANA_LABELS: Record<string, Label> = {
  // --- infrastructure ---
  "1nc1nerator11111111111111111111111111111111": { label: "Burn (Incinerator)", type: "burn" },
  "So11111111111111111111111111111111111111112": { label: "Wrapped SOL", type: "program" },

  // --- CEX, DEX, bridges, staking: seeded in Phase 2 after Solscan verification ---
};
