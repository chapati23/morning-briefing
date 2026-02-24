/**
 * OpenSea Voyages Data Source
 *
 * Checks for available voyages on OpenSea's rewards page.
 * Uses Puppeteer with email-based login via AgentMail.
 *
 * Flow:
 * 1. Create/reuse an AgentMail inbox
 * 2. Navigate to OpenSea, enter email to log in
 * 3. Receive OTP via AgentMail API
 * 4. Enter OTP, complete sign-up/login, read voyages
 *
 * Only included in the briefing when voyages are available.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentMailClient } from "agentmail";
import puppeteer, { type Page } from "puppeteer";
import type { BriefingSection, DataSource } from "../types";
import { withCache } from "../utils";

const OPENSEA_REWARDS_URL = "https://opensea.io/rewards";
const OTP_POLL_INTERVAL_MS = 3_000;
const OTP_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const log = (msg: string) => {
  console.log(`[opensea-voyages] ${msg}`);
};

// ============================================================================
// AgentMail Email Management
// ============================================================================

const ENV_KEY_INBOX = "AGENTMAIL_EMAIL_ADDRESS";

const getOrCreateInbox = async (client: AgentMailClient): Promise<string> => {
  // Reuse saved inbox address
  const saved = process.env[ENV_KEY_INBOX]?.trim();
  if (saved && saved.includes("@")) {
    log(`Using saved inbox: ${saved}`);
    return saved;
  }

  // Create a new inbox
  log("Creating AgentMail inbox...");
  const inbox = await client.inboxes.create({
    displayName: "Morning Briefing - OpenSea",
  });
  const address = inbox.inboxId;
  log(`Created inbox: ${address}`);

  // Persist for reuse
  persistEnvVar(ENV_KEY_INBOX, address);
  return address;
};

/**
 * Extract a 6-digit (or 4-digit fallback) OTP code from email body text.
 */
export const extractOtpCode = (body: string): string | undefined => {
  const match6 = body.match(/\b(\d{6})\b/);
  if (match6?.[1]) return match6[1];

  const match4 = body.match(/\b(\d{4})\b/);
  if (match4?.[1]) return match4[1];

  return undefined;
};

/**
 * Wait for an OTP email and extract the code.
 * Only processes messages that arrive after `sinceDate`.
 */
const waitForOtp = async (
  client: AgentMailClient,
  inboxAddress: string,
  sinceDate: Date,
  timeoutMs: number = 60_000,
): Promise<string> => {
  const startTime = Date.now();
  log("Waiting for OTP email...");

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, OTP_POLL_INTERVAL_MS));

    const messages = await client.inboxes.messages.list(inboxAddress);

    // Find new OTP message (arrived after sinceDate)
    const otpMessage = messages.messages.find((m) => {
      const msgDate = new Date(m.createdAt);
      if (msgDate < sinceDate) return false;
      const subject = (m.subject ?? "").toLowerCase();
      return (
        subject.includes("code") ||
        subject.includes("verify") ||
        subject.includes("opensea") ||
        subject.includes("login") ||
        subject.includes("otp")
      );
    });

    if (otpMessage) {
      log(`Found OTP email: "${otpMessage.subject}"`);

      // Get full message body
      const fullMsg = await client.inboxes.messages.get(
        inboxAddress,
        otpMessage.messageId,
      );
      const body = fullMsg.text ?? fullMsg.html ?? "";
      const code = extractOtpCode(body);
      if (code) {
        log(`OTP code: ${code}`);
        return code;
      }

      log(`Could not extract OTP from: ${body.slice(0, 200)}`);
    }

    log(
      `No OTP email yet (${Math.round((Date.now() - startTime) / 1000)}s)...`,
    );
  }

  throw new Error("Timed out waiting for OTP email");
};

// ============================================================================
// Env Persistence
// ============================================================================

