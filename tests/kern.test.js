// Regeltests für app/kern.js (Leitfaden RLSB, Stand 01.01.2025).  Aufruf: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const K = require("../app/kern.js");
const PDFLib = require("../android/bibliotheken/pdf-lib.min.js");

const HEUTE = "2026-11-04";
const ORTE = {
  orte: [
    { name: "Wohnung", typ: "wohnung", adresse: "Musterstraße 1, 49074 Osnabrück" },
    { name: "Schule", typ: "ausbildungsschule", adresse: "BBS Musterstadt, Schulstraße 1, 49000 Musterstadt" },
    { name: "Seminar", typ: "seminar", adresse: "Studienseminar, Winkelhausenstraße 6, 49090 Osnabrück" },
    { name: "BBS Nord", typ: "sonstiges", adresse: "BBS Nord, Nordring 10, 49090 Osnabrück" },
    { name: "Fern", typ: "sonstiges", adresse: "Hannover" },
  ],
  entfernungen: [
    { a: "Wohnung", b: "Schule", km: 25 }, { a: "Wohnung", b: "Seminar", km: 35 }, { a: "Schule", b: "Seminar", km: 40 },
    { a: "Wohnung", b: "BBS Nord", km: 60 }, { a: "BBS Nord", b: "Seminar", km: 20 }, { a: "Wohnung", b: "Fern", km: 300 },
    { a: "Schule", b: "Fern", km: 280 }, { a: "Schule", b: "BBS Nord", km: 30 },
  ],
};
const PROFIL = { name: "Mustermann, Max", amtsbezeichnung: "StRef", wohnanschrift: "Musterstraße 1, 49074 Osnabrück",
  iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX", beschaeftigungsstelle: "BBS Musterstadt, Schul-Nr. 12345, Musterstadt",
  schule_name_adresse: "BBS Musterstadt, Schulstraße 1, 49000 Musterstadt", abrechnende_dienststelle: "RLSB Osnabrück, Dezernat 1",
  bahncard: "nein", geschaeftskundenrabatt: false, begruendung_kein_geschaeftskundenrabatt: "Keine BahnCard", ermaessigungskarte: "" };

const fahrt = (x) => ({ datum: "2026-10-07", route: ["Wohnung", "Seminar", "Wohnung"], abfahrt: "13:15", veranstVon: "14:00",
  veranstBis: "17:15", ankunft: "18:00", anlass: "a", verkehrsmittel: "pkw", grund: "", begruendung: "", fahrkarte: 0, sonstige: 0, ...x });
const rechne = (x, orte = ORTE) => K.berechne(fahrt(x), orte, HEUTE);

test("Seminar ab Wohnung: 0,25 €/km, hin und zurück", () => {
  const r = rechne({});
  assert.deepEqual(r.fehler, []);
  assert.equal(r.km, 70);
  assert.equal(r.wegstrecke, 17.5);
  assert.equal(r.beginnIn, "Wohnort");
  assert.equal(r.endeIn, "Wohnort");
  assert.equal(r.tagegeld, 0);
  assert.equal(r.summe, 17.5);
});

test("Unterricht, dann Seminar: Wohnung–Schule zählt nicht, G2 mit 0,38 €/km", () => {
  const r = rechne({ route: ["Wohnung", "Schule", "Seminar", "Wohnung"], unterrichtVon: "07:45", unterrichtBis: "12:15",
    abfahrt: "12:30", grund: "G2", begruendung: "Unterricht bis 12:15, Seminar ab 14:00" });
  assert.deepEqual(r.fehler, []);
  assert.equal(r.km, 75);
  assert.equal(r.satz, 0.38);
  assert.equal(r.wegstrecke, 28.5);
  assert.equal(r.beginnIn, "Dienstort");
  assert.equal(r.endeIn, "Wohnort");
});

test("Nur Wohnung ↔ Ausbildungsschule ist nicht erstattungsfähig", () => {
  const r = rechne({ route: ["Wohnung", "Schule", "Wohnung"] });
  assert.match(r.fehler.join(), /Nicht erstattungsfähig/);
});

