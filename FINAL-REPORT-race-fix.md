# GLOBOMARTS Checkout — Race-Fix Report (v3)

**Date:** 2026-10-02
**Target:** https://globomarts-checkout.onrender.com/checkout-paypal (item `basic-eur-monthly`, 49,99 €, German UI)
**Deliverable:** `public-2-fichiers.zip` → `checkout-paypal.js` + `checkout-paypal.css` (re-upload to GitHub `public/`)

---

## 1. What was wrong (two bugs, both confirmed)

### Bug 1 — original live error (already fixed in v2)
The deployed code called `paypalHandler.handlePayment()` **without ever calling `mountPaymentButton()`**.
The Chargebee SDK wrapper's `handlePayment` delegates to `this.gatewayHandler.handlePayment(...)` — and
`gatewayHandler` is only assigned **during** `mountPaymentButton()`. Result: the exact live error
`Cannot read properties of undefined (reading 'handlePayment')` at deployed line 123:30.

### Bug 2 — race condition introduced by the first fix (v2, live-verified broken)
The v2 fix called `armPayPal()` **synchronously right after starting** `mountPaymentButton()`.
The SDK assigns `gatewayHandler` **asynchronously during mount**, so `handlePayment()` still threw the
same TypeError. Worse, the SDK's cache-miss path runs `initCallbacks({},{})` during mount, which
**wipes any callbacks registered before mount resolves**. Live console evidence:
- Banner wrongly showed GATEWAY_ERROR ("PayPal ist noch nicht verbunden…") while the gold PayPal button
  still rendered (2 iframes).
- No click/success/error callbacks were ever registered → clicking the gold button would open the PayPal
  popup with **no validation gating and no success callback** → a payment could be authorized but **no
  subscription would be created** (authorization alone does not charge).

## 2. The fix (v3, in this ZIP)

Correct SDK contract order (verified from deobfuscated SDK chunks `/tmp/cb_*.js`, esp. cb_68):

```
setPaymentIntent(intent)
  → await mountPaymentButton(selector, {style})   // gatewayHandler assigned DURING mount
  → handlePayment({click, cancel, success, error}) // only AFTER mount resolves
```

Changes in `checkout-paypal.js`:
1. **`armPayPal()` moved into the `.then()` of `mountPaymentButton()`** — callbacks are registered only
   after the SDK's internal `gatewayHandler` exists and after `initCallbacks({},{})` has run.
2. **`handlePayment()` call wrapped in try/catch** — a synchronous SDK throw can no longer break the page.
3. **`clearError()` moved to the start of the click callback** — stale banners are cleared on every click.
4. **`mountPayPalButton()` catches mount errors internally** (`failSetup(GATEWAY_ERROR)`, no rethrow);
   the init chain ends with `return mountPayPalButton();` so a mount failure shows the graceful German
   banner instead of an unhandled rejection.
5. Re-arm logic preserved: real errors and popup cancellations re-arm; validation rejections keep the
   persistent callbacks (no re-arm, no arm-cap consumption).

## 3. Test evidence (local, race-accurate harness)

A test harness with a **race-mimicking Chargebee SDK stub** was used: `mountPaymentButton()` resolves
after 40 ms, assigns `gatewayHandler` during that async phase, wipes callbacks (mimics
`initCallbacks({},{})`), and `handlePayment()` throws the exact TypeError if called before
`gatewayHandler` exists. **If the v2 race were still present, Test 2 would fail** (dead button).

| Test | Action | Result |
|---|---|---|
| 1 | Empty form → click PayPal button | ✅ Banner "Bitte füllen Sie zuerst alle Pflichtfelder aus.", **no popup**, no subscribe, callbacks registered **after** mount |
| 2 | Filled form → click → simulated PayPal authorization | ✅ Popup opened, `/api/subscribe` body correct (`payment_intent_id.id = pi_test_123`, customer + billing address), redirect to `/success` ("Vielen Dank") |
| 3 | Real `/checkout-paypal` page (local, test site without PayPal gateway) | ✅ Graceful German banner "PayPal ist noch nicht verbunden…", custom button hidden, price "49,99 €" |

Final syntax check: `node --check` → OK. Harness deleted after tests.

## 4. Deploy steps (user)

1. Download `public-2-fichiers.zip` (attached).
2. In GitHub repo `zadox826/globomarts-checkout`, replace `public/checkout-paypal.js` and
   `public/checkout-paypal.css` with the two files from the ZIP (keep the same filenames).
3. Commit → Render auto-deploys (a few minutes).
4. Hard-refresh https://globomarts-checkout.onrender.com/checkout-paypal and verify:
   - **No error banner** (the "PayPal ist noch nicht verbunden…" banner must be gone).
   - Gold PayPal button renders.
   - Click with empty form → German validation message, **no popup**.
   - Fill form → click → PayPal popup → after authorization → redirect to `/success`.
   - DevTools console: **no TypeError** (`Cannot read properties of undefined (reading 'handlePayment')`).

> ⚠️ Do **not** test payments on the current live deploy (v2): the gold button exists but callbacks are
> not registered — no validation gating and no subscription creation after authorization. Re-upload first.

## 5. Notes / limitations
- The real mount path can only be proven on the live site after re-upload (local test site
  `globomarts-test` has no PayPal gateway; payment-intent creation returns 400 "No Applicable gateways
  found", which is the graceful-failure path tested in Test 3).
- Live site uses the real `globomarts` Chargebee site with a working PayPal gateway (payment-intent
  creation succeeds, gateway "paypal").
