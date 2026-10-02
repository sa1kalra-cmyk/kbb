// Pure logic for basket.html (no DOM), so it can be unit-tested in Node.
//
// The payload rides in the URL fragment (never sent to GitHub's servers): base64url(JSON), or
// "z." + base64url(deflate-raw(JSON)) when long (spec §7.2; app/src/domain/basket.ts).
// Tapping "Open in Kite" POSTs the orders to Kite Publisher; the owner then reviews and taps
// Execute inside Kite (spec §2.4, §7.3). Nothing is ever submitted automatically.

export const KITE_BASKET_URL = "https://kite.zerodha.com/connect/basket";
export const MAX_ITEMS = 10;
const COMPRESSED_PREFIX = "z.";
const TAG_RE = /^[A-Za-z0-9]{1,20}$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_OFFSET_MS = 330 * 60_000;
const MARKET_CLOSE_MINUTES = 15 * 60 + 30;

/**
 * @typedef {{
 *   variety: string, tradingsymbol: string, exchange: string, transaction_type: string,
 *   order_type: string, product: string, quantity: number, price: number, validity: string,
 *   readonly: boolean, tag: string
 * }} BasketOrder
 * @typedef {{
 *   v: number, api_key: string, date: string, chunk: number, chunks: number,
 *   dry_run: boolean, limit_buffer_pct?: number, orders: BasketOrder[]
 * }} BasketPayload
 */

/**
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {Uint8Array<ArrayBuffer>} bytes */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

/**
 * @param {string} fragment location.hash without the "#"
 * @returns {Promise<unknown>}
 */
export async function decodeFragment(fragment) {
  if (!fragment) {
    throw new Error("This link has no basket in it. Send /link in Telegram for today's link.");
  }
  try {
    const json = fragment.startsWith(COMPRESSED_PREFIX)
      ? await inflateRaw(base64UrlToBytes(fragment.slice(COMPRESSED_PREFIX.length)))
      : new TextDecoder().decode(base64UrlToBytes(fragment));
    return JSON.parse(json);
  } catch {
    throw new Error("This basket link is damaged. Send /link in Telegram for a fresh copy.");
  }
}

/** @param {Date} now */
export function istToday(now) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** @param {Date} now */
export function marketClosed(now) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes() >= MARKET_CLOSE_MINUTES;
}

/** "Tue 29 Sep" @param {string} date */
export function dateLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** @param {unknown} value */
const isPositiveInteger = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/**
 * Spec §7.2 checks. `errors` block the page; a date mismatch is shown as a red warning and
 * disables submitting, but the basket is still displayed.
 * @param {unknown} value
 * @param {string} today IST date
 * @returns {{ errors: string[], dateMismatch: boolean, payload: BasketPayload | undefined }}
 */
export function validatePayload(value, today) {
  if (typeof value !== "object" || value === null) {
    return { errors: ["The basket isn't readable."], dateMismatch: false, payload: undefined };
  }
  const p = /** @type {Record<string, unknown>} */ (value);
  /** @type {string[]} */
  const errors = [];
  if (p.v !== 1) errors.push(`Unsupported basket version (${String(p.v)}).`);
  if (typeof p.api_key !== "string" || p.api_key === "")
    errors.push("The basket has no Kite API key.");
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date))
    errors.push("The basket has no date.");
  if (
    !isPositiveInteger(p.chunk) ||
    !isPositiveInteger(p.chunks) ||
    Number(p.chunk) > Number(p.chunks)
  ) {
    errors.push("The basket number is invalid.");
  }
  if (!Array.isArray(p.orders) || p.orders.length < 1 || p.orders.length > MAX_ITEMS) {
    errors.push(`A basket must have 1 to ${MAX_ITEMS} orders.`);
  } else {
    p.orders.forEach((raw, i) => {
      const o = /** @type {Record<string, unknown>} */ (raw ?? {});
      const name = `Order ${i + 1} (${typeof o.tradingsymbol === "string" ? o.tradingsymbol : "?"})`;
      if (
        o.transaction_type !== "BUY" ||
        o.product !== "CNC" ||
        o.order_type !== "LIMIT" ||
        o.variety !== "regular" ||
        o.validity !== "DAY"
      ) {
        errors.push(`${name} must be a regular BUY CNC LIMIT DAY order.`);
      }
      if (typeof o.tradingsymbol !== "string" || o.tradingsymbol === "")
        errors.push(`${name} has no symbol.`);
      if (o.exchange !== "NSE" && o.exchange !== "BSE")
        errors.push(`${name} must be on NSE or BSE.`);
      if (!isPositiveInteger(o.quantity)) errors.push(`${name} needs a whole, positive quantity.`);
      if (typeof o.price !== "number" || !(o.price > 0) || !Number.isFinite(o.price)) {
        errors.push(`${name} needs a positive limit price.`);
      }
      if (typeof o.tag !== "string" || !TAG_RE.test(o.tag))
        errors.push(`${name} has an invalid tag.`);
    });
  }
  const payload = errors.length === 0 ? /** @type {BasketPayload} */ (value) : undefined;
  return { errors, dateMismatch: payload !== undefined && payload.date !== today, payload };
}

/** @param {BasketPayload} payload */
export function basketTable(payload) {
  const rows = payload.orders.map((o) => {
    const pricePaise = Math.round(o.price * 100);
    return {
      symbol: o.tradingsymbol,
      exchange: o.exchange,
      quantity: o.quantity,
      pricePaise,
      valuePaise: o.quantity * pricePaise,
    };
  });
  return { rows, totalPaise: rows.reduce((sum, r) => sum + r.valuePaise, 0) };
}

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/** @param {number} paise */
export function formatInr(paise) {
  return INR.format(paise / 100);
}

/** Spec §7.3 step 5. @param {BasketPayload} payload */
export function limitNote(payload) {
  const pct =
    typeof payload.limit_buffer_pct === "number"
      ? `${Number(payload.limit_buffer_pct.toFixed(2))}%`
      : "a little";
  return `Prices are limits ≈${pct} above LTP at 15:10. Orders may stay unfilled if the price moves more.`;
}

/** The two form fields Kite Publisher expects (spec §2.4). @param {BasketPayload} payload */
export function kiteFormFields(payload) {
  return { api_key: payload.api_key, data: JSON.stringify(payload.orders) };
}
