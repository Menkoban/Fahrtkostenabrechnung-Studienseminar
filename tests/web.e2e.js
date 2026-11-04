// Test der Webseite (GitHub Pages) im iPhone-Format: Startseite, Downloads, Manifest, Offline-Betrieb, Abrechnung.
//   python app/build.py && node tests/web.e2e.js [Ordner für Bildschirmfotos]
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const WEB = path.resolve(__dirname, "..", "app", "dist", "web");
const FOTOS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "fahrtkosten-web-"));
const TYPEN = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".pdf": "application/pdf", ".apk": "application/vnd.android.package-archive" };

// Kleiner Webserver wie GitHub Pages, unter einem Unterpfad wie /Fahrtkostenabrechnung-Studienseminar/
const PFAD = "/Fahrtkostenabrechnung-Studienseminar/";
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (!url.startsWith(PFAD)) { res.writeHead(404); return res.end(); }
  const datei = path.join(WEB, url.slice(PFAD.length) || "index.html");
  if (!datei.startsWith(WEB) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPEN[path.extname(datei)] || "application/octet-stream" });
  fs.createReadStream(datei).pipe(res);
});

async function main() {
  await new Promise((ok) => server.listen(0, "localhost", ok));
  const basis = `http://localhost:${server.address().port}${PFAD}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "de-DE", acceptDownloads: true });
  const nachAussen = [];
  context.on("request", (r) => { if (!r.url().startsWith(basis) && !/^(data|blob):/.test(r.url())) nachAussen.push(r.url()); });
  const page = await context.newPage();
  const fehler = [];
  page.on("pageerror", (e) => fehler.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });

  // ---------- Startseite
  await page.goto(basis);
  await page.getByRole("heading", { name: "Fahrtkosten Planer Studienseminar BBS OS" }).waitFor();
  assert.equal(await page.locator(".karten .karte").first().getAttribute("id"), "iphone");   // iPhone-Anleitung zuerst
  assert.ok(await page.locator("#iphone").evaluate((el) => el.classList.contains("hervor")));
  assert.match(await page.locator("footer").textContent(), /Version 3\.2/);
  await page.screenshot({ path: path.join(FOTOS, "web_start_iphone.png"), fullPage: true });
  const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(breit <= 1, `Startseite ist ${breit}px zu breit`);

  // Alle Links der Startseite liefern Dateien
  for (const href of await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
    const antwort = await page.request.get(new URL(href, basis).href);
    assert.equal(antwort.status(), 200, href);
  }
  const apk = await page.request.get(basis + "Fahrtkosten.apk");
  assert.equal((await apk.body()).subarray(0, 2).toString(), "PK");

  // Manifest und Symbole
  const manifest = await (await page.request.get(basis + "manifest.webmanifest")).json();
  assert.equal(manifest.short_name, "Fahrtkosten");
  assert.equal(manifest.start_url, "app.html");
  for (const icon of manifest.icons) assert.equal((await page.request.get(basis + icon.src)).status(), 200, icon.src);

  // ---------- App: Service Worker übernimmt, danach läuft sie ohne Netz
  await page.click("text=App öffnen");
  await page.waitForURL(/app\.html$/);
  await page.waitForSelector("#willkommen-beispiel");
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"), "apple-touch-icon.png");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();   // jetzt vom Service Worker kontrolliert
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.click("#willkommen-beispiel");
  await page.waitForSelector(".item");

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector(".item");   // offline geladen, Daten noch da
  await page.click("#tab-abrechnen");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#pdf")]);
  assert.match(download.suggestedFilename(), /^Reisekosten_.*\.pdf$/);
  await page.waitForFunction(() => document.querySelectorAll("#vorschau canvas").length >= 4, null, { timeout: 30000 });
  await page.screenshot({ path: path.join(FOTOS, "web_app_offline.png") });
  // Startseite offline aus dem Speicher
  await page.goto(basis);
  await page.getByRole("heading", { name: "Fahrtkosten Planer Studienseminar BBS OS" }).waitFor();
  await context.setOffline(false);

  // ---------- Android-Format: Android-Karte zuerst
  const android = await browser.newContext({ ...devices["Pixel 7"], locale: "de-DE" });
  const p2 = await android.newPage();
  await p2.goto(basis);
  assert.equal(await p2.locator(".karten .karte").first().getAttribute("id"), "android");
  await p2.screenshot({ path: path.join(FOTOS, "web_start_android.png"), fullPage: true });

  await browser.close();
  server.close();
  assert.deepEqual(nachAussen, [], "Die Webseite hat fremde Server angefragt");
  assert.deepEqual(fehler, [], "Fehler in der Browserkonsole");
  console.log(`Webseite in Ordnung. Bildschirmfotos: ${FOTOS}`);
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
