import { Hono } from "hono";
import { cors } from "hono/cors";
import { getTokenActivity, getWalletTransfers, getWalletHoldings } from "./data/index.ts";
import { buildReport } from "./signals.ts";
import { buildFlowReport } from "./flow.ts";
import { narrate, narrateFlow } from "./narrate.ts";
import { detectChain, EVM_CHAIN_IDS, CHAINS } from "./chains.ts";

const app = new Hono();
app.use("/*", cors());

app.get("/", (c) => c.text("on-chain analyst api"));

// Detect a wallet's chain from its address format (deterministic, no LLM).
// Returns the detected chain plus, for EVM addresses, the alternative chains the
// UI should offer in its selector (since 0x… is ambiguous across EVM chains).
app.post("/detect", async (c) => {
  const { wallet } = await c.req.json<{ wallet: string }>();
  const chain = wallet ? detectChain(wallet) : null;
  if (!chain) {
    return c.json({ error: "Unrecognized address format. Supported: EVM (0x…), Solana, Bitcoin, Tron." }, 400);
  }
  const options = chain.family === "evm" ? EVM_CHAIN_IDS.map((id) => CHAINS[id]) : [chain];
  return c.json({ chain, options });
});

// Trace where a wallet's money went. `chainId` optionally forces a specific chain
// (used by the EVM selector); otherwise the chain is detected from the address.
app.post("/trace", async (c) => {
  const { wallet, chainId } = await c.req.json<{ wallet: string; chainId?: string }>();
  if (!wallet || wallet.trim().length < 20) {
    return c.json({ error: "Enter a valid wallet address." }, 400);
  }
  try {
    const walletTransfers = await getWalletTransfers(wallet.trim(), chainId);
    const report = buildFlowReport(walletTransfers);
    // Narrate and fetch current holdings in parallel — they're independent.
    const [narrated, holdings] = await Promise.all([
      narrateFlow(report),
      getWalletHoldings(walletTransfers.wallet, walletTransfers.chain).catch((e) => {
        console.error("holdings fetch failed:", e);
        return undefined; // holdings are best-effort; don't fail the whole trace
      }),
    ]);
    return c.json({ ...narrated, holdings });
  } catch (e) {
    if (e instanceof Error && e.message === "UNKNOWN_CHAIN") {
      return c.json({ error: "Unrecognized address format. Supported: EVM (0x…), Solana, Bitcoin, Tron." }, 400);
    }
    console.error("trace failed:", e);
    return c.json({ error: "Trace failed. Please try again." }, 500);
  }
});

app.post("/analyze", async (c) => {
  const { mint } = await c.req.json<{ mint: string }>();
  if (!mint || mint.trim().length < 32) {
    return c.json({ error: "Enter a valid Solana mint address (32-44 chars)." }, 400);
  }

  const activity = await getTokenActivity(mint.trim());
  const report = buildReport(activity);
  const narrated = await narrate(report);
  return c.json(narrated);
});

export default { port: 3000, fetch: app.fetch };
