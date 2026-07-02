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

// Direction of a transfer relative to the traced wallet.
export type Direction = "in" | "out";

// Entity label category (see labels.ts). Drives the UI chip and isExchange.
export type LabelType = "cex" | "dex" | "bridge" | "staking" | "program" | "burn";

export interface Transfer {
  direction: Direction;      // "out" = wallet sent it, "in" = wallet received it
  counterparty: string;      // the OTHER party (recipient if out, sender if in)
  amount: number;            // value moved, in the chain's native asset
  asset: string;             // native asset or an on-chain token symbol
  unixTime: number;
  signature: string | null;  // tx signature/hash, for a per-tx explorer link
  // human label for the counterparty if it's a known entity (exchange, bridge…)
  counterpartyLabel: string | null;
  labelType: LabelType | null;
  isExchange: boolean;       // counterparty is a known CEX
}

export interface WalletTransfers {
  wallet: string;
  chain: ChainInfo;
  firstSeenUnix: number;
  lastSeenUnix: number;
  transfers: Transfer[]; // BOTH directions — money in and out
}

// ---- Computed flow signals (this is what the LLM receives) ----

// An individual transfer with a counterparty — powers the per-counterparty drill-down.
export interface CounterpartyTx {
  direction: Direction;
  amount: number;
  unixTime: number;
  signature: string | null;
}

// One counterparty, aggregated across both directions. The UI's direction toggle
// and ranking control derive the displayed view from these raw amounts.
export interface CounterpartyFlow {
  counterparty: string;
  label: string | null;
  labelType: LabelType | null;
  isExchange: boolean;
  outAmount: number;     // total sent TO this counterparty (native units)
  inAmount: number;      // total received FROM this counterparty
  netAmount: number;     // outAmount - inAmount
  totalAmount: number;   // outAmount + inAmount (gross volume)
  outTxCount: number;
  inTxCount: number;
  txCount: number;
  pctOfOut: number;      // share of the wallet's total OUTFLOW, 0-100 (concentration)
  firstUnix: number;
  lastUnix: number;
  flags: string[];
  txs: CounterpartyTx[]; // the individual transfers, largest first
}

// ---- Current wallet holdings (balance + tokens) ----

export interface TokenHolding {
  mint: string;
  symbol: string | null;
  name: string | null;   // human name if known (e.g. "SuperFriend")
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
  totalIn: number;       // total inflow in native units
  netTotal: number;      // totalIn - totalOut
  transferCount: number; // both directions
  outCount: number;
  inCount: number;
  counterpartyCount: number;
  topRecipientPct: number; // concentration: share of OUTFLOW to the single biggest sink
  exchangeOut: number;   // total that landed on known exchanges (cashed out)
  counterparties: CounterpartyFlow[]; // ranked by outAmount, desc (UI re-ranks)
  allTransfers: Transfer[]; // full list for the "see all transactions" view
  holdings?: WalletHoldings;   // current balance + tokens (filled in by the route)
  // filled in by the LLM narration step
  summary?: string;
  concentration?: "low" | "medium" | "high";
}
