/* ---------------------------------------------------------------------------
   PayPal-only checkout page (checkout-paypal.html) — HOSTED CHECKOUT version
   - No Chargebee.js SDK, no custom payment intent, no PayPal helper.
   - The gold button calls POST /api/checkout/new, which creates a Chargebee
     HOSTED checkout page server-side (checkout_new_for_items), then the
     browser redirects to it (FULL_PAGE).
   - The hosted page collects customer + billing data and handles the PayPal
     payment itself — this is the "normal Chargebee flow".
   - The custom form sections are hidden: the hosted page collects its own
     data. The order overview card and the button stay on our page.
--------------------------------------------------------------------------- */
(function () {
  "use strict";

  var PRICE = null;
  var processing = false;

  var LOADING_TEXT = "Wird geladen…";
  var PAY_TEXT = "Mit PayPal bezahlen";
  var START_TEXT = "Weiter zur Zahlung…";
  var START_ERROR =
    "Checkout konnte nicht gestartet werden. Bitte versuchen Sie es erneut.";
  var CONFIG_ERROR =
    "Checkout-Konfiguration konnte nicht geladen werden. Läuft der Server?";

  function $(sel) {
    return document.querySelector(sel);
  }

  function showError(msg) {
    var banner = $("#error-banner");
    banner.textContent = msg;
    banner.hidden = false;
  }

  function clearError() {
    $("#error-banner").hidden = true;
  }

  // The button contains an SVG icon + a text node. Update only the text node
  // so the PayPal logo stays visible in every state.
  function setButtonText(btn, text) {
    var found = false;
    btn.childNodes.forEach(function (node) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        node.textContent = " " + text;
        found = true;
      }
    });
    if (!found) btn.textContent = text;
  }

  // Hide the custom form sections — the hosted checkout page collects its own
  // customer + billing data. Keep the payment method section and the button.
  function hideFormSections() {
    var sections = document.querySelectorAll(".checkout-section");
    sections.forEach(function (s) {
      var title = s.querySelector(".section-title");
      if (
        title &&
        /Kontoinformationen|Rechnungsadresse/.test(title.textContent)
      ) {
        s.hidden = true;
      }
    });
  }

  function startHostedCheckout() {
    if (processing) return;
    processing = true;
    clearError();

    var btn = $("#paypal-button");
    btn.disabled = true;
    setButtonText(btn, START_TEXT);

    fetch("/api/checkout/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_price_id: PRICE.id }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            var msg =
              (data.details && data.details.message) ||
              data.error ||
              START_ERROR;
            throw new Error(msg);
          }
          return data;
        });
      })
      .then(function (hostedPage) {
        if (!hostedPage || !hostedPage.url) {
          throw new Error(START_ERROR);
        }
        // Full-page redirect to the Chargebee hosted checkout.
        window.location.href = hostedPage.url;
      })
      .catch(function (err) {
        console.error("Hosted checkout start failed:", err);
        processing = false;
        btn.disabled = false;
        setButtonText(btn, PAY_TEXT);
        showError(err.message || START_ERROR);
      });
  }

  function init() {
    var btn = $("#paypal-button");
    btn.disabled = true;
    setButtonText(btn, LOADING_TEXT);

    hideFormSections();

    Promise.all([
      fetch("/api/config").then(function (r) {
        return r.json();
      }),
      fetch("/api/price").then(function (r) {
        return r.json();
      }),
    ])
      .then(function (results) {
        PRICE = results[1];

        // Order overview card — server-driven price
        $("#price-line").textContent = PRICE.formatted;
        $("#total-amount").textContent = PRICE.formatted;

        btn.disabled = false;
        setButtonText(btn, PAY_TEXT);
        btn.addEventListener("click", startHostedCheckout);
      })
      .catch(function (err) {
        console.error("Init failed:", err);
        showError(CONFIG_ERROR);
      });
  }

  init();
})();