const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const persistEnvVar = (key: string, value: string): void => {
  process.env[key] = value;
  const envPath = join(process.cwd(), ".env.local");
  try {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8");
      const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
      if (pattern.test(content)) {
        writeFileSync(envPath, content.replace(pattern, `${key}=${value}`));
      } else {
        writeFileSync(envPath, `${content.trimEnd()}\n${key}=${value}\n`);
      }
    }
  } catch {
    // ignore persistence failures
  }
};

// ============================================================================
// Browser Helpers
// ============================================================================

const clickByText = async (page: Page, text: string): Promise<boolean> => {
  // JSON.stringify safely escapes the text for injection into the evaluate string,
  // preventing issues with quotes or special characters in button labels.
  const result = await page.evaluate(`
    (() => {
      for (const el of document.querySelectorAll("button, div, a, span")) {
        if (el.textContent?.trim() === ${JSON.stringify(text)}) {
          el.click();
          return true;
        }
      }
      return false;
    })()
  `);
  return Boolean(result);
};

const getBodyText = async (page: Page): Promise<string> => {
  const result = await page.evaluate(
    `(() => document.body?.innerText ?? "")()`,
  );
  return typeof result === "string" ? result : "";
};

const EMAIL_SELECTOR = 'input[name="email"]';
const EMAIL_SELECTOR_TIMEOUT_MS = 45_000;
const EMAIL_SELECTOR_MAX_ATTEMPTS = 2;

const MAX_NAV_RETRIES = 2;

const navigateWithRetry = async (page: Page, url: string): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_NAV_RETRIES; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_NAV_RETRIES && msg.includes("timeout")) {
        log(`Navigation attempt ${attempt} timed out, retrying...`);
        continue;
      }
      throw error;
    }
  }
};

/**
 * Wait for the email input to appear, retrying with a page reload if the SPA
 * hydration is too slow (common on resource-constrained Cloud Run containers).
 */
const waitForEmailInput = async (
  page: Page,
): Promise<Awaited<ReturnType<Page["waitForSelector"]>> | null> => {
  for (let attempt = 1; attempt <= EMAIL_SELECTOR_MAX_ATTEMPTS; attempt++) {
    log(
      `Waiting for email input (attempt ${attempt}/${EMAIL_SELECTOR_MAX_ATTEMPTS})...`,
    );
    try {
      const el = await page.waitForSelector(EMAIL_SELECTOR, {
        timeout: EMAIL_SELECTOR_TIMEOUT_MS,
      });
      if (el) return el;
    } catch {
      if (attempt < EMAIL_SELECTOR_MAX_ATTEMPTS) {
        log("Email input not found, reloading page...");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      } else {
        log("Email input not found after all attempts");
        throw new Error(
          `Email input selector "${EMAIL_SELECTOR}" not found after ${EMAIL_SELECTOR_MAX_ATTEMPTS} attempts`,
        );
      }
    }
  }
  return null;
};

// ============================================================================
// Voyage Parsing
// ============================================================================

interface Voyage {
  readonly name: string;
  readonly description?: string;
}

/**
 * Parse voyage data from the rewards page text content.
 *
 * Each voyage card renders as a sequence of text lines:
 *   +250                                       (XP reward)
 *   EPIC                                       (rarity)
 *   TOKEN SWAP                                 (action type)
 *   ENDING IN 2M                               (time remaining - our anchor)
 *   Purchase any token on any chain ($50 ...)   (title)
 *   Purchase any token ... to level up ...      (description)
 *   View Tokens                                (CTA - ignore)
 *
 * We use "ENDING IN" as the anchor, grab the title from the next line,
 * and collect rarity/XP/action from preceding lines.
 */
