// Zeichnet das App-Symbol (Logo „Fahrschein“) und erzeugt daraus alle Bilddateien.
//   node android/symbol.js
// Ergebnis: android/res/mipmap-*/ic_launcher.png (klassisch, mit Hintergrund),
//           android/res/mipmap-*/ic_launcher_vordergrund.png (adaptives Symbol ab Android 8),
//           app/symbol.png (192 px, für die HTML: Browser-Tab und iPhone-Home-Bildschirm),
//           web/symbol-512.png und web/apple-touch-icon.png (Webseite)
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const ANTHRAZIT = "#373736", ROT = "#e4013a";
// Fahrschein mit Abriss: links roter Abschnitt, gestrichelte Perforation, rechts das €
const TICKET = `<g transform="rotate(-12 256 256)">
  <path d="M86 150 h340 a14 14 0 0 1 14 14 v52 a40 40 0 0 0 0 80 v52 a14 14 0 0 1 -14 14 h-340 a14 14 0 0 1 -14 -14 v-52 a40 40 0 0 0 0 -80 v-52 a14 14 0 0 1 14 -14z" fill="#ffffff"/>
  <path d="M86 150 h106 v212 h-106 a14 14 0 0 1 -14 -14 v-52 a40 40 0 0 0 0 -80 v-52 a14 14 0 0 1 14 -14z" fill="${ROT}"/>
  <line x1="192" y1="166" x2="192" y2="346" stroke="${ANTHRAZIT}" stroke-width="8" stroke-dasharray="14 12"/>
  <text x="316" y="258" font-family="DejaVu Sans" font-weight="700" font-size="170" fill="${ANTHRAZIT}" text-anchor="middle" dominant-baseline="central">€</text>
</g>`;
const svg = (inhalt) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inhalt}</svg>`;
// Klassisches Symbol: abgerundetes Quadrat in Anthrazit
const SYMBOL = svg(`<rect width="512" height="512" rx="112" fill="${ANTHRAZIT}"/>${TICKET}`);
// Adaptiv: 108 dp Fläche, sichtbar sind die inneren 72 dp, sicher die inneren 66 dp → Ticket verkleinert in die Mitte
const VORDERGRUND = svg(`<g transform="translate(256 256) scale(0.62) translate(-256 -256)">${TICKET}</g>`);

const BASIS = path.resolve(__dirname, "..");
const DICHTEN = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

async function png(seite, quelle, groesse, ziel) {
  await seite.setViewportSize({ width: groesse, height: groesse });
  await seite.setContent(`<html><body style="margin:0;background:transparent">${quelle.replace("<svg ", `<svg width="${groesse}" height="${groesse}" `)}</body></html>`);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  await seite.screenshot({ path: ziel, omitBackground: true, clip: { x: 0, y: 0, width: groesse, height: groesse } });
}

(async () => {
  fs.writeFileSync(path.join(__dirname, "symbol.svg"), SYMBOL);
  const browser = await chromium.launch();
  const seite = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [dichte, faktor] of Object.entries(DICHTEN)) {
    await png(seite, SYMBOL, 48 * faktor, path.join(__dirname, "res", `mipmap-${dichte}`, "ic_launcher.png"));
    await png(seite, VORDERGRUND, 108 * faktor, path.join(__dirname, "res", `mipmap-${dichte}`, "ic_launcher_vordergrund.png"));
  }
  await png(seite, SYMBOL, 192, path.join(BASIS, "app", "symbol.png"));
  // Webseite: Symbol für Android/Chrome (512) und iPhone (180, ohne Transparenz, iOS rundet selbst ab)
  await png(seite, SYMBOL, 512, path.join(BASIS, "web", "symbol-512.png"));
  await png(seite, svg(`<rect width="512" height="512" fill="${ANTHRAZIT}"/>${TICKET}`), 180, path.join(BASIS, "web", "apple-touch-icon.png"));
  await browser.close();
  console.log("Symbole erzeugt");
})();
