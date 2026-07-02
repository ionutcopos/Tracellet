import type { ChainInfo, WalletOutflows } from "../types.ts";

// STUB — implement when you go live with real data.
//
// The whole job of this file is: raw provider JSON -> WalletOutflows. Nothing
// else in the app should ever see a raw provider response. Because chain is
// already detected upstream, this just dispatches on chain.family and normalizes
// each provider's outbound-transfer data into the Transfer shape in types.ts.
//
// Provider per family (all have free tiers, no card):
//   evm     -> Etherscan-family API (`account&action=txlist` + `tokentx`), or a
//              multichain provider like Alchemy / Covalent. One base URL per chain
//              (Etherscan, Basescan, Arbiscan, Polygonscan, BscScan…).
//   solana  -> Helius Enhanced Transactions API (getSignaturesForAddress on the
//              wallet, then parse the SOL/SPL transfers where source == wallet).
//   bitcoin -> A UTXO indexer (mempool.space / Blockstream). NOTE: "recipient" is
//              fuzzy under UTXO — filter out change outputs back to the sender.
//   tron    -> TronGrid API (/v1/accounts/{addr}/transactions).
//
// Steps, per family:
//  1. Fetch outbound transfers for `wallet` (source == wallet), native + tokens.
//  2. Normalize amounts to native units (wei->ETH, lamports->SOL, sats->BTC…).
//  3. Label known recipients (exchange deposit addrs, routers, bridges) from a
//     static labels map; set isExchange accordingly.
//  4. Return { wallet, chain, firstSeenUnix, lastSeenUnix, transfers }.

export async function liveWalletOutflows(
  _wallet: string,
  _chain: ChainInfo,
): Promise<WalletOutflows> {
  throw new Error("liveWalletOutflows not implemented — see comments in live.ts");
}
