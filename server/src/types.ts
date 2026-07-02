// Shared domain types. Deliberately narrow — these are the only shapes the
// signal engine and the LLM ever see. Raw RPC data is normalized into these
// before anything else touches it.

export interface Trade {
  wallet: string;
  side: "buy" | "sell";
  // seconds since the token's first trade (launch). 0 = launch block.
  tSinceLaunch: number;
  solAmount: number;
}

export interface WalletActivity {
  wallet: string;
  // which wallet funded this one (SOL transfer in before first trade), if known
  fundedBy: string | null;
  trades: Trade[];
}

export interface TokenActivity {
  mint: string;
  launchUnix: number;
  wallets: WalletActivity[];
}

// ---- Computed signals (this is what the LLM receives) ----

export interface WalletSignals {
  wallet: string;
  firstBuyTSinceLaunch: number; // seconds
  isSniper: boolean;            // bought within SNIPE_WINDOW
  holdSeconds: number | null;   // null = still holding
  soldWithinTwoMin: boolean;
  realizedPnlSol: number;
  fundedTogetherGroup: number | null; // group id if funded from a shared source
  flags: string[];
}

export interface TokenReport {
  mint: string;
  walletCount: number;
  sniperCount: number;
  bundledGroupCount: number;
  wallets: WalletSignals[];
  // filled in by the LLM narration step
  summary?: string;
  riskVerdict?: "low" | "medium" | "high";
}

// ---- Wallet fund-flow tracer (multi-chain) ----
// "Where did this wallet send its money?" A separate pipeline that mirrors the
// token one: raw data -> pure engine -> LLM narration. Same swap-point pattern.
//
// Chain is detected deterministically from the address format (see chains.ts) —
// NOT by the LLM. Everything downstream is chain-agnostic and works in the
// chain's native asset (ETH/SOL/BTC/TRX). Amounts are always native units.

export type ChainFamily = "evm" | "solana" | "bitcoin" | "tron";

export interface ChainInfo {
  id: string;            // "ethereum" | "solana" | "bitcoin" | "tron" | ...
  name: string;          // "Ethereum"
  family: ChainFamily;
  nativeAsset: string;   // "ETH" | "SOL" | "BTC" | "TRX"
  explorerAddr: string;  // URL prefix for an address, e.g. "https://solscan.io/account/"
  explorerTx: string;    // URL prefix for a tx, e.g. "https://solscan.io/tx/"
}

export interface Transfer {
  to: string;            // recipient address
  amount: number;        // value moved, in the chain's native asset
  asset: string;         // native asset or an on-chain token symbol
  unixTime: number;
  signature: string | null; // tx signature/hash, for a per-tx explorer link
  // human label for the recipient if it's a known entity (exchange, bridge…)
  toLabel: string | null;
  // true if the recipient is a known CEX deposit address
  isExchange: boolean;
}

export interface WalletOutflows {
  wallet: string;
  chain: ChainInfo;
  firstSeenUnix: number;
  lastSeenUnix: number;
  transfers: Transfer[]; // OUTBOUND only — money leaving this wallet
}

// ---- Computed flow signals (this is what the LLM receives) ----

// An individual transfer to one recipient — powers the per-recipient drill-down.
export interface RecipientTx {
  amount: number;
  unixTime: number;
  signature: string | null;
}

export interface RecipientFlow {
  recipient: string;
  label: string | null;
  isExchange: boolean;
  totalAmount: number;   // sum of everything sent to this recipient (native units)
  txCount: number;
  pctOfTotal: number;    // share of the wallet's total outflow, 0-100
  firstUnix: number;
  lastUnix: number;
  flags: string[];
  txs: RecipientTx[];    // the individual transfers, largest first
}

// ---- Current wallet holdings (balance + tokens) ----

export interface TokenHolding {
  mint: string;
  symbol: string | null;
  amount: number;        // UI amount (decimals applied)
  usd: number | null;    // value in USD if known
}

export interface WalletHoldings {
  nativeBalance: number; // current native-asset balance (SOL/ETH/…)
  nativeAsset: string;
  nativeUsd: number | null;
  tokenCount: number;
  nftCount: number;
  tokens: TokenHolding[]; // fungible tokens, ranked by USD then amount
}

export interface FlowReport {
  wallet: string;
  chain: ChainInfo;
  totalOut: number;      // total outflow in native units
  transferCount: number;
  recipientCount: number;
  topRecipientPct: number; // concentration: share going to the single biggest sink
  exchangeOut: number;   // total that landed on known exchanges (cashed out)
  recipients: RecipientFlow[]; // ranked by totalAmount, desc
  holdings?: WalletHoldings;   // current balance + tokens (filled in by the route)
  // filled in by the LLM narration step
  summary?: string;
  concentration?: "low" | "medium" | "high";
}
