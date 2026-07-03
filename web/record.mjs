// Records a short demo of Tracellet (headless system Chrome → webm), for turning into
// a README GIF. Run with both dev servers up:  cd web && bun record.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:5173/";
const WALLET = "HFFyTn7YjPWg2ctT1pgmnB585vWXPUmt4bnTrmCr2uKz";
const VID = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots", "video");
mkdirSync(VID, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1120, height: 720 },
  recordVideo: { dir: VID, size: { width: 1120, height: 720 } },
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(URL, { waitUntil: "networkidle" });
await wait(500);
await page.fill('input[placeholder^="Paste any wallet"]', WALLET);
await wait(400);
await page.click('button:has-text("Trace")');
await page.waitForSelector("text=total out", { timeout: 45000 });
await wait(1600); // stat tiles + AI summary

await page.click('button:has-text("In & Out")'); // scrolls into view, split bars
await wait(1500);
await page.click('button:has-text("In")');
await wait(1200);
await page.click('button:has-text("Out")');
await wait(1200);
await page.click('button:has-text("see all")'); // open the all-transactions panel
await wait(1800);

await page.close();
await ctx.close(); // flushes the video
await browser.close();
console.log("· recorded to docs/screenshots/video/");
