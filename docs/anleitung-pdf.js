// Erzeugt die beiden Anleitungen als PDF:   node docs/anleitung-pdf.js
//   docs/anleitung.html     -> Anleitung_Fahrtkosten-App.pdf (zwei Seiten)
//   docs/kurzanleitung.html -> Kurzanleitung_Fahrtkosten-App.pdf (eine Seite, mit QR-Code zur Webseite)
const { chromium } = require("playwright");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [quelle, ziel] of [["anleitung.html", "Anleitung_Fahrtkosten-App.pdf"], ["kurzanleitung.html", "Kurzanleitung_Fahrtkosten-App.pdf"]]) {
    await page.goto("file://" + path.join(__dirname, quelle));
    await page.pdf({ path: path.join(__dirname, "..", ziel), format: "A4", printBackground: true, preferCSSPageSize: true });
  }
  await browser.close();
})();