test("Kleine Wegstreckenentschädigung höchstens 125 € je Reise, mit Grund kein Deckel", () => {
  const r = rechne({ route: ["Wohnung", "Fern", "Wohnung"], abfahrt: "06:00", ankunft: "20:00" });
  assert.equal(r.km, 600);
  assert.equal(r.wegstrecke, 125);
  assert.ok(r.gedeckelt);
  const g = rechne({ route: ["Wohnung", "Fern", "Wohnung"], abfahrt: "06:00", ankunft: "20:00", grund: "G1", begruendung: "Kein ÖPNV" });
  assert.equal(g.wegstrecke, 228);
  assert.ok(!g.gedeckelt);
});

test("Fahrrad 0,10 €/km, ÖPNV nach Fahrkarte, Mitfahrt ohne km", () => {
  assert.equal(rechne({ verkehrsmittel: "fahrrad" }).wegstrecke, 7);
  const o = rechne({ verkehrsmittel: "oepnv", fahrkarte: 12.4 });
  assert.equal(o.wegstrecke, 0);
  assert.equal(o.summe, 12.4);
  const m = rechne({ verkehrsmittel: "mitfahrt", fahrer: "Anna Schmidt" });
  assert.equal(m.summe, 0);
  assert.deepEqual(m.fehler, []);
  assert.match(rechne({ verkehrsmittel: "mitfahrt" }).fehler.join(), /wer gefahren ist/);
});

test("Grund G1–G5 nur mit Begründung und nur für den Pkw", () => {
  assert.match(rechne({ grund: "G2" }).fehler.join(), /ohne Begründung/);
  assert.match(rechne({ grund: "G2", begruendung: "x", verkehrsmittel: "oepnv" }).fehler.join(), /nur für den privaten Pkw/);
});

test("Tagegeld 14 € erst bei mehr als 8 Stunden, Knopf überstimmt die Automatik", () => {
  assert.equal(rechne({ abfahrt: "08:00", ankunft: "16:00" }).tagegeld, 0);   // genau 8 Std.
  assert.equal(rechne({ abfahrt: "08:00", ankunft: "16:01" }).tagegeld, 14);
  assert.equal(rechne({ abfahrt: "08:00", ankunft: "16:01", tagegeldWahl: "nein" }).tagegeld, 0);
  const ja = rechne({ tagegeldWahl: "ja" });
  assert.equal(ja.tagegeld, 14);
  assert.ok(ja.hinweise.some((h) => /mehr als 8 Std/.test(h)));
});

test("Pflichtangaben und Zukunft werden erkannt", () => {
  assert.match(rechne({ abfahrt: "" }).fehler.join(), /Abfahrt fehlt/);
  assert.match(rechne({ veranstVon: "" }).fehler.join(), /Beginn der Veranstaltung fehlt/);
  assert.match(rechne({ anlass: "d" }).fehler.join(), /Beschreibung/);
  assert.match(rechne({ datum: "2026-11-05" }).fehler.join(), /Zukunft/);
  assert.match(rechne({ route: ["Wohnung", "Unbekannt"] }).fehler.join(), /gibt es nicht/);
  const ohneKm = { ...ORTE, entfernungen: ORTE.entfernungen.filter((e) => e.b !== "Seminar") };
  assert.match(rechne({}, ohneKm).fehler.join(), /Entfernung Wohnung – Seminar fehlt/);
});

test("6-Monats-Ausschlussfrist", () => {
  assert.equal(K.fristEnde("2026-05-04"), "2026-11-04");
  assert.equal(K.fristEnde("2026-08-31"), "2027-02-28");   // Monatsende
  assert.deepEqual(rechne({ datum: "2026-05-04" }).fehler, []);
  assert.match(rechne({ datum: "2026-05-03" }).fehler.join(), /Frist abgelaufen/);
  assert.ok(rechne({ datum: "2026-05-20" }).hinweise.some((h) => /Frist endet/.test(h)));
});

test("Fehlende Rückfahrt wird erkannt", () => {
  const r = rechne({ route: ["Wohnung", "Seminar"] });
  assert.ok(r.rueckwegFehlt);
  assert.equal(r.km, 35);
});

