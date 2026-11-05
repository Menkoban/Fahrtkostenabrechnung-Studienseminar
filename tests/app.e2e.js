// Durchklick-Test der fertigen Fahrtkosten-App.html im echten Browser (Chromium, Handy-Format).
//   python app/build.py && node tests/app.e2e.js [Ordner für Bildschirmfotos]
// Prüft ohne Internet: Einrichtung, Fahrten, mehrtägige Reise, Abrechnung mit PDF und Vorschau,
// Abhaken, Sicherung, Neustart, Android-Speicherweg und dass keine Verbindung nach außen aufgebaut wird.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP = "file://" + path.resolve(__dirname, "..", "Fahrtkosten-App.html");
const FOTOS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "fahrtkosten-"));
const PDF_LIB = require("../android/bibliotheken/pdf-lib.min.js");

function isoVor(tage) {
  const d = new Date(); d.setDate(d.getDate() - tage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const IBAN = "DE89370400440532013000", BIC = "COBADEFFXXX";

/** Text einer PDF (ohne Leerraum) über PyMuPDF; null, wenn PyMuPDF fehlt. */
function pdfText(datei) {
  try {
    const aus = require("node:child_process").execFileSync("python3", ["-c",
      "import sys, pymupdf; print(''.join(p.get_text() for p in pymupdf.open(sys.argv[1])))", datei], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return aus.replace(/\s/g, "");
  } catch (e) { return null; }
}

let schritt = 0;
async function foto(page, name) {
  await page.screenshot({ path: path.join(FOTOS, `${String(++schritt).padStart(2, "0")}_${name}.png`), fullPage: true });
}

/** Route bis auf den Startpunkt leeren (eine neue Fahrt übernimmt die Route der letzten). */
async function nurStart(page) {
  while (await page.locator("#route .stop").count() > 1) await page.click('#route [data-weg="1"]');
}

async function ohneQuerscrollen(page, wo) {
  const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(breit <= 1, `${wo}: Seite ist ${breit}px zu breit`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true, locale: "de-DE" });
  const nachAussen = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    nachAussen.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const fehler = [];
  page.on("pageerror", (e) => fehler.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });

  // ---------- Start
  await page.goto(APP);
  await page.getByRole("heading", { name: "Fahrtkosten Planer Studienseminar BBS OS" }).waitFor();
  await foto(page, "start");
  await ohneQuerscrollen(page, "Start");

  // ---------- Einrichten
  await page.click("#willkommen-start");
  await page.fill("#p-name", "Musterfrau, Erika");
  await page.fill("#p-amt", "StRef");
  await page.fill("#p-adr", "Lotter Straße 10, 49078 Osnabrück");
  // IBAN und BIC bewusst NICHT speichern: sie sind freiwillig und kommen erst beim Abrechnen, nur für die PDF
  await page.locator("#p-adr").blur();
  await page.waitForTimeout(800);
  await page.selectOption("#s-schule", { label: "Berufsbildende Schulen Brinkstraße Osnabrück" });
  await page.waitForSelector("#o-name-1");
  await page.click("#s-seminar");
  await page.waitForSelector("#o-name-2");
  const besch = await page.inputValue("#p-besch");
  assert.match(besch, /Brinkstraße/);
  await page.fill("#p-besch", besch.replace("Osnabrück, Osnabrück", "Osnabrück, Schul-Nr. 12345, Osnabrück"));
  await page.locator("#p-besch").blur();
  // Weitere Schule für eine Hospitation
  await page.selectOption("#ort-liste", { label: "Berufsbildende Schulen Lingen – Technik und Gestaltung" });
  await page.waitForSelector("#o-name-3");
  assert.equal(await page.inputValue("#o-adr-3"), "BBS Lingen Technik, Beckstraße 23, 49809 Lingen");
  assert.equal(await page.inputValue("#o-adr-0"), "Lotter Straße 10, 49078 Osnabrück");   // Wohnung aus dem Profil übernommen
  for (const [a, b, km] of [["Wohnung", "Seminar", "6,5"], ["Schule", "Seminar", "4"], ["Wohnung", "BBS Lingen Technik", "71"],
    ["Schule", "BBS Lingen Technik", "72"], ["Seminar", "BBS Lingen Technik", "70"]]) {
    const feld = page.locator(`[data-km-a="${a}"][data-km-b="${b}"]`);
    await feld.fill(km);
    await feld.blur();
    await page.waitForTimeout(100);
  }
  assert.equal(await page.locator("td.km", { hasText: "zählt nicht" }).count(), 1);   // Wohnung–Schule
  await foto(page, "meine-daten");
  await ohneQuerscrollen(page, "Meine Daten");
  const gespeichert = await page.evaluate(() => JSON.parse(localStorage.getItem("fahrtkosten-v1")));
  assert.equal(gespeichert.profil.name, "Musterfrau, Erika");
  assert.equal(gespeichert.orte.orte.length, 4);
  assert.equal(gespeichert.orte.entfernungen.length, 5);

  // ---------- Fahrt 1: Seminar ab Wohnung
  await page.click("#tab-fahrten");
  await page.click("#neu");
  await page.fill("#f-datum", isoVor(20));
  assert.equal(await page.locator("#route .stop").count(), 3);    // Wohnung → Seminar → Wohnung vorbelegt
  await page.fill("#f-ab", "13:20"); await page.fill("#f-an", "17:45");
  await page.fill("#f-vv", "14:00"); await page.fill("#f-vb", "17:15");
  await page.waitForFunction(() => document.querySelector("#ergebnis .summe").textContent.includes("3,25"));
  await foto(page, "fahrt-1");
  await ohneQuerscrollen(page, "Fahrt bearbeiten");
  await page.click("button[type=submit]");
  await page.waitForSelector("#neu");

  // ---------- Fahrt 2: Unterricht, dann Seminar, G2 mit Vorschlag
  await page.click("#neu");
  await page.fill("#f-datum", isoVor(13));
  await nurStart(page);
  await page.click('[data-plus="Schule"]'); await page.click('[data-plus="Seminar"]'); await page.click('[data-plus="Wohnung"]');
  await page.fill("#f-uv", "07:45"); await page.fill("#f-ub", "12:15");
  await page.fill("#f-ab", "12:30"); await page.fill("#f-an", "17:45");
  await page.fill("#f-vv", "14:00"); await page.fill("#f-vb", "17:15");
  await page.selectOption("#f-grund", "G2");
  await page.click("#g2");
  assert.match(await page.inputValue("#f-begr"), /Unterricht bis 12:15, Seminar ab 14:00/);
  await page.waitForFunction(() => document.querySelector("#ergebnis .summe").textContent.includes("3,99"));   // (4 + 6,5) km × 0,38 €
  await page.click("button[type=submit]");
  await page.waitForSelector("#neu");

  // ---------- Fahrt 3: Hospitation, ganzer Tag → Tagegeld automatisch, Parkkosten
  await page.click("#neu");
  await page.fill("#f-datum", isoVor(6));
  await nurStart(page);
  await page.click('[data-plus="BBS Lingen Technik"]');
  await page.click("#rueckweg");   // „Rückfahrt ergänzen“
  assert.equal(await page.locator("#route .stop").count(), 3);
  await page.click('[data-anlass="d"]');
  await page.fill("#f-anlasstext", "Hospitation");
  await page.fill("#f-ab", "07:00"); await page.fill("#f-an", "16:30");
  await page.fill("#f-vv", "08:00"); await page.fill("#f-vb", "15:00");
  await page.fill("#f-so", "3,50");
  await page.waitForFunction(() => document.querySelector("#tg-knopf").getAttribute("aria-pressed") === "true");
  await page.waitForFunction(() => document.querySelector("#ergebnis .summe").textContent.includes("53,00"));   // 142 × 0,25 + 14 + 3,50
  await page.click("button[type=submit]");
  await page.waitForSelector("#neu");

  // ---------- Fahrt 4: Kompaktseminar über drei Tage
  await page.click("#neu");
  await page.check("#f-mehr");
  await page.fill("#f-datum", isoVor(30));
  await page.fill("#f-datumbis", isoVor(28));
  await nurStart(page);
  await page.click('[data-plus="Seminar"]'); await page.click('[data-plus="Wohnung"]');
  await page.fill("#f-ab", "07:30"); await page.fill("#f-an", "17:00");
  await page.fill("#f-vv", "09:00"); await page.fill("#f-vb", "15:30");
  await page.click('[data-uen="beleg"]');
  await page.fill("#f-uenk", "178,00");
  await page.check("#f-kompakt");
  await page.fill("#f-mf", "2");
  await page.fill("#f-gen", "Seminarleitung, 01.09.2026");
  // 13 km × 0,25 = 3,25 + Tagegeld 56 − 11,20 Frühstück + 178 Hotel = 226,05
  await page.waitForFunction(() => document.querySelector("#ergebnis .summe").textContent.includes("226,05"));
  await foto(page, "kompaktseminar");
  await page.click("button[type=submit]");
  await page.waitForSelector("#neu");

  // ---------- Doppelte Fahrt wird erkannt
  await page.click("#neu");
  await page.fill("#f-datum", isoVor(20));
  await page.waitForFunction(() => document.querySelector("#ergebnis").textContent.includes("Doppelt eingetragen?"));
  await page.click("#zurueck");

  await page.waitForSelector(".item");
  assert.equal(await page.locator(".item").count(), 4);
  assert.match(await page.locator(".stub .betrag .num").textContent(), /286,29/);   // 3,25 + 3,99 + 53,00 + 226,05
  await foto(page, "fahrtenliste");
  await ohneQuerscrollen(page, "Fahrtenliste");

  // ---------- Abrechnen
  await page.click("#tab-abrechnen");
  await page.waitForSelector("#pdf:not([disabled])");
  // Ohne IBAN: PDF entsteht trotzdem, mit Hinweis zum Eintragen von Hand
  const [ohne] = await Promise.all([page.waitForEvent("download"), page.click("#pdf")]);
  const ohnePfad = path.join(FOTOS, "ohne-iban.pdf");
  await ohne.saveAs(ohnePfad);
  await page.waitForSelector("text=IBAN und BIC von Hand eintragen");
  const ohneText = pdfText(ohnePfad);
  if (ohneText !== null) assert.ok(!ohneText.includes(IBAN) && !ohneText.includes(BIC), "IBAN darf nicht in der PDF stehen");
  // IBAN nur für diese PDF eintragen
  await page.fill("#a-iban", "DE89 3704 0044 0532 0130 00");
  await page.fill("#a-bic", "cobadeffxxx");
  assert.match(await page.locator("#a-iban-hint").textContent(), /nirgends gespeichert/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#pdf")]);
  const pdfPfad = path.join(FOTOS, download.suggestedFilename());
  await download.saveAs(pdfPfad);
  assert.match(download.suggestedFilename(), /^Reisekosten_\d\d\.\d\d\.\d{4}-\d\d\.\d\d\.\d{4}\.pdf$/);
  const mitText = pdfText(pdfPfad);
  if (mitText !== null) assert.ok(mitText.includes(IBAN) && mitText.includes(BIC), "IBAN und BIC fehlen in der PDF");
  assert.equal(await page.locator("text=IBAN und BIC von Hand eintragen").count(), 0);
  // … und nirgends gespeichert: weder Daten noch Sicherungen oder Entwurf im Gerätespeicher
  const speicher = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join(" "));
  assert.ok(!speicher.replace(/\s/g, "").includes(IBAN) && !speicher.includes(BIC), "IBAN wurde gespeichert");
  const pdf = await PDF_LIB.PDFDocument.load(fs.readFileSync(pdfPfad));
  assert.equal(pdf.getPageCount(), 5);   // Antrag (2) + Anlage (1) + Antrag Kompaktseminar (2)
  await page.waitForSelector("#vorschau canvas");
  await page.waitForFunction(() => document.querySelectorAll("#vorschau canvas").length === 5, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await foto(page, "abrechnen");
  await ohneQuerscrollen(page, "Abrechnen");
  const [einzeln] = await Promise.all([page.waitForEvent("download"), page.click('[data-teil="1"]')]);
  assert.match(einzeln.suggestedFilename(), /^Anlage_035_016_/);

  // ---------- Abhaken
  await page.click("#markieren");
  await page.click("#mark-ja");
  await page.waitForSelector("text=Bereits abgerechnet");
  await page.click("#tab-fahrten");
  assert.equal(await page.locator(".chip.ok", { hasText: "abgerechnet" }).count(), 4);

  // ---------- Sicherung herunterladen, Neustart, Daten noch da
  await page.click("#tab-einstellungen");
  const [sicherung] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
  const sicherungPfad = path.join(FOTOS, sicherung.suggestedFilename());
  await sicherung.saveAs(sicherungPfad);
  const inhalt = JSON.parse(fs.readFileSync(sicherungPfad, "utf8"));
  assert.ok(!JSON.stringify(inhalt).includes(BIC) && !JSON.stringify(inhalt).replace(/\s/g, "").includes(IBAN), "IBAN steht in der Sicherung");
  assert.equal(Object.keys(inhalt.docs).filter((k) => k.startsWith("f-")).length, 4);
  await page.reload();
  await page.waitForSelector(".item");
  assert.equal(await page.locator(".item").count(), 4);

  // ---------- Alles löschen, Sicherung wieder einspielen
  await page.click("#tab-einstellungen");
  await page.click("#alles"); await page.click("#alles-ja");
  await page.waitForSelector("#willkommen-start");
  await page.click("#willkommen-start");
  await page.setInputFiles("#import", sicherungPfad);
  await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("fahrtkosten-v1") || "{}")).length === 6);
  await page.click("#tab-fahrten");
  assert.equal(await page.locator(".item").count(), 4);

  // ---------- Beispieldaten in frischem Browser, Dunkelmodus, Android-Speicherweg
  const android = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", locale: "de-DE" });
  await android.route("**/*", (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : (nachAussen.push(route.request().url()), route.abort())));
  await android.addInitScript(() => {
    window.__gespeichert = [];
    window.AndroidApp = { speichere: (name, b64, mime) => { window.__gespeichert.push({ name, laenge: b64.length, mime }); return "ok"; } };
  });
  const p2 = await android.newPage();
  p2.on("pageerror", (e) => fehler.push("Android: " + e));
  await p2.goto(APP);
  await p2.click("#willkommen-beispiel");
  await p2.waitForSelector(".item");
  await foto(p2, "beispiel-dunkel");
  await p2.click("#tab-abrechnen");
  await p2.click("#pdf");
  await p2.waitForSelector(".banner.good");
  assert.match(await p2.locator(".banner.good").textContent(), /Download\/Fahrtkosten/);
  const android_dateien = await p2.evaluate(() => window.__gespeichert);
  assert.equal(android_dateien.length, 1);
  assert.equal(android_dateien[0].mime, "application/pdf");
  assert.ok(android_dateien[0].laenge > 100000);
  await p2.click("#tab-einstellungen");
  assert.match(await p2.locator("text=Version").last().textContent(), /Version 3\.4 \(Android\)/);
  assert.equal(await p2.locator('a[href="impressum.html"]').count(), 0);   // Impressum nur auf der Webseite

  // ---------- Breiter Bildschirm (PC)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click("#tab-fahrten");
  await foto(page, "pc");

  await browser.close();
  assert.deepEqual(nachAussen, [], "Die App hat versucht, Server zu erreichen");
  assert.deepEqual(fehler, [], "Fehler in der Browserkonsole");
  console.log(`Alles in Ordnung. Bildschirmfotos und PDF: ${FOTOS}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
