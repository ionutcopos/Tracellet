#!/usr/bin/env bash
# Quick trace of a wallet against the local API. Usage: ./scripts/trace.sh <wallet> [chainId]
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"

WALLET="${1:-}"
CHAIN="${2:-}"
if [ -z "$WALLET" ]; then
  echo "usage: ./scripts/trace.sh <wallet> [chainId]" >&2
  exit 1
fi

if [ -n "$CHAIN" ]; then
  BODY="{\"wallet\":\"$WALLET\",\"chainId\":\"$CHAIN\"}"
else
  BODY="{\"wallet\":\"$WALLET\"}"
fi

curl -s -X POST localhost:3000/trace -H 'content-type: application/json' -d "$BODY" \
  | bun -e '
const d = await Bun.stdin.json();
if (d.error) { console.log("ERROR:", d.error); process.exit(0); }
const a = d.chain.nativeAsset;
console.log(`${d.chain.name}  ${d.wallet}`);
console.log(`out ${d.totalOut} ${a} (${d.transferCount} tx) · ${d.recipientCount} recipients · top ${d.topRecipientPct}% · ${d.concentration}`);
if (d.holdings) console.log(`holds ${d.holdings.nativeBalance} ${a} · ${d.holdings.tokenCount} tokens · ${d.holdings.nftCount} NFTs`);
console.log("\ntop counterparties:");
for (const [i, r] of d.recipients.slice(0, 8).entries())
  console.log(`  ${i + 1}. ${(r.label ?? r.recipient.slice(0, 10))}  ${r.totalAmount} ${a} (${r.pctOfTotal}%)  ${r.flags.join(",")}`);
console.log("\nsummary:", d.summary);
'
