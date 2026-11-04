// Erzeugt Anleitung_Fahrtkosten-App.pdf aus docs/anleitung.html.   node docs/anleitung-pdf.js
const { chromium } = require("playwright");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, "anleitung.html"));
  await page.pdf({ path: path.join(__dirname, "..", "Anleitung_Fahrtkosten-App.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  await browser.close();
})();
