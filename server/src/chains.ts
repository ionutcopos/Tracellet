import type { ChainInfo } from "./types.ts";

// Deterministic chain detection from address format. This is CODE, not the LLM:
// an address's chain is a format fingerprint, so it is classified with regexes —
// instantly, for free, and reliably. The LLM never sees this decision; it only
// narrates the flow once the (chain-aware) numbers are computed.
//
// Honest constraint: all EVM chains share ONE address format, so a 0x… address
// is valid identically on Ethereum, Base, Arbitrum, Polygon, BSC, etc. We can
// only detect the *family* (EVM) from the string — the specific chain is a user
// choice (the UI exposes a selector, defaulting to Ethereum).

export const CHAINS: Record<string, ChainInfo> = {
  ethereum: { id: "ethereum", name: "Ethereum", family: "evm", nativeAsset: "ETH" },
  base:     { id: "base",     name: "Base",     family: "evm", nativeAsset: "ETH" },
  arbitrum: { id: "arbitrum", name: "Arbitrum", family: "evm", nativeAsset: "ETH" },
  polygon:  { id: "polygon",  name: "Polygon",  family: "evm", nativeAsset: "POL" },
  bsc:      { id: "bsc",      name: "BNB Chain", family: "evm", nativeAsset: "BNB" },
  solana:   { id: "solana",   name: "Solana",   family: "solana", nativeAsset: "SOL" },
  bitcoin:  { id: "bitcoin",  name: "Bitcoin",  family: "bitcoin", nativeAsset: "BTC" },
  tron:     { id: "tron",     name: "Tron",     family: "tron", nativeAsset: "TRX" },
};

// EVM chains a 0x… address could resolve to — offered in the UI selector.
export const EVM_CHAIN_IDS = ["ethereum", "base", "arbitrum", "polygon", "bsc"];

const RE = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  btcBech32: /^bc1[0-9a-z]{11,71}$/,
  btcLegacy: /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

// Returns the detected chain, or null if the string matches no known format.
// Order matters: the more specific fingerprints (0x, Tron's T-prefix, Bitcoin's
// bech32) are tested before the broad base58 Solana pattern.
export function detectChain(address: string): ChainInfo | null {
  const a = address.trim();
  if (RE.evm.test(a)) return CHAINS.ethereum; // EVM family → default Ethereum
  if (RE.tron.test(a)) return CHAINS.tron;
  if (RE.btcBech32.test(a)) return CHAINS.bitcoin;
  if (RE.btcLegacy.test(a) && !RE.solana.test(a)) return CHAINS.bitcoin;
  if (RE.solana.test(a)) return CHAINS.solana;
  return null;
}
