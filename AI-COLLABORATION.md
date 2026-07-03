# Building Tracellet with AI

Tracellet is a multi-chain wallet fund-flow tracer: paste a wallet and see where its
money went and came from — across Solana and EVM, native coins and tokens, valued in
USD, with a network map and an AI-written summary. I built it with an AI coding
assistant. This is how that actually worked, because *how* I used the AI is the point.

**My rule for the product doubles as how I ran the collaboration: _code decides, AI
narrates._** Anything that has to be correct — chain detection, the aggregation engine,
entity verification — is deterministic code. The model only writes prose over numbers
that are already computed. I held the same line with the assistant: it wrote code fast,
but I owned every decision that had to be right.

## What I owned

- **Direction.** I set the scope and drove it — multi-chain, both directions, token
  flows valued in USD — and every feature priority and "ship it / not yet" call was mine.

- **Judgment on what's honest vs. fake.** When the tool labeled a batch of counterparties
  "pump.fun," I didn't buy it — most were probably just wallets caught in pump.fun
  transactions. I had it *verify* each one against its on-chain account owner:
  program-owned keeps the label, a normal wallet gets a muted "?" instead. The #1
  counterparty turned out to be mislabeled. That's the difference between a demo and a tool.

- **Knowing where *not* to use AI.** Chains are detected by regex, not the model — an
  address's chain is a format fingerprint, and putting an LLM on the one step everything
  else depends on would be slower and occasionally wrong.

- **Correctness over flash.** No fabricated data in the live paths, spam/unpriced tokens
  filtered out, real limitations written down instead of hidden. When accurate exchange
  labels would have needed a paid API, I chose to leave them to the block explorers
  rather than guess.

## What I delegated

Implementation, boilerplate, and first-pass UI — then reviewed and redirected. The
assistant also verified its own work by running the app and screenshotting it, which I
checked against what I'd asked for.

## The takeaway

Using AI well isn't about how much it writes. It's judgment — what to build, what
"correct" means, and where the model is the wrong tool. The assistant was leverage; the
decisions were mine.
