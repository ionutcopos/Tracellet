import type { ChainInfo } from "./types.ts";

// USD prices from DeFiLlama's free API — one source for native coins AND tokens
// across Solana and every EVM chain. No key. This is what lets the tracer value
// SOL, USDC, ETH and arbitrary tokens in one currency so they can be ranked together.

const LLAMA = "https://coins.llama.fi/prices/current/";

export interface PriceInfo {
  price: number;
  symbol: string | null;
}

// DeFiLlama coin id for a chain's native asset.
const NATIVE_ID: Record<string, string> = {
  solana: "coingecko:solana",
  ethereum: "coingecko:ethereum",
  base: "coingecko:ethereum",
  arbitrum: "coingecko:ethereum",
  polygon: "coingecko:matic-network",
  bsc: "coingecko:binancecoin",
};

export function nativeKey(chain: ChainInfo): string {
  return NATIVE_ID[chain.id] ?? `coingecko:${chain.id}`;
}

// DeFiLlama key for a token: "solana:<mint>" or "<evmchain>:<contract>".
export function tokenKey(chain: ChainInfo, address: string): string {
  return `${chain.id}:${address}`;
}

// Batch-fetch prices for a set of DeFiLlama coin ids. Best-effort: any failure just
// yields no price for those ids (the transfer's USD becomes null, not an error).
export async function fetchPrices(keys: string[]): Promise<Map<string, PriceInfo>> {
  const out = new Map<string, PriceInfo>();
  const uniq = [...new Set(keys)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    try {
      const res = await fetch(LLAMA + chunk.join(","));
      if (!res.ok) continue;
      const j = (await res.json()) as { coins?: Record<string, { price?: number; symbol?: string }> };
      for (const [k, v] of Object.entries(j.coins ?? {})) {
        if (typeof v.price === "number") out.set(k, { price: v.price, symbol: v.symbol ?? null });
      }
    } catch {
      /* ignore — unpriced coins just stay unpriced */
    }
  }
  return out;
}