export const parseVoyages = (pageText: string): readonly Voyage[] => {
  const lines = pageText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const rarities = new Set(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]);

  const voyages: Voyage[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (!line.toUpperCase().startsWith("ENDING IN")) continue;

    const timeRemaining = line;

    // Title is the next line after "ENDING IN ..."
    const title = lines[i + 1] ?? "";
    if (!title || title.length < 5) continue;

    // Look backwards for rarity, action type, and XP
    let rarity = "";
    let actionType = "";
    let xp = "";

    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const prev = lines[j] ?? "";
      const prevUpper = prev.toUpperCase();
      if (rarities.has(prevUpper)) {
        rarity = prev;
      } else if (/^\+\d+$/.test(prev)) {
        xp = prev;
      } else if (prevUpper.length < 30 && prevUpper.length > 2) {
        actionType = prev;
      }
    }

    // Build detail: "EPIC · TOKEN SWAP · +250 XP · Ending in 2M"
    const detail = [rarity, actionType, xp ? `${xp} XP` : "", timeRemaining]
      .filter(Boolean)
      .join(" · ");

    voyages.push({
      name: title,
      description: detail || undefined,
    });
  }

  return voyages;
};

// ============================================================================
// Data Fetching
// ============================================================================

const fetchVoyages = async (): Promise<readonly Voyage[]> => {
  const rawKey = process.env["AGENTMAIL_API_KEY"];
  const apiKey = rawKey?.trim();
  const hasApiKey = Boolean(apiKey);
  const apiKeyLength = apiKey?.length ?? 0;
  const emailAddr = process.env["AGENTMAIL_EMAIL_ADDRESS"]?.trim();
  const hasEmailAddress = Boolean(emailAddr);
  const emailAddressLength = emailAddr?.length ?? 0;
  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/d6ee0ffd-8589-4f61-9fea-0e32c75a8eff", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "07314d",
    },
    body: JSON.stringify({
      sessionId: "07314d",
      location: "opensea-voyages.ts:fetchVoyages",
      message: "env check",
      data: { hasApiKey, apiKeyLength, hasEmailAddress, emailAddressLength },
      timestamp: Date.now(),
      hypothesisId: "H1-H2",
    }),
  }).catch(() => {});
  // #endregion
  if (!apiKey) {
    const errMsg = "AGENTMAIL_API_KEY not configured";
    // #region agent log
    fetch("http://127.0.0.1:7243/ingest/d6ee0ffd-8589-4f61-9fea-0e32c75a8eff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "07314d",
      },
      body: JSON.stringify({
        sessionId: "07314d",
        location: "opensea-voyages.ts:fetchVoyages",
        message: "throw: key not configured",
        data: { error: errMsg },
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
    // #endregion
    throw new Error(errMsg);
  }

  const mail = new AgentMailClient({ apiKey });
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

  try {
    // Step 1: Get or create inbox
    const inboxAddress = await getOrCreateInbox(mail);

    // Step 2: Launch browser
    log("Launching browser...");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });

    // Step 3: Navigate to OpenSea rewards
    // Use "domcontentloaded" instead of "networkidle2" — OpenSea's SPA maintains
    // persistent WebSocket/analytics connections that prevent networkidle2 from
    // ever resolving, causing consistent 30s timeouts in production.
    log("Navigating to OpenSea rewards...");
    await navigateWithRetry(page, OPENSEA_REWARDS_URL);

    // Step 4: Wait for the SPA to render the email input.
    // OpenSea's SPA hydrates the login form after initial page load.
    // On resource-constrained environments (Cloud Run) this can take >30s,
    // so we retry with a page reload (cached assets make the second attempt faster).
    const emailInput = await waitForEmailInput(page);
    if (!emailInput) {
      log("Could not find email input after retries");
      return [];
    }

    log(`Entering email: ${inboxAddress}`);
    await emailInput.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await emailInput.type(inboxAddress, { delay: 20 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Step 5: Submit email (click the arrow button)
    log("Submitting email...");
    const timestampBeforeSubmit = new Date();
    const submitResult = await page.evaluate(`
      (() => {
        const emailInput = document.querySelector('input[name="email"]');
        if (!emailInput) return "no input";
        let container = emailInput.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          const buttons = container.querySelectorAll("button");
          for (const btn of buttons) {
            if (btn.querySelector("svg") || btn.textContent?.trim().length === 0) {
              btn.click();
              return "clicked";
            }
          }
          container = container.parentElement;
        }
        return "no button found";
      })()
    `);
    log(`Submit: ${String(submitResult)}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Dismiss cookie consent if visible
    await clickByText(page, "Accept All");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check if OTP screen appeared
    let bodyText = await getBodyText(page);
    if (
      bodyText.includes("invalid") ||
      bodyText.includes("disposable") ||
      bodyText.includes("not allowed")
    ) {
      log("Email was rejected by OpenSea");
      return [];
    }

    if (!bodyText.includes("Enter Code") && !bodyText.includes("code")) {
      log("OTP screen did not appear, email submit may have failed");
      log(`Page text: ${bodyText.slice(0, 200).replace(/\n/g, " | ")}`);
      return [];
    }

    // Step 6: Wait for OTP via AgentMail
    const otpCode = await waitForOtp(
      mail,
      inboxAddress,
      timestampBeforeSubmit,
      OTP_TIMEOUT_MS,
    );

    // Step 7: Enter OTP via keyboard
    log(`Entering OTP: ${otpCode}`);

    // Focus the first OTP digit input
    await page.evaluate(`
      (() => {
        const inputs = document.querySelectorAll('input[maxlength="1"], input[data-testid*="otp"]');
        if (inputs.length > 0) { inputs[0].focus(); return "digit input"; }
        const all = document.querySelectorAll("input");
        for (const input of all) {
          if (input.offsetParent !== null && input.name !== "email" && !input.placeholder?.includes("Search")) {
            input.focus();
            return input.placeholder || input.type;
          }
        }
        return "none";
      })()
    `);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.keyboard.type(otpCode, { delay: 100 });
    log("OTP entered");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Step 8: Handle sign-up flow (ToS checkbox + Continue)
    bodyText = await getBodyText(page);
    if (bodyText.includes("Sign Up") || bodyText.includes("I agree")) {
      log("Sign-up screen, accepting ToS via Puppeteer clicks...");

      // Click the checkbox button using Puppeteer's native click
      // (the checkbox is a <button role="checkbox">, not a native input)
      const checkboxBtn = await page.$('button[role="checkbox"]');
      if (checkboxBtn) {
        await checkboxBtn.click();
        log("Clicked checkbox button via Puppeteer");
      } else {
        log("No checkbox button found");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Click Continue via evaluate (avoids TypeScript issues with evaluate callbacks)
      const continueResult = await page.evaluate(`
        (() => {
          for (const btn of document.querySelectorAll("button")) {
            if (btn.textContent?.trim() === "Continue") {
              const disabled = btn.disabled;
              btn.click();
              return "clicked (disabled=" + disabled + ")";
            }
          }
          return "not found";
        })()
      `);
      log(`Continue: ${String(continueResult)}`);

      // Wait for Privy to create embedded wallet and complete sign-up
      // This stays on the same page - Privy handles everything in-place
      log("Waiting for sign-up to complete (Privy wallet creation)...");
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }

    // Step 8b: Wait for voyage content to render (prod can be slower than local)
    const VOYAGE_CONTENT_WAIT_MS = 30_000;
    const VOYAGE_POLL_MS = 2_000;
    const voyageContentReady = await (async (): Promise<boolean> => {
      const deadline = Date.now() + VOYAGE_CONTENT_WAIT_MS;
      while (Date.now() < deadline) {
        const text = await page.evaluate(
          `(() => (document.body?.innerText ?? ""))()`,
        );
        if (
          typeof text === "string" &&
          text.toUpperCase().includes("ENDING IN")
        ) {
          log("Voyage content visible in page");
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, VOYAGE_POLL_MS));
      }
      log("Voyage content wait timed out, reading page anyway");
      return false;
    })();

    // Step 9: Read the rewards page (we stayed on /rewards the entire time)
    bodyText = await getBodyText(page);

    const hasEndingIn = bodyText.toUpperCase().includes("ENDING IN");
    log(
      `Page text length=${bodyText.length} contains 'ENDING IN'=${hasEndingIn} voyageContentReady=${voyageContentReady}`,
    );

    const voyages = parseVoyages(bodyText);
    log(`Found ${voyages.length} voyages`);
    return voyages;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    // #region agent log
    fetch("http://127.0.0.1:7243/ingest/d6ee0ffd-8589-4f61-9fea-0e32c75a8eff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "07314d",
      },
      body: JSON.stringify({
        sessionId: "07314d",
        location: "opensea-voyages.ts:fetchVoyages:catch",
        message: "opensea voyage error",
        data: { errorMessage: message },
        timestamp: Date.now(),
        hypothesisId: "H3-H5",
      }),
    }).catch(() => {});
    // #endregion
    throw error;
  } finally {
    if (browser) {
      log("Closing browser...");
      await browser.close();
    }
  }
};

// ============================================================================
// Data Source Export
// ============================================================================

export const openSeaVoyagesSource: DataSource = {
  name: "OpenSea Voyages",
  priority: 8,
  timeoutMs: 150_000, // Email OTP flow (~60s) + browser/navigation (~60s) + retry buffer

  fetch: async (): Promise<BriefingSection> => {
    const rawKey = process.env["AGENTMAIL_API_KEY"];
    const hasKey = Boolean(rawKey?.trim());
    const keyLen = rawKey?.trim().length ?? 0;
    const hasEmail = Boolean(process.env["AGENTMAIL_EMAIL_ADDRESS"]?.trim());
    // #region agent log
    fetch("http://127.0.0.1:7243/ingest/d6ee0ffd-8589-4f61-9fea-0e32c75a8eff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "07314d",
      },
      body: JSON.stringify({
        sessionId: "07314d",
        location: "opensea-voyages.ts:openSeaVoyagesSource.fetch",
        message: "fetch entry env",
        data: { hasKey, keyLen, hasEmail },
        timestamp: Date.now(),
        hypothesisId: "H1-H4",
      }),
    }).catch(() => {});
    // #endregion
    if (!rawKey?.trim()) {
      throw new Error("AGENTMAIL_API_KEY not configured");
    }

    const voyages = await withCache("opensea-voyages", fetchVoyages, {
      ttlMs: CACHE_TTL_MS,
    });

    if (voyages.length === 0) {
      return { title: "OpenSea Voyages", icon: "⛵", items: [] };
    }

    return {
      title: "OpenSea Voyages",
      icon: "⛵",
      items: voyages.map((v) => ({
        text: v.name,
        detail: v.description,
        url: OPENSEA_REWARDS_URL,
        sentiment: "positive" as const,
      })),
      summary: `${voyages.length} voyage${voyages.length === 1 ? "" : "s"} available`,
    };
  },
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockOpenSeaVoyagesSource: DataSource = {
  name: "OpenSea Voyages",
  priority: 8,

  fetch: async (): Promise<BriefingSection> => ({
    title: "OpenSea Voyages",
    icon: "⛵",
    items: [
      {
        text: "Purchase any token on any chain ($50 USD Minimum)",
        detail: "EPIC · TOKEN SWAP · +250 XP · ENDING IN 2D",
        url: OPENSEA_REWARDS_URL,
        sentiment: "positive",
      },
      {
        text: "Buy NFT from a verified Art collection on any chain ($10 minimum)",
        detail: "UNCOMMON · NFT PURCHASE · +100 XP · ENDING IN 1D",
        url: OPENSEA_REWARDS_URL,
        sentiment: "positive",
      },
    ],
    summary: "2 voyages available",
  }),
};