test("Nr. 2.1.5 VV-NRKVO: kürzere Strecke ab Ausbildungsschule, nicht in der Einführungswoche", () => {
  const kuerzer = { ...ORTE, streckeAb: "kuerzer" };
  // Wohnung–BBS Nord 60 km, Schule–BBS Nord 30 km
  const r = rechne({ route: ["Wohnung", "BBS Nord", "Wohnung"] }, kuerzer);
  assert.equal(r.km, 60);
  assert.ok(r.abSchule);
  assert.equal(r.beginnIn, "Dienstort");
  assert.equal(rechne({ route: ["Wohnung", "BBS Nord", "Wohnung"], einfuehrung: true }, kuerzer).km, 120);
  // Wohnung–Seminar 35 ist kürzer als Schule–Seminar 40: bleibt ab Wohnung
  assert.equal(rechne({}, kuerzer).km, 70);
});

test("Mehrtägige Reise: Tagegeld 14/28 €, Übernachtung, Mahlzeiten", () => {
  const r = rechne({ datum: "2026-10-05", datumBis: "2026-10-07", abfahrt: "07:30", ankunft: "16:30", veranstVon: "09:00", veranstBis: "15:00",
    kompakt: true, uebernachtung: "pauschal", genehmigung: "Seminarleitung, 01.09.2026" });
  assert.deepEqual(r.fehler, []);
  assert.equal(r.tage, 3);
  assert.equal(r.naechte, 2);
  assert.equal(r.tagegeld, 14 * 2 + 28);
  assert.equal(r.uebernachtungsgeld, 40);
  assert.equal(r.summe, 17.5 + 56 + 40);
  const m = rechne({ datum: "2026-10-05", datumBis: "2026-10-07", uebernachtung: "beleg", uebernachtungKosten: 180, mahlzeiten: { fruehstueck: 2 } });
  assert.equal(m.uebernachtungskosten, 180);
  assert.equal(m.kuerzung, 11.2);
  assert.equal(m.tagegeld, 56 - 11.2);
  assert.match(rechne({ datum: "2026-10-05", datumBis: "2026-10-07", uebernachtung: "beleg", uebernachtungKosten: 250 }).fehler.join(), /Begründung/);
  assert.match(rechne({ datum: "2026-10-05", datumBis: "2026-10-07", uebernachtung: "beleg" }).fehler.join(), /Hotelkosten fehlen/);
});

test("Formularwerte: Antrag mit zwei km-Sätzen, Anlage mit Dienstort", () => {
  const liste = [
    fahrt({}),
    fahrt({ datum: "2026-10-14", route: ["Wohnung", "Schule", "Seminar", "Wohnung"], unterrichtVon: "07:45", unterrichtBis: "12:15",
      abfahrt: "12:30", grund: "G2", begruendung: "Unterricht bis 12:15, Seminar ab 14:00" }),
    fahrt({ datum: "2026-10-21", verkehrsmittel: "oepnv", fahrkarte: 12.4 }),
  ].map((f) => ({ f, r: K.berechne(f, ORTE, HEUTE) }));
  const a = K.werteAntrag(PROFIL, liste, 1);
  assert.equal(a.IBAN1, "D");
  assert.equal(a.IBAN22, "0");
  assert.equal(a.Tage3, "70"); assert.equal(a.EUR3, "0,25"); assert.equal(a.Wegstreckenentschaedigung, "17,50");
  assert.equal(a.Tage4, "75"); assert.equal(a.EUR4, "0,38"); assert.equal(a.Wegstreckenentschaedigung1, "28,50");
  assert.equal(a.Fahrkarte, "12,40");
  assert.ok(a.OBJ4 && a.OBJ6 && a.OBJ7);
  assert.match(a.Grund_der_RKR, /07\.10\., 14\.10\., 21\.10\.2026/);
  const w = K.werteAnlage(PROFIL, liste);
  assert.equal(w.Name_Antragsteller, "Mustermann, Max (StRef)");
  assert.equal(w.Beginn_der_Fahrt_Wohnort1, "Dienstort");
  assert.equal(w.von_Uhrzeit1, "07:45");
  assert.equal(w.bis_Uhrzeit2, "12:15");
  assert.equal(w.Strecke2, "");           // ÖPNV: keine km
  assert.equal(w.Summe_Strecke, "145");
});

