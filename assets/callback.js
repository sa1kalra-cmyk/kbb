// DOM glue for callback.html. The decisions live in callback-core.js.
import { describeLocalResult, planCallback } from "./callback-core.js";

const LOCAL_TIMEOUT_MS = 4000;

/** @param {string} id */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

/**
 * @param {string} text
 * @param {"working" | "ok" | "error" | "info"} tone
 */
function setStatus(text, tone) {
  const status = el("status");
  status.textContent = text;
  status.dataset.tone = tone;
}

/** @param {import("./callback-core.js").HandoffPlan} plan @param {boolean} emphasise */
function showTelegramOptions(plan, emphasise) {
  if (plan.telegramUrl) {
    const link = /** @type {HTMLAnchorElement} */ (el("telegram-link"));
    link.href = plan.telegramUrl;
    link.classList.toggle("primary", emphasise);
    el("telegram").hidden = false;
  }
  // The manual /token route only when the token can't travel in a t.me link (spec §6.3).
  if (!plan.telegramUrl) {
    el("manual-command").textContent = plan.manualCommand;
    el("manual-bot").textContent = plan.botUsername ? `@${plan.botUsername}` : "your bot";
    el("manual").hidden = false;
  }
}

async function copyManualCommand() {
  const button = /** @type {HTMLButtonElement} */ (el("copy"));
  try {
    await navigator.clipboard.writeText(el("manual-command").textContent ?? "");
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed. Select the text instead";
  }
}

async function main() {
  const plan = planCallback(window.location.search);
  // Don't leave the one-time token in the address bar or history.
  window.history.replaceState(null, "", window.location.pathname);

  if (plan.kind === "error") {
    setStatus(plan.message, "error");
    return;
  }
  el("copy").addEventListener("click", copyManualCommand);

  if (!plan.localUrl) {
    setStatus("Hand the login to your bot:", "info");
    showTelegramOptions(plan, true);
    return;
  }

  setStatus("Connecting to the bot on this computer…", "working");
  try {
    const response = await fetch(plan.localUrl, {
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
    });
    const result = describeLocalResult(await response.json());
    setStatus(result.text, result.ok ? "ok" : "error");
    // Keep the Telegram route available but secondary after a local success.
    showTelegramOptions(plan, !result.ok);
    if (result.ok) el("telegram-hint").textContent = "No Telegram message? Hand it over again:";
  } catch {
    // Not on the bot's PC (e.g. a phone), or the browser blocked the local request.
    setStatus("Hand the login to your bot:", "info");
    showTelegramOptions(plan, true);
  }
}

main();
