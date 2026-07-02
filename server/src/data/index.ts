import type { TokenActivity, WalletOutflows } from "../types.ts";
import { mockTokenActivity, mockWalletOutflows } from "./mock.ts";
import { liveWalletOutflows } from "./live.ts";
import { CHAINS, detectChain } from "../chains.ts";
// import { heliusTokenActivity } from "./helius.ts";

// THE swap point. The rest of the app calls these functions and never knows or
// cares where the data came from. To go live: implement the live adapter and
// switch the line. Signal engines, routes, and frontend stay untouched.

export async function getTokenActivity(mint: string): Promise<TokenActivity> {
  return mockTokenActivity(mint);
  // return heliusTokenActivity(mint);
}

// Wallet fund-flow. `chainId` optionally forces a specific chain — needed because
// every EVM chain shares one address format, so a 0x… address is ambiguous and
// the UI lets the user pick (defaulting to Ethereum). If omitted, we detect from
// the address format.
export async function getWalletOutflows(
  wallet: string,
  chainId?: string,
): Promise<WalletOutflows> {
  const chain = chainId ? CHAINS[chainId] : detectChain(wallet);
  if (!chain) {
    throw new Error("UNKNOWN_CHAIN");
  }
  // Solana is wired to live Helius data; other chains still use mock until their
  // adapters land in live.ts. This is the swap point — one line per chain.
  if (chain.family === "solana") {
    return liveWalletOutflows(wallet, chain);
  }
  return mockWalletOutflows(wallet, chain);
}
