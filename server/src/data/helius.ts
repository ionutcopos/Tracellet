import type { TokenActivity } from "../types.ts";

// STUB — implement when you go live with real data.
//
// Helius free tier: 1M credits/mo, no card. https://helius.dev
// Set HELIUS_API_KEY in .env.
//
// Rough plan:
//  1. Get token's first transactions / early transfers (Enhanced Transactions API
//     or getSignaturesForAddress on the mint, oldest-first).
//  2. For each early buyer, pull their swap history on this mint.
//  3. Detect fundedBy by looking at the SOL transfer into each wallet right
//     before its first buy.
//  4. Normalize everything into the TokenActivity / Trade shapes in types.ts.
//
// The whole job of this file is: raw Helius JSON -> TokenActivity. Nothing else
// in the app should ever see a raw Helius response.

export async function heliusTokenActivity(_mint: string): Promise<TokenActivity> {
  throw new Error("heliusTokenActivity not implemented — see comments in helius.ts");
}
