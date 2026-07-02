import type { TokenReport, FlowReport } from "./types.ts";
import { heuristicVerdict } from "./signals.ts";
import { concentrationVerdict } from "./flow.ts";

// The narration step. The LLM receives ONLY the structured report (computed
// numbers) and is told to quote fields verbatim and not invent figures. If there's
// no GROQ_API_KEY, we fall back to a template so the app always works.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

function templateSummary(r: TokenReport): { summary: string; riskVerdict: "low" | "medium" | "high" } {
  const verdict = heuristicVerdict(r);
  const summary =
    `${r.walletCount} early wallets analyzed. ${r.sniperCount} sniped within ` +
    `15s of launch across ${r.bundledGroupCount} shared-funding group(s). ` +
    `Heuristic risk: ${verdict}.`;
  return { summary, riskVerdict: verdict };
}

export async function narrate(r: TokenReport): Promise<TokenReport> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    const t = templateSummary(r);
    return { ...r, ...t };
  }

  const baseline = heuristicVerdict(r);
  const system =
    "You are an on-chain analyst. You will receive a JSON report of already-computed " +
    "signals about early buyers of a Solana token. Do NOT invent any numbers — only " +
    "use values present in the JSON. Write a 3-4 sentence plain-language summary of " +
    "what the early-buyer behavior suggests, then give a risk verdict of low, medium, " +
    "or high. A heuristic baseline verdict is provided; agree or override it, but if " +
    "you override, say why. Respond ONLY as JSON: " +
    '{"summary": string, "riskVerdict": "low"|"medium"|"high"}. No markdown, no preamble.';

  const user = JSON.stringify({ baseline, report: r });

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 320,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      ...r,
      summary: parsed.summary,
      riskVerdict: parsed.riskVerdict,
    };
  } catch (err) {
    console.error("Groq narration failed, using template:", err);
    const t = templateSummary(r);
    return { ...r, ...t };
  }
}

// ---- Wallet fund-flow narration (same pattern as above) ----

function flowTemplate(r: FlowReport): { summary: string; concentration: "low" | "medium" | "high" } {
  const c = concentrationVerdict(r);
  const asset = r.chain.nativeAsset;
  const top = r.counterparties[0];
  const topLabel = top?.label ?? (top ? `${top.counterparty.slice(0, 6)}…` : "n/a");
  const cashedPct = r.totalOut > 0 ? Math.round((r.exchangeOut / r.totalOut) * 100) : 0;
  const summary =
    `${r.totalOut} ${asset} left this wallet and ${r.totalIn} ${asset} came in, across ` +
    `${r.transferCount} transfers with ${r.counterpartyCount} counterparties on ${r.chain.name}. ` +
    `The largest outflow sink (${topLabel}) took ${r.topRecipientPct}%; ${cashedPct}% reached ` +
    `known exchanges. Concentration: ${c}.`;
  return { summary, concentration: c };
}

export async function narrateFlow(r: FlowReport): Promise<FlowReport> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    const t = flowTemplate(r);
    return { ...r, ...t };
  }

  const baseline = concentrationVerdict(r);
  const system =
    "You are an on-chain fund-flow analyst. You will receive a JSON report of a " +
    "wallet's already-computed transfers, aggregated by counterparty (with outAmount " +
    "and inAmount per counterparty), on a specific blockchain. Do NOT invent any " +
    "numbers or addresses — only use values present in the JSON, and always state " +
    "amounts in the chain's nativeAsset. Write a 3-4 sentence plain-language account " +
    "of where this wallet's money went and came from (top counterparties, how " +
    "concentrated the outflow is, how much reached exchanges / mixers), then give a " +
    "concentration verdict of low, medium, or high. A heuristic baseline is provided; " +
    "agree or override it, but if you override, say why. Keep the summary tight: at " +
    "most 3 sentences and under 70 words, and never repeat a point. Respond ONLY as " +
    'JSON: {"summary": string, "concentration": "low"|"medium"|"high"}. No markdown.';

  // Trim to the top counterparties AND drop the heavy arrays (`txs`, `allTransfers`)
  // — the narration only needs aggregates. Per-tx arrays can be hundreds of entries,
  // which bloats the prompt and breaks the response (JSON.parse of empty content).
  const { allTransfers, ...head } = r;
  const compact = {
    ...head,
    counterparties: r.counterparties.slice(0, 12).map(({ txs, ...rest }) => rest),
  };
  const user = JSON.stringify({ baseline, report: compact });

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 320,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return { ...r, summary: parsed.summary, concentration: parsed.concentration };
  } catch (err) {
    console.error("Groq flow narration failed, using template:", err);
    const t = flowTemplate(r);
    return { ...r, ...t };
  }
}
