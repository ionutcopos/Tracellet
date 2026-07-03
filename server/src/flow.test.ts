import { test, expect, describe } from "bun:test";
import { buildFlowReport, concentrationVerdict } from "./flow.ts";
import { CHAINS } from "./chains.ts";
import type { Transfer, WalletTransfers, FlowReport } from "./types.ts";

// Concise builders so each test states only what it cares about.
function tx(p: Partial<Transfer>): Transfer {
  return {
    direction: "out", counterparty: "A", amount: 1, asset: "SOL", assetAddress: null,
    usd: 0, unixTime: 1000, signature: null,
    counterpartyLabel: null, labelType: null, labelConfident: false, isExchange: false,
    ...p,
  };
}
function wt(transfers: Transfer[]): WalletTransfers {
  return { wallet: "W", chain: CHAINS.solana, firstSeenUnix: 0, lastSeenUnix: 0, transfers };
}
const byId = (r: FlowReport, id: string) => r.counterparties.find((c) => c.counterparty === id)!;

describe("buildFlowReport — aggregation", () => {
  const r = buildFlowReport(wt([
    tx({ counterparty: "A", direction: "out", usd: 100 }),
    tx({ counterparty: "A", direction: "out", usd: 50 }),
    tx({ counterparty: "A", direction: "in", usd: 40 }),
    tx({ counterparty: "B", direction: "out", usd: 30 }),
  ]));

  test("sums totals in USD across both directions", () => {
    expect(r.totalOutUsd).toBe(180);
    expect(r.totalInUsd).toBe(40);
    expect(r.netUsd).toBe(-140);
    expect(r.transferCount).toBe(4);
    expect(r.outCount).toBe(3);
    expect(r.inCount).toBe(1);
  });

  test("aggregates per counterparty (out/in/net/total, tx counts)", () => {
    const a = byId(r, "A");
    expect(a.outUsd).toBe(150);
    expect(a.inUsd).toBe(40);
    expect(a.netUsd).toBe(110);
    expect(a.totalUsd).toBe(190);
    expect(a.outTxCount).toBe(2);
    expect(a.inTxCount).toBe(1);
    expect(a.txCount).toBe(3);
  });

  test("pctOfOut is share of total outflow; ranks by outUsd desc", () => {
    expect(r.counterparties[0].counterparty).toBe("A");
    expect(byId(r, "A").pctOfOut).toBe(83.3);
    expect(byId(r, "B").pctOfOut).toBe(16.7);
    expect(r.topRecipientPct).toBe(83.3);
    expect(r.counterpartyCount).toBe(2);
  });
});

describe("buildFlowReport — flags", () => {
  const r = buildFlowReport(wt([
    tx({ counterparty: "CEX", direction: "out", usd: 10, isExchange: true }),
    tx({ counterparty: "BIG", direction: "out", usd: 100 }),
    ...Array.from({ length: 5 }, () => tx({ counterparty: "REP", direction: "out", usd: 2 })),
    tx({ counterparty: "MIX", direction: "out", usd: 5, counterpartyLabel: "Tornado Cash", labelConfident: true }),
  ]));
  // totalOut = 10 + 100 + 10 + 5 = 125

  test("cash-out on exchange outflow only", () => {
    expect(byId(r, "CEX").flags).toContain("cash-out");
    expect(byId(r, "CEX").flags).not.toContain("single-large"); // 10/125 = 8%
    expect(byId(r, "BIG").flags).not.toContain("cash-out");
  });

  test("single-large when one out tx is ≥15% of total outflow", () => {
    expect(byId(r, "BIG").flags).toContain("single-large"); // 100/125 = 80%
    expect(byId(r, "REP").flags).not.toContain("single-large"); // 2/125
  });

  test("repeated at 5+ transfers to the same counterparty", () => {
    expect(byId(r, "REP").flags).toContain("repeated");
    expect(byId(r, "CEX").flags).not.toContain("repeated");
  });

  test("mixer on a known mixer label", () => {
    expect(byId(r, "MIX").flags).toContain("mixer");
  });

  test("exchangeOutUsd sums only exchange outflow", () => {
    expect(r.exchangeOutUsd).toBe(10);
  });
});

describe("buildFlowReport — assets, sorting, labels, nulls", () => {
  test("collects distinct assets and sorts txs by USD desc", () => {
    const r = buildFlowReport(wt([
      tx({ counterparty: "A", asset: "SOL", usd: 10 }),
      tx({ counterparty: "A", asset: "USDC", usd: 50 }),
    ]));
    const a = byId(r, "A");
    expect(a.assets.sort()).toEqual(["SOL", "USDC"]);
    expect(a.txs.map((t) => t.usd)).toEqual([50, 10]);
  });

  test("a single confirmed leg marks the counterparty label confident", () => {
    const r = buildFlowReport(wt([
      tx({ counterparty: "A", counterpartyLabel: "pump.fun", labelConfident: false }),
      tx({ counterparty: "A", counterpartyLabel: "pump.fun", labelConfident: true }),
    ]));
    expect(byId(r, "A").labelConfident).toBe(true);
  });

  test("null-priced transfers contribute 0 USD but are still counted", () => {
    const r = buildFlowReport(wt([
      tx({ counterparty: "A", direction: "out", usd: null }),
      tx({ counterparty: "A", direction: "out", usd: 20 }),
    ]));
    expect(r.totalOutUsd).toBe(20);
    expect(byId(r, "A").txCount).toBe(2);
  });

  test("empty transfer list produces a valid empty report", () => {
    const r = buildFlowReport(wt([]));
    expect(r.totalOutUsd).toBe(0);
    expect(r.counterpartyCount).toBe(0);
    expect(r.topRecipientPct).toBe(0);
    expect(r.counterparties).toEqual([]);
    expect(r.allTransfers).toEqual([]);
  });
});

describe("concentrationVerdict", () => {
  const mk = (topRecipientPct: number, counterpartyCount: number) =>
    concentrationVerdict({ topRecipientPct, counterpartyCount } as FlowReport);

  test("high when the top sink takes ≥60% or there are ≤2 counterparties", () => {
    expect(mk(70, 10)).toBe("high");
    expect(mk(5, 2)).toBe("high");
  });
  test("medium when ≥35% or ≤5 counterparties", () => {
    expect(mk(40, 10)).toBe("medium");
    expect(mk(5, 5)).toBe("medium");
  });
  test("low otherwise", () => {
    expect(mk(10, 20)).toBe("low");
  });
});
