// Reproducible UI screenshots for the README, driven headlessly through the
// system Chrome. Run with both dev servers up (./scripts/dev.sh), then:
//   cd web && bun screenshot.mjs
// Writes PNGs to ../docs/screenshots/. Re-run after UI changes to refresh them.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5173/";
const SOLANA = "HFFyTn7YjPWg2ctT1pgmnB585vWXPUmt4bnTrmCr2uKz"; // live Solana
const ETH = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";     // live EVM (vitalik.eth)
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });

async function trace(wallet) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill('input[placeholder^="Paste any wallet"]', wallet);
  await page.click('button:has-text("Trace")');
  await page.waitForSelector("text=total out", { timeout: 45000 });
  await page.waitForTimeout(1500);
}

await trace(SOLANA);
await page.screenshot({ path: join(OUT, "tracellet-flow.png"), fullPage: true });
console.log("· wrote tracellet-flow.png");

await page.click('button:has-text("In & Out")');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "tracellet-in-out.png"), fullPage: true });
console.log("· wrote tracellet-in-out.png");

await trace(ETH);
await page.screenshot({ path: join(OUT, "tracellet-evm.png"), fullPage: true });
console.log("· wrote tracellet-evm.png");

await browser.close();
