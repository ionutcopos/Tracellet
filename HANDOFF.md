# Handoff — where we left off

_Last updated: 2026-07-03. Repo: https://github.com/ionutcopos/Tracellet_

Tracellet is a **multi-chain wallet fund-flow tracer**: paste a wallet, see where its
money went — outbound transfers aggregated by recipient, ranked, with concentration
and exchange signals, narrated by an LLM.

## Current state — working & pushed

- **Chain detection** (`server/src/chains.ts`) — deterministic, regex-based. EVM
  (0x…, defaults Ethereum + selector), Solana, Bitcoin, Tron.
- **Pipeline** — `getWalletOutflows()` → pure engine `flow.ts buildFlowReport()` →
  `narrateFlow()` (Groq). Routes: `POST /detect`, `POST /trace`.
- **Solana is LIVE via Helius** (`server/src/data/live.ts`):
  - Outbound native-SOL transfers (Enhanced Transactions API, paginated, dust-filtered <0.005 SOL).
  - Holdings: balance + fungible tokens + NFT count (DAS `getAssetsByOwner`).
  - Other chains (EVM/BTC/Tron) still run on **mock** data.
- **Entity labels** (`server/src/labels.ts`) — tiny curated address map + Helius
  `source` protocol labels (PUMP_FUN→pump.fun, JUPITER→Jupiter…).
- **Frontend** (`web/src/App.tsx`) — dark, minimal, blue→violet accent:
  - Stat tiles, AI summary, Current Holdings panel.
  - Ranked "where the money went" with proportional bars, labels, flags.
  - **Explorer links** (per chain) on the wallet, recipients, tokens, and each tx.
  - **Per-recipient drill-down** — click a row to see individual transfers (Tx 1 = N SOL…).
  - Recipient list capped at 30 with a "+N more" note.

## Honest limitations (known, by design)

1. **"To exchanges" reads 0% on real Solana data** — the curated label map is
   intentionally tiny (no guessed CEX addresses; a wrong label is worse than none).
   Real exchange detection needs a labels dataset.
2. **Native SOL only** — SPL token *transfers* aren't counted (valuing them needs prices).
3. **Live data is Solana-only** — EVM/BTC/Tron are still mock.

## Next steps (highest value first)

1. **Real entity labels** from a dataset (Arkham / Solana FM) → makes "to exchanges" real.
2. **Live EVM data** (Etherscan/Alchemy) — first non-Solana live adapter.
3. **SPL-token outflows** with price data.
4. **Unit tests** for `flow.ts` (aggregation, thresholds) and `chains.ts` (ambiguous BTC-legacy vs Solana).
5. Optional: **multi-hop tracing** ("follow it through layers") as a v2.

## Run it

Bun is required (installed at `~/.bun/bin`, not on default PATH):

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd server && bun install && bun run src/index.ts     # http://localhost:3000
cd web    && bun install && bun run dev               # http://localhost:5173
```

Keys live in `server/.env` (gitignored): `GROQ_API_KEY`, `HELIUS_API_KEY`.
**Rotate both before the repo gets attention** — they were pasted in chat during
development, so they exist in that transcript.

## Gotchas learned

- Don't send per-recipient `txs` arrays into the Groq narration prompt — hundreds of
  entries break the response (`JSON.parse("")` on empty content). Strip to aggregates.
- Real wallets are noisy: rent (~0.00204 SOL) and fee dust dominate raw transfers.
  The dust filter is what makes the ranking meaningful.
- A `0x…` address is valid on every EVM chain — detection resolves the *family*, the
  specific chain is a user choice (UI selector).
