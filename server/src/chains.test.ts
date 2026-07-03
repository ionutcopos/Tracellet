import { test, expect, describe } from "bun:test";
import { detectChain, CHAINS, EVM_CHAIN_IDS } from "./chains.ts";

describe("detectChain", () => {
  test("EVM: 0x + 40 hex → ethereum (family evm)", () => {
    const c = detectChain("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
    expect(c?.id).toBe("ethereum");
    expect(c?.family).toBe("evm");
  });

  test("EVM detection is case-insensitive (checksummed vs lower)", () => {
    expect(detectChain("0xABCDEF0123456789abcdef0123456789ABCDEF01")?.family).toBe("evm");
  });

  test("Solana: base58 32–44 chars → solana", () => {
    const c = detectChain("HFFyTn7YjPWg2ctT1pgmnB585vWXPUmt4bnTrmCr2uKz");
    expect(c?.id).toBe("solana");
    expect(c?.family).toBe("solana");
  });

  test("Tron: T + 33 base58 → tron, and wins over the broad Solana pattern", () => {
    // This address also matches the base58 Solana length, so ordering matters.
    expect(detectChain("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")?.id).toBe("tron");
  });

  test("Bitcoin bech32 (bc1…) → bitcoin", () => {
    expect(detectChain("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")?.id).toBe("bitcoin");
  });

  test("Bitcoin legacy shorter than Solana's min length → bitcoin", () => {
    // 28 chars: matches btcLegacy but not the 32–44 Solana pattern.
    expect(detectChain("1abcdefghijkmnpqrstuvwxyz234")?.id).toBe("bitcoin");
  });

  test("known ambiguity: a 34-char legacy BTC address falls to Solana (documented)", () => {
    // The genesis address is base58 and 34 chars, so it matches the Solana pattern;
    // detection resolves it to Solana. This is the documented BTC-legacy/Solana overlap.
    expect(detectChain("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")?.id).toBe("solana");
  });

  test("trims surrounding whitespace", () => {
    expect(detectChain("  0x742d35Cc6634C0532925a3b844Bc454e4438f44e  ")?.family).toBe("evm");
  });

  test("garbage / empty / too short → null", () => {
    expect(detectChain("hello")).toBeNull();
    expect(detectChain("")).toBeNull();
    expect(detectChain("0x123")).toBeNull(); // 0x but wrong length
    expect(detectChain("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")).toBeNull();
  });
});

describe("chain registry", () => {
  test("every EVM selector option exists in CHAINS and is family evm", () => {
    for (const id of EVM_CHAIN_IDS) {
      expect(CHAINS[id]).toBeDefined();
      expect(CHAINS[id].family).toBe("evm");
    }
  });

  test("each chain carries explorer URLs and a native asset", () => {
    for (const c of Object.values(CHAINS)) {
      expect(c.explorerAddr).toMatch(/^https:\/\//);
      expect(c.explorerTx).toMatch(/^https:\/\//);
      expect(c.nativeAsset.length).toBeGreaterThan(0);
    }
  });
});
