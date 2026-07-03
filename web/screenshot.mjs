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

// JPEG keeps the repo small (the README hero references the .jpg).
const shot = (name) => ({ path: join(OUT, name), fullPage: true, type: "jpeg", quality: 82 });

await trace(SOLANA);
await page.screenshot(shot("tracellet-flow.jpg"));
console.log("· wrote tracellet-flow.jpg");

await page.click('button:has-text("In & Out")');
await page.waitForTimeout(500);
await page.screenshot(shot("tracellet-in-out.jpg"));
console.log("· wrote tracellet-in-out.jpg");

await trace(ETH);
await page.screenshot(shot("tracellet-evm.jpg"));
console.log("· wrote tracellet-evm.jpg");

await browser.close();
