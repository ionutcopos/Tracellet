# DEVLOG

Running log of how Tracellet was built and where AI was used. The point is to show
*judgment* — what got delegated, what got reviewed by hand, and why.

## The thesis: code decides, AI narrates

Anything that must be correct is deterministic code; the LLM only writes prose over
numbers that are already computed. It never sees raw chain data and is told to quote
fields verbatim — an early draft that let the model reason over raw transactions started
inventing figures, and locking it to structured input fixed that. This principle drove
every architectural call below.

## Chain detection is code, not the model

`chains.ts` `detectChain()` classifies the chain from the address format with a regex —
EVM, Solana, Bitcoin, Tron. An address's chain is a fingerprint, so an LLM here would be
slower, cost a call, and occasionally be wrong on the one step everything else depends
on. Honest constraint handled in the UI: every EVM chain shares one address format, so a
`0x…` address defaults to Ethereum with a chain selector.

## The pure engine, reviewed by hand

`flow.ts` (`buildFlowReport`) is the only thing that produces numbers — pure, no I/O, no
LLM. It aggregates a wallet's transfers (both directions, all assets) by counterparty,
valued in USD. Written and read by hand; the mock generator and first-pass React view
were delegated, then the view was restyled by hand (dark, minimal, blue→violet accent,
dataviz-validated).

## Live data (Solana + EVM)

- **Solana (Helius):** real in/out transfers from the Enhanced Transactions API, plus
  holdings via DAS. Insight from a real pump.fun wallet: raw data is noise-heavy (ATA
  rent ~0.00204 SOL, fee dust), so a dust filter (<0.005 SOL) is what makes the ranking
  mean anything.
- **EVM (Etherscan V2):** native + ERC-20 transfers across Ethereum/Base/Arbitrum/
  Polygon/BSC — one key, chain selected by `chainid`.
- **Everything valued in USD** via DeFiLlama's free multi-chain price API, so SOL, USDC,
  ETH and tokens rank in one list; unpriced/spam tokens (<$1) are dropped.

## Entity labels — and verifying them

Two tiers: a small curated address map (a wrong label is worse than none) + protocol
context from the Helius `source` (PUMP_FUN→pump.fun…). The catch: source-derived labels
were being stamped on *any* counterparty in those transactions, including plain wallets.
Fix — verify each against its on-chain account owner: program-owned accounts keep the
label, System-Program-owned wallets get a muted "?" instead (and the LLM never sees the
unverified ones). On a test wallet this correctly demoted the top counterparty — a closed
account that was being mislabeled "PumpSwap".

## A bug caught by watching the app

The AI summary silently fell back to a template. Cause: each counterparty's full transfer
array (hundreds of entries) was going into the LLM prompt, which broke the response →
`JSON.parse("")`. Fix: strip the arrays before narration — the model only needs aggregates.

## TODO

- [ ] Bitcoin (UTXO indexer) + Tron (TronGrid) live adapters.
- [ ] ERC-20 holdings list for EVM; historical (at-tx) pricing.
- [ ] Real exchange labels from a dataset so "to exchanges" is fully populated.
- [ ] Unit tests for `flow.ts` and `chains.ts`.
- [ ] Optional: multi-hop tracing ("follow it through layers").

## Notes to self

- Keep detection deterministic — it's the load-bearing correctness claim. If it ever
  needs the LLM, something is wrong.
- The ranked flow list + network map are the signature views: proportional bars and
  verified labels make "where the money went" legible at a glance. Keep them clean.