test("Ohne IBAN bleiben IBAN- und BIC-Felder im Antrag leer", () => {
  const liste = [fahrt({})].map((f) => ({ f, r: K.berechne(f, ORTE, HEUTE) }));
  const w = K.werteAntrag({ ...PROFIL, iban: "", bic: "" }, liste, 1);
  assert.equal(Object.keys(w).filter((k) => /^IBAN\d+$/.test(k)).length, 0);
  assert.ok(!w.Kreditinstitut);
});

test("Pkw, G-Grund und Fahrrad: Fahrrad wandert in die sonstigen Kosten", () => {
  const liste = [fahrt({}), fahrt({ datum: "2026-10-14", grund: "G1", begruendung: "x" }), fahrt({ datum: "2026-10-21", verkehrsmittel: "fahrrad" })]
    .map((f) => ({ f, r: K.berechne(f, ORTE, HEUTE) }));
  const a = K.werteAntrag(PROFIL, liste, 1);
  assert.equal(a.Sonstige_Fahrauslagen1, "7,00");
  assert.match(a.Erlaeuterungen1, /Fahrrad/);
  assert.equal(a.EUR3, "0,25");
  assert.equal(a.EUR4, "0,38");
});

async function pdfErzeugen(anzahl) {
  const basis = path.join(__dirname, "..");
  const fahrten = [];
  for (let i = 0; i < anzahl; i++) {
    const d = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    const f = fahrt({ datum: d });
    fahrten.push({ f, r: K.berechne(f, ORTE, HEUTE) });
  }
  const mehr = fahrt({ datum: "2026-10-26", datumBis: "2026-10-28", uebernachtung: "pauschal", kompakt: true, mahlzeiten: { mittag: 2 } });
  fahrten.push({ f: mehr, r: K.berechne(mehr, ORTE, HEUTE) });
  return K.erzeugePdf(PDFLib, { profil: PROFIL, fahrten,
    antragBytes: fs.readFileSync(path.join(basis, "Reisekosten_Antrag_035_002.pdf")),
    anlageBytes: fs.readFileSync(path.join(basis, "Reisekosten_Anlage.pdf")) });
}

test("PDF: Antrag + Anlage + eigener Antrag für die mehrtägige Reise", async () => {
  const out = await pdfErzeugen(3);
  assert.deepEqual(out.teile.map((t) => t.art), ["antrag", "anlage", "mehrtaegig"]);
  assert.equal(out.seiten, 2 + 1 + 2);
  assert.deepEqual(out.zuLang, []);
  const doc = await PDFLib.PDFDocument.load(out.bytes);
  assert.equal(doc.getPageCount(), 5);
  assert.equal(doc.getForm().getFields().length, 0);   // flach, nichts mehr editierbar
});

test("PDF: mehr als 15 Tagesfahrten ergeben ein zweites Anlage-Blatt", async () => {
  const out = await pdfErzeugen(16);
  const anlage = out.teile.find((t) => t.art === "anlage");
  assert.equal(anlage.seiten, 2);
  assert.match(anlage.titel, /2 Blatt/);
});

test("PDF: lange Schuladressen in Spalte 5b werden lesbar gekürzt statt abgeschnitten", async () => {
  const orte = JSON.parse(JSON.stringify(ORTE));
  orte.orte.find((o) => o.name === "BBS Nord").adresse = "Berufsbildende Schulen Lingen – Technik und Gestaltung, Beckstraße 23, 49809 Lingen";
  const f = fahrt({ route: ["Wohnung", "BBS Nord", "Seminar", "Wohnung"] });
  const out = await K.erzeugePdf(PDFLib, { profil: PROFIL, fahrten: [{ f, r: K.berechne(f, orte, HEUTE) }],
    antragBytes: fs.readFileSync(path.join(__dirname, "..", "Reisekosten_Antrag_035_002.pdf")),
    anlageBytes: fs.readFileSync(path.join(__dirname, "..", "Reisekosten_Anlage.pdf")) });
  assert.deepEqual(out.zuLang, []);
  const w = K.werteAnlage(PROFIL, [{ f, r: K.berechne(f, orte, HEUTE) }]);
  assert.ok(Array.isArray(w.Seminarveranstaltung_in_Ort));
  assert.match(w.Seminarveranstaltung_in_Ort[2], /^BBS Lingen Technik und Gestaltung, 49809 Lingen \/ Studienseminar, 49090 Osnabrück$/);
});
