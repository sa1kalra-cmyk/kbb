// DOM glue for basket.html. The decisions live in basket-core.js.
import {
  basketTable,
  dateLabel,
  decodeFragment,
  formatInr,
  istToday,
  KITE_BASKET_URL,
  kiteFormFields,
  limitNote,
  marketClosed,
  validatePayload,
} from "./basket-core.js";

/** @param {string} id */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

/** @param {string} id @param {string} text */
function show(id, text) {
  const node = el(id);
  node.textContent = text;
  node.hidden = false;
}

/** @param {string[]} messages */
function showErrors(messages) {
  const list = el("errors");
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
  list.hidden = false;
}

/** @param {import("./basket-core.js").BasketPayload} payload */
function renderTable(payload) {
  const { rows, totalPaise } = basketTable(payload);
  const body = /** @type {HTMLTableSectionElement} */ (el("rows"));
  for (const row of rows) {
    const tr = body.insertRow();
    const cells = [
      row.symbol,
      String(row.quantity),
      formatInr(row.pricePaise),
      formatInr(row.valuePaise),
    ];
    cells.forEach((text, i) => {
      const td = tr.insertCell();
      td.textContent = text;
      if (i > 0) td.className = "num";
    });
  }
  el("total").textContent = formatInr(totalPaise);
  el("orders").hidden = false;
}

/** Builds the Publisher form and submits it: the owner's explicit tap (spec §7.3 step 4). */
function submitToKite(/** @type {import("./basket-core.js").BasketPayload} */ payload) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = KITE_BASKET_URL;
  for (const [name, value] of Object.entries(kiteFormFields(payload))) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

async function main() {
  const now = new Date();
  let decoded;
  try {
    decoded = await decodeFragment(window.location.hash.slice(1));
  } catch (error) {
    showErrors([/** @type {Error} */ (error).message]);
    return;
  }
  const { errors, dateMismatch, payload } = validatePayload(decoded, istToday(now));
  if (!payload) {
    showErrors(errors);
    return;
  }

  show("meta", `Basket ${payload.chunk} of ${payload.chunks} · ${dateLabel(payload.date)}`);
  if (payload.dry_run) el("dry-run").hidden = false;
  if (dateMismatch) {
    show(
      "date-warning",
      `This link is for ${dateLabel(payload.date)}, not today. Send /link for today's.`,
    );
  } else if (marketClosed(now) && !payload.dry_run) {
    show("market-warning", "The market closes at 15:30. Orders sent now will be rejected.");
  }
  renderTable(payload);
  show("note", limitNote(payload));

  const button = /** @type {HTMLButtonElement} */ (el("submit"));
  button.hidden = false;
  if (payload.dry_run) {
    button.textContent = "Copy basket JSON";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload.orders, null, 2));
        button.textContent = "Copied";
      } catch {
        // No clipboard access (older browser, no permission): show it for manual copying.
        button.textContent = "Copy it from the box below";
        const box = document.createElement("textarea");
        box.readOnly = true;
        box.className = "command";
        box.rows = 8;
        box.value = JSON.stringify(payload.orders, null, 2);
        button.after(box);
        box.select();
      }
    });
    return;
  }
  el("submit-hint").hidden = false;
  if (dateMismatch) {
    button.disabled = true;
    return;
  }
  button.addEventListener("click", () => {
    button.disabled = true; // no double submits
    button.textContent = "Opening Kite…";
    submitToKite(payload);
    setTimeout(() => {
      button.disabled = false;
      button.textContent = "Open in Kite";
    }, 5_000);
  });
}

// A new link that differs only in the #fragment (basket 2, a /link resend) doesn't reload the
// page by itself; without this the old basket would stay on screen and be the one submitted.
window.addEventListener("hashchange", () => window.location.reload());

main();
