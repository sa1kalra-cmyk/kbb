// Pure logic for callback.html (no DOM), so it can be unit-tested in Node.
//
// Kite redirects here after login with:
//   ?request_token=…&action=login&status=success   (from Kite)
//   &state=…&bot=…&port=…                           (our redirect_params, see app/src/kite/login.ts)
//
// The page then tries two hand-offs to the bot running on the owner's PC (spec §6.2/6.3):
//   1. local:    fetch http://127.0.0.1:<port>/kite/callback (works only on that PC)
//   2. telegram: t.me/<bot>?start=<request_token> (works anywhere Telegram is installed)
// The request_token is useless without the api_secret, which never leaves the PC.

const TOKEN_RE = /^[A-Za-z0-9]{8,128}$/;
/** Telegram deep-link start parameter: up to 64 of A–Z a–z 0–9 _ - */
const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_RE = /^[A-Za-z0-9_]{5,32}$/;
const STATE_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * @typedef {{ kind: "error", message: string }} ErrorPlan
 * @typedef {{
 *   kind: "handoff",
 *   requestToken: string,
 *   localUrl: string | undefined,
 *   telegramUrl: string | undefined,
 *   botUsername: string | undefined,
 *   manualCommand: string,
 * }} HandoffPlan
 * @typedef {ErrorPlan | HandoffPlan} CallbackPlan
 */

/**
 * Decides what the callback page should do for a given query string.
 * @param {string} search  location.search, e.g. "?request_token=…&status=success"
 * @returns {CallbackPlan}
 */
export function planCallback(search) {
  const params = new URLSearchParams(search);
  const token = params.get("request_token") ?? "";

  if (params.get("status") !== "success" || token === "") {
    return {
      kind: "error",
      message: "Kite didn't complete the login. Send /login to your bot in Telegram to try again.",
    };
  }
  if (!TOKEN_RE.test(token)) {
    return {
      kind: "error",
      message: "Kite sent an unexpected login token. Send /login to your bot to try again.",
    };
  }

  const bot = params.get("bot") ?? "";
  const botUsername = BOT_RE.test(bot) ? bot : undefined;

  const state = params.get("state") ?? "";
  const port = Number(params.get("port"));
  const localUrl =
    STATE_RE.test(state) && Number.isInteger(port) && port >= 1024 && port <= 65535
      ? `http://127.0.0.1:${port}/kite/callback?${new URLSearchParams({ request_token: token, state })}`
      : undefined;

  const telegramUrl =
    botUsername && START_PARAM_RE.test(token)
      ? `https://t.me/${botUsername}?start=${token}`
      : undefined;

  return {
    kind: "handoff",
    requestToken: token,
    localUrl,
    telegramUrl,
    botUsername,
    manualCommand: `/token ${token}`,
  };
}

/**
 * Interprets the local server's JSON answer.
 * @param {unknown} body
 * @returns {{ ok: true, text: string } | { ok: false, text: string }}
 */
export function describeLocalResult(body) {
  if (typeof body !== "object" || body === null) {
    return { ok: false, text: "The bot on this computer gave an unexpected answer." };
  }
  const result =
    /** @type {{ ok?: unknown, userId?: unknown, duplicate?: unknown, error?: unknown }} */ (body);
  if (result.ok === true) {
    if (result.duplicate === true)
      return { ok: true, text: "Already logged in. You can close this tab." };
    const who = typeof result.userId === "string" ? ` as ${result.userId}` : "";
    return { ok: true, text: `Logged in${who}. Check Telegram, then close this tab.` };
  }
  const error =
    typeof result.error === "string" ? result.error : "The bot couldn't complete the login.";
  return { ok: false, text: error };
}
