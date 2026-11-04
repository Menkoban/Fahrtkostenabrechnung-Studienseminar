/* Rechenkern und PDF-Ausfüllung für die Fahrtkosten-App.
   Gleiche Regeln wie werkzeug/fahrtkosten.py (Leitfaden RLSB, Stand 01.01.2025).
   Läuft im Browser (global "Kern") und in Node (module.exports). */
(function (root) {
  "use strict";

  const SATZ_KLEIN = 0.25;        // € / km, § 5 Abs. 2 NRKVO
  const DECKEL_KLEIN = 125;       // € je Reise bei kleiner Wegstreckenentschädigung
  const SATZ_GROSS = 0.38;        // € / km, § 5 Abs. 3 (G1–G5 mit Begründung)
  const SATZ_FAHRRAD = 0.10;      // € / km, § 5 Abs. 5
  const TAGEGELD = 14;            // € bei Abwesenheit > 8 Stunden; mehrtägig: An- und Abreisetag
  const TAGEGELD_VOLL = 28;       // € je vollem Tag einer mehrtägigen Reise
  const KUERZUNG = { fruehstueck: 0.2, mittag: 0.4, abend: 0.4 };  // Anteil am vollen Tagegeld je gestellter Mahlzeit
  const UEBERNACHTUNG_PAUSCHAL = 20;  // € je Nacht ohne Beleg
  const UEBERNACHTUNG_GRENZE = 100;   // € je Nacht mit Beleg ohne Begründung
  const UEBERNACHTUNG_KOMPAKT = 50;   // € je Nacht, von der Seminarleitung genehmigungsfähig
  const FRIST_MONATE = 6;
  const ZEILEN_JE_ANLAGE = 15;

  const GRUENDE = {
    G1: "Dienstgeschäft mit regelmäßigen Beförderungsmitteln nicht durchführbar",
    G2: "Verknüpfung mehrerer Dienstgeschäfte am selben Tag (eigener Unterricht zählt)",
    G3: "Schweres (ab 25 kg) oder sperriges Dienstgepäck",
    G4: "Kostengünstiger, z. B. Fahrgemeinschaft",
    G5: "Schwerbehinderung mit Merkzeichen aG",
  };

  // Ankreuzfelder im Antrag 035_002 (per Position im Formular zugeordnet)
  const BAHNCARD_FELD = { nein: "OBJ21", business25: "OBJ23", business50: "OBJ24",
    business100: "OBJ25", "25": "OBJ26", "50": "OBJ27", "100": "OBJ28" };
  const IMMER_NEIN = ["OBJ34", "OBJ38", "OBJ40", "OBJ42", "OBJ9", "OBJ52", "OBJ54"];

  // ------------------------------------------------------------ Hilfen

  function isoHeute() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function teile(iso) {
    const [j, m, t] = iso.split("-").map(Number);
    return { j, m, t };
  }

  function deDatum(iso, kurz) {
    const { j, m, t } = teile(iso);
    const jj = kurz ? String(j).slice(2) : j;
    return `${String(t).padStart(2, "0")}.${String(m).padStart(2, "0")}.${jj}`;
  }

  function fristEnde(iso) {
    const { j, m, t } = teile(iso);
    const mon = m - 1 + FRIST_MONATE;
    const jahr = j + Math.floor(mon / 12), monat = (mon % 12) + 1;
    const letzter = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
    return `${jahr}-${String(monat).padStart(2, "0")}-${String(Math.min(t, letzter)).padStart(2, "0")}`;
  }

  function tageZwischen(isoA, isoB) {
    const a = teile(isoA), b = teile(isoB);
    return Math.round((Date.UTC(b.j, b.m - 1, b.t) - Date.UTC(a.j, a.m - 1, a.t)) / 86400000);
  }

  function stunden(von, bis) {
    if (!von || !bis) return 0;
    const [h0, m0] = von.split(":").map(Number), [h1, m1] = bis.split(":").map(Number);
    let d = (h1 * 60 + m1) - (h0 * 60 + m0);
    if (d < 0) d += 24 * 60;
    return d / 60;
  }

  function eur(x) {
    return (Math.round(x * 100) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function km(x) {
    return String(Math.round(x * 10) / 10).replace(".", ",");
  }

  // ------------------------------------------------------------ Regeln

  function ortMap(orte) {
    const m = {};
    for (const o of orte.orte || []) m[o.name] = o;
    return m;
  }

  function entfernung(orte, a, b) {
    for (const e of orte.entfernungen || []) {
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) {
        const wert = Number(e.km);
        return wert > 0 ? wert : null;
      }
    }
    return null;
  }

  function istArbeitsweg(typA, typB) {
    return (typA === "wohnung" && typB === "ausbildungsschule") || (typA === "ausbildungsschule" && typB === "wohnung");
  }

  function ortsbezeichnung(o) {
    return { wohnung: "Wohnort", ausbildungsschule: "Dienstort" }[o.typ] || o.name;
  }

  function istMehrtaegig(f) {
    return !!(f.datum && f.datumBis && f.datumBis > f.datum);
  }

  function mahlzeitenText(f) {
    const m = f.mahlzeiten || {};
    const teile = [["fruehstueck", "Frühstück"], ["mittag", "Mittagessen"], ["abend", "Abendessen"]]
      .filter(([k]) => Number(m[k]) > 0).map(([k, l]) => `${m[k]}× ${l}`);
    if (f.uebernachtung === "gestellt") teile.push(`${tageZwischen(f.datum, f.datumBis)}× Unterkunft`);
    return teile.join(", ");
  }

  /**
   * Nr. 2.1.5 VV-NRKVO: Eine Reise gilt als an der Dienststätte (Ausbildungsschule) angetreten bzw. beendet,
   * wenn sie dort innerhalb der Arbeitszeit hätte beginnen können – außer der Start an der Wohnung ist wirtschaftlicher.
   * Nur aktiv, wenn in den Einstellungen „kürzere Strecke“ gewählt ist (orte.streckeAb = "kuerzer").
   * Ausnahme: Fahrten in der Einführungswoche (f.einfuehrung) – dann gibt es noch keinen Dienst an der Schule.
   */
  function vergleicheMitDienststaette(f, orte, katalog, route, r) {
    if (orte.streckeAb !== "kuerzer" || istMehrtaegig(f) || f.einfuehrung) return;
    const schule = (orte.orte || []).find((o) => o.typ === "ausbildungsschule");
    if (!schule || katalog[route[0]].typ !== "wohnung") return;
    // Nur Tage ohne Unterricht: wer vorher unterrichtet, startet ohnehin an der Schule
    if (f.unterrichtBis || f.unterrichtVon || route.some((s) => katalog[s].typ === "ausbildungsschule")) return;
    const letzte = route.length - 1;
    const alt = route.map((s, i) => ((i === 0 || i === letzte) && katalog[s].typ === "wohnung" ? schule.name : s));
    let altKm = 0;
    for (let i = 0; i < alt.length - 1; i++) {
      const a = katalog[alt[i]], b = katalog[alt[i + 1]];
      if (a.name === b.name || istArbeitsweg(a.typ, b.typ)) continue;
      const d = entfernung(orte, a.name, b.name);
      if (d === null) {
        r.hinweise.push(`Für den Vergleich ab Ausbildungsschule fehlt die Entfernung ${a.name} – ${b.name}`);
        return;
      }
      altKm += d;
    }
    if (altKm < r.km) {
      r.kmWohnung = r.km;
      r.km = altKm;
      r.abSchule = true;
      r.beginnIn = "Dienstort";
      if (katalog[route[letzte]].typ === "wohnung") r.endeIn = "Dienstort";
      r.hinweise.push(`Ab Ausbildungsschule gerechnet (Nr. 2.1.5 VV-NRKVO): ${km(altKm)} statt ${km(r.kmWohnung)} km. In der Einführungswoche bitte „Einführungswoche“ ankreuzen.`);
    }
  }

  /** Berechnet eine Fahrt. Liefert ein neues Objekt mit Ergebnis, Fehlern und Hinweisen. */
  function berechne(f, orte, heute) {
    heute = heute || isoHeute();
    const r = { km: 0, satz: 0, wegstrecke: 0, gedeckelt: false, beginnIn: "", endeIn: "",
      dienstgeschaeftIn: "", tagegeld: 0, summe: 0, fehler: [], hinweise: [], fristEnde: "", fehlendeStrecken: [],
      mehrtaegig: false, tage: 1, naechte: 0, tageAnAb: 0, tageVoll: 0, kuerzung: 0, uebernachtungsgeld: 0, uebernachtungskosten: 0,
      abwesenheit: 0, tagegeldText: "", tagegeldGewaehlt: false, tagegeldAutomatisch: false, rueckwegFehlt: false };
    const katalog = ortMap(orte);
    const route = f.route || [];
    const ende = f.datumBis && f.datumBis > f.datum ? f.datumBis : f.datum;

    if (!f.datum) r.fehler.push("Datum fehlt");
    if (f.datumBis && f.datum && f.datumBis < f.datum) r.fehler.push("Das Enddatum liegt vor dem Startdatum");
    if (route.length < 2) r.fehler.push("Route braucht mindestens zwei Stationen");
    for (const s of route) if (!katalog[s]) r.fehler.push(`Ort „${s}“ gibt es nicht mehr`);
    if (r.fehler.length) return r;

    const gezaehlt = [];
    for (let i = 0; i < route.length - 1; i++) {
      const a = katalog[route[i]], b = katalog[route[i + 1]];
      if (a.name === b.name || istArbeitsweg(a.typ, b.typ)) continue;
      const d = entfernung(orte, a.name, b.name);
      if (d === null) {
        r.fehlendeStrecken.push([a.name, b.name]);
        r.fehler.push(`Entfernung ${a.name} – ${b.name} fehlt (Einstellungen)`);
      } else {
        gezaehlt.push([a, b, d]);
      }
    }
    if (r.fehler.length) return r;
    if (!gezaehlt.length) {
      r.fehler.push("Nicht erstattungsfähig: Wohnung ↔ Ausbildungsschule ist der normale Arbeitsweg");
      return r;
    }

    r.km = gezaehlt.reduce((s, g) => s + g[2], 0);
    r.beginnIn = ortsbezeichnung(gezaehlt[0][0]);
    r.endeIn = ortsbezeichnung(gezaehlt[gezaehlt.length - 1][1]);
    vergleicheMitDienststaette(f, orte, katalog, route, r);
    const ziele = [...new Set(route)].map((s) => katalog[s]).filter((o) => o.typ !== "wohnung" && o.typ !== "ausbildungsschule");
    r.dienstgeschaeftIn = ziele.map((o) => o.adresse || o.name).join(" / ");
    // Endet die Route nicht wieder zu Hause bzw. an der Schule, fehlt meist die Rückfahrt – und mit ihr die Hälfte der km
    const letzter = katalog[route[route.length - 1]];
    if (letzter.typ !== "wohnung" && letzter.typ !== "ausbildungsschule") {
      r.rueckwegFehlt = true;
      r.hinweise.push(`Die Route endet in „${letzter.name}“. Fehlt die Rückfahrt? Sonst zählen nur die km der Hinfahrt.`);
    }

    for (const [feld, name] of [["abfahrt", "Abfahrt"], ["ankunft", "Ankunft"],
      ["veranstVon", "Beginn der Veranstaltung"], ["veranstBis", "Ende der Veranstaltung"]]) {
      if (!f[feld]) r.fehler.push(`${name} fehlt`);
    }
    if (f.anlass === "d" && !(f.anlassText || "").trim()) r.fehler.push("Sonstiger Anlass braucht eine Beschreibung");
    if (f.grund) {
      if (f.verkehrsmittel !== "pkw") r.fehler.push("G1–G5 gilt nur für den privaten Pkw");
      if (!(f.begruendung || "").trim()) r.fehler.push(`${f.grund} ohne Begründung wird abgelehnt`);
    }
    if (ende > heute) r.fehler.push(ende === f.datum ? "Datum liegt in der Zukunft" : "Die Reise ist noch nicht beendet");

    r.fristEnde = fristEnde(ende);
    if (heute > r.fristEnde) r.fehler.push(`Frist abgelaufen (endete ${deDatum(r.fristEnde)})`);
    else if (tageZwischen(heute, r.fristEnde) <= 30) r.hinweise.push(`Frist endet am ${deDatum(r.fristEnde)}`);

    if (f.verkehrsmittel === "pkw") {
      r.satz = f.grund ? SATZ_GROSS : SATZ_KLEIN;
      r.wegstrecke = Math.round(r.km * r.satz * 100) / 100;
      if (!f.grund && r.wegstrecke > DECKEL_KLEIN) {
        r.wegstrecke = DECKEL_KLEIN;
        r.gedeckelt = true;
        r.hinweise.push("Auf 125 € je Reise gedeckelt");
      }
      if (!f.grund && (f.mitfahrende || "").trim()) r.hinweise.push("Fahrgemeinschaft: mit G4 gibt es 0,38 €/km");
      else if (!f.grund && f.unterrichtBis && f.veranstVon) r.hinweise.push("Unterricht und Seminar am selben Tag: G2 prüfen");
    } else if (f.verkehrsmittel === "mitfahrt") {
      // Mitfahrt in einer Fahrgemeinschaft: keine Fahrtkosten, Tagegeld bleibt
      if (!(f.fahrer || "").trim()) r.fehler.push("Bei Mitfahrt bitte angeben, wer gefahren ist");
    } else if (f.verkehrsmittel === "fahrrad") {
      r.satz = SATZ_FAHRRAD;
      r.wegstrecke = Math.round(r.km * r.satz * 100) / 100;
    } else if (f.verkehrsmittel === "oepnv" && !f.fahrkarte) {
      r.hinweise.push("ÖPNV ohne Fahrpreis: nur richtig mit Abo oder Deutschlandticket");
    }
    if (f.fahrkarte || f.sonstige) r.hinweise.push("Beleg beifügen");

    if (istMehrtaegig(f)) {
      r.mehrtaegig = true;
      r.tage = tageZwischen(f.datum, f.datumBis) + 1;
      r.naechte = r.tage - 1;
      r.tageAnAb = 2;
      r.tageVoll = r.tage - 2;
      const m = f.mahlzeiten || {};
      const kuerzung = Object.entries(KUERZUNG).reduce((s, [k, anteil]) => s + (Number(m[k]) || 0) * anteil * TAGEGELD_VOLL, 0);
      const brutto = r.tageAnAb * TAGEGELD + r.tageVoll * TAGEGELD_VOLL;
      r.kuerzung = Math.min(brutto, Math.round(kuerzung * 100) / 100);
      r.tagegeld = brutto - r.kuerzung;

      const art = f.uebernachtung || "pauschal";
      if (art === "pauschal") {
        r.uebernachtungsgeld = UEBERNACHTUNG_PAUSCHAL * r.naechte;
      } else if (art === "beleg") {
        r.uebernachtungskosten = Number(f.uebernachtungKosten) || 0;
        const jeNacht = r.uebernachtungskosten / r.naechte;
        if (!r.uebernachtungskosten) r.fehler.push("Hotelkosten fehlen (oder Pauschale wählen)");
        else r.hinweise.push("Hotelrechnung beifügen");
        if (jeNacht > UEBERNACHTUNG_GRENZE && !(f.uebernachtungBegruendung || "").trim()) {
          r.fehler.push(`Über ${UEBERNACHTUNG_GRENZE} € je Nacht: Begründung mit Nachweis der Suche nach günstigeren Unterkünften nötig`);
        }
        if (f.kompakt && jeNacht > UEBERNACHTUNG_KOMPAKT) {
          r.hinweise.push(`Kompaktveranstaltung: Die Seminarleitung genehmigt bis ${UEBERNACHTUNG_KOMPAKT} € je Nacht, mehr nur das RLSB`);
        }
      }
      if (!(f.genehmigung || "").trim()) r.hinweise.push("Mehrtägige Reisen vorher genehmigen lassen (Seminarleitung) und Genehmigung eintragen");
      if (f.kompakt && route.some((s) => katalog[s] && katalog[s].typ === "sonstiges")) {
        r.hinweise.push("Kompaktveranstaltungen werden nur innerhalb des RLSB-Bezirks erstattet");
      }
      r.tagegeldText = `Tagegeld ${r.tageAnAb} × ${eur(TAGEGELD)} €${r.tageVoll ? ` + ${r.tageVoll} × ${eur(TAGEGELD_VOLL)} €` : ""}`
        + (r.kuerzung ? `, abzüglich ${eur(r.kuerzung)} € für gestellte Mahlzeiten` : "");
    } else {
      // Eintägig: maßgeblich ist die Dauer der Dienstreise von der Abfahrt (Hinfahrt) bis zur Rückkehr (Rückfahrt).
      // Beginnt sie an der Ausbildungsschule, zählt die Zeit dort nicht mit (Dienststätte, § 2 NRKVO).
      // Mit f.tagegeldWahl = "ja" / "nein" lässt sich die Automatik per Knopf überstimmen.
      let dauer = "";
      if (f.abfahrt && f.ankunft) {
        r.abwesenheit = stunden(f.abfahrt, f.ankunft);
        const minuten = Math.round(r.abwesenheit * 60);
        dauer = `${f.abfahrt}–${f.ankunft} Uhr = ${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, "0")} Std. unterwegs`;
      }
      const automatisch = r.abwesenheit > 8;
      const wahl = f.tagegeldWahl === "ja" || f.tagegeldWahl === "nein" ? f.tagegeldWahl : (automatisch ? "ja" : "nein");
      r.tagegeldGewaehlt = wahl === "ja";
      r.tagegeldAutomatisch = automatisch;
      if (wahl === "ja") {
        r.tagegeld = TAGEGELD;
        r.tagegeldText = `${dauer ? dauer + ": " : ""}Tagegeld ${eur(TAGEGELD)} €`;
        if (!automatisch) {
          r.hinweise.push(dauer
            ? "Tagegeld gibt es nur bei mehr als 8 Std. Bitte Abfahrt (Hinfahrt) und Rückkehr (Rückfahrt) prüfen."
            : "Für das Tagegeld bitte Abfahrt und Rückkehr eintragen.");
        }
      } else {
        const ab = r.beginnIn === "Dienstort" && !r.abSchule ? " ab der Ausbildungsschule" : "";
        r.tagegeldText = f.tagegeldWahl === "nein" ? "Tagegeld abgewählt"
          : `${dauer ? dauer + ab + ": " : ""}kein Tagegeld (erst ab mehr als 8 Std.)`;
      }
    }
    r.summe = r.wegstrecke + (Number(f.fahrkarte) || 0) + (Number(f.sonstige) || 0) + r.tagegeld
      + r.uebernachtungsgeld + r.uebernachtungskosten;
    return r;
  }

  function g4Vorschlag(f) {
    const namen = (f.mitfahrende || "").trim();
    return namen ? `Fahrgemeinschaft mit ${namen} (ebenfalls Landesbedienstete), dadurch kostengünstiger als Einzelfahrten` : "";
  }

  function g2Vorschlag(f) {
    const teile = [];
    if (f.unterrichtBis) teile.push(`Unterricht bis ${f.unterrichtBis}`);
    if (f.veranstVon) teile.push(`Seminar ab ${f.veranstVon}`);
    return teile.length ? `${teile.join(", ")}; mit ÖPNV nicht rechtzeitig erreichbar` : "";
  }

  // ------------------------------------------------------------ Formularwerte

  function werteAnlage(profil, fahrten) {
    const name = profil.name + (profil.amtsbezeichnung ? ` (${profil.amtsbezeichnung})` : "");
    const w = { Name_Antragsteller: name, Name_Schule: profil.schule_name_adresse, Adresse_Antragsteller: profil.wohnanschrift };
    let summe = 0;
    fahrten.forEach(({ f, r }, i) => {
      const n = i === 0 ? "" : String(i);
      const zaehlt = f.verkehrsmittel === "pkw" || f.verkehrsmittel === "fahrrad";
      if (zaehlt) summe += r.km;
      const mitfahrende = (f.mitfahrende || "").trim();
      const begruendung = f.verkehrsmittel === "mitfahrt" ? `Mitfahrt bei ${(f.fahrer || "").trim()}, keine Fahrtkosten`
        : [f.begruendung || "", mitfahrende && !(f.begruendung || "").includes(mitfahrende) ? `Mitfahrende: ${mitfahrende}` : ""].filter(Boolean).join("; ");
      Object.assign(w, {
        [`Datum${n}`]: deDatum(f.datum, true),
        [`von_Uhrzeit${n}`]: f.unterrichtVon || "",
        [`bis_Uhrzeit${i + 1}`]: f.unterrichtBis || "",
        [`Beginn_der_Fahrt_Wohnort${n}`]: r.beginnIn,
        [`Beginn_der_Fahrt_Uhrzeit${n}`]: f.abfahrt,
        [`Anlass_DR${n}`]: f.anlass || "a",
        [`Seminarveranstaltung_in_Ort${n}`]: f.anlass === "d" ? `${f.anlassText}: ${r.dienstgeschaeftIn}` : r.dienstgeschaeftIn,
        [`Seminar_von_Uhrzeit${n}`]: f.veranstVon,
        [`Seminar_bis_Uhrzeit${n}`]: f.veranstBis,
        [`Ende_der_Fahrt_Wohnort${n}`]: r.endeIn,
        [`Ende_der_Fahrt_Uhrzeit${n}`]: f.ankunft,
        [`Strecke${n}`]: zaehlt ? km(r.km) : "",
        [`Nutzung_Befoerderungsmittel${n}`]: f.verkehrsmittel === "fahrrad",
        [`Grund_Nutzung_Pkw${n}`]: f.grund || "",
        [`Begruendung${n}`]: begruendung,
        [`Oepnv_Parken${n}`]: !!(f.fahrkarte || f.sonstige),
      });
    });
    w.Summe_Strecke = km(summe);
    return w;
  }

  function datenText(fahrten) {
    const jahre = [...new Set(fahrten.map(({ f }) => f.datum.slice(0, 4)))].sort();
    return jahre.map((j) => fahrten.filter(({ f }) => f.datum.startsWith(j))
      .map(({ f }) => deDatum(f.datum).slice(0, 6)).join(", ") + j).join("; ");
  }

  /** Erläuterungen zu Fahrgemeinschaften: Namen der Mitfahrenden bzw. wer gefahren ist (verlangt das Formular). */
  function fahrgemeinschaftText(fahrten) {
    const text = [];
    const gefahren = fahrten.filter(({ f }) => f.verkehrsmittel === "pkw" && (f.mitfahrende || "").trim());
    if (gefahren.length) {
      text.push("Fahrgemeinschaft, mitfahrende Personen: " + gefahren.map(({ f }) => `${deDatum(f.datum).slice(0, 6)} ${f.mitfahrende.trim()}`).join("; ") + ".");
    }
    const mit = fahrten.filter(({ f }) => f.verkehrsmittel === "mitfahrt");
    if (mit.length) {
      text.push("Mitfahrt in Fahrgemeinschaft ohne Fahrtkosten: " + mit.map(({ f }) => `${deDatum(f.datum).slice(0, 6)} bei ${(f.fahrer || "").trim()}`).join("; ") + ".");
    }
    return text;
  }

  /** Felder, die jeder Antrag hat: Person, Bank, Allgemeines, Beförderungsmittel, Fahrtkosten, Wegstrecke. */
  function basisAntrag(profil, fahrten) {
    const iban = (profil.iban || "").replace(/\s/g, "").toUpperCase();
    const w = {
      Beschaeftigungsstelle: profil.beschaeftigungsstelle,
      Name__Vorname: profil.name,
      Kreditinstitut: profil.bic,
      Abrechnende_Dienststelle: profil.abrechnende_dienststelle,
      Wohnungsanschrift: [profil.wohnanschrift, profil.telefon, profil.email].filter(Boolean).join("\n"),
    };
    [...iban.slice(0, 22)].forEach((z, i) => { w[`IBAN${i + 1}`] = z; });

    const bahncard = String(profil.bahncard || "nein").toLowerCase().replace(/\s/g, "");
    w[BAHNCARD_FELD[bahncard] || "OBJ21"] = true;
    if (bahncard !== "nein") w.OBJ22 = true;
    if (profil.geschaeftskundenrabatt) w.OBJ29 = true;
    else { w.OBJ30 = true; w.Begruendung_nein = profil.begruendung_kein_geschaeftskundenrabatt || ""; }
    if (profil.ermaessigungskarte) { w.OBJ33 = true; w.Strecke = profil.ermaessigungskarte; } else w.OBJ32 = true;
    for (const feld of IMMER_NEIN) w[feld] = true;
    w.OBJ37 = true;  // keine unentgeltliche Verpflegung; mehrtägige Reisen überschreiben das

    const mittel = new Set(fahrten.map(({ f }) => f.verkehrsmittel));
    if (mittel.has("oepnv")) w.OBJ4 = true;
    if (fahrten.some(({ f }) => f.verkehrsmittel === "pkw" && !f.grund)) w.OBJ6 = true;
    if (fahrten.some(({ f }) => f.verkehrsmittel === "pkw" && f.grund)) w.OBJ7 = true;
    if (mittel.has("fahrrad")) w.OBJ8 = true;

    const fahrkarte = fahrten.reduce((s, { f }) => s + (Number(f.fahrkarte) || 0), 0);
    const sonstige = fahrten.reduce((s, { f }) => s + (Number(f.sonstige) || 0), 0);
    if (fahrkarte) w.Fahrkarte = eur(fahrkarte);
    if (sonstige) w.Sonstige_Fahrauslagen = eur(sonstige);

    const gruppen = new Map();
    for (const { r } of fahrten) {
      if (!r.satz) continue;
      const g = gruppen.get(r.satz) || [0, 0];
      gruppen.set(r.satz, [g[0] + r.km, g[1] + r.wegstrecke]);
    }
    if (gruppen.size > 2) {
      // Das Formular hat nur zwei km-Zeilen: Das Fahrrad wandert dann in „Erstattung sonstiger Kosten“ (Seite 2)
      const [k, betrag] = gruppen.get(SATZ_FAHRRAD);
      gruppen.delete(SATZ_FAHRRAD);
      w.Sonstige_Fahrauslagen1 = eur(betrag);
      w.Erlaeuterungen1 = `Wegstreckenentschädigung Fahrrad (§ 5 Abs. 5 NRKVO): ${km(k)} km × ${eur(SATZ_FAHRRAD)} € = ${eur(betrag)} €, Fahrten siehe Anlage 035_016 (Spalte 8).`;
    }
    const zeilen = [["Tage3", "EUR3", "Wegstreckenentschaedigung"], ["Tage4", "EUR4", "Wegstreckenentschaedigung1"]];
    [SATZ_KLEIN, SATZ_GROSS, SATZ_FAHRRAD].filter((s) => gruppen.has(s)).forEach((satz, i) => {
      const [k, betrag] = gruppen.get(satz);
      const [fk, fs, fe] = zeilen[i];
      w[fk] = km(k); w[fs] = eur(satz); w[fe] = eur(betrag);
    });
    return { w, mittel, belege: !!(fahrkarte || sonstige) };
  }

  /** Sammelantrag für Tagesfahrten; Einzelheiten stehen in der Anlage 035_016. */
  function werteAntrag(profil, fahrten, blaetter) {
    const { w, mittel, belege } = basisAntrag(profil, fahrten);
    const daten = datenText(fahrten);
    const grund = `AFR, Ausbildungsfahrten lt. Anlage 035_016: ${daten}`;
    if (grund.length <= 75) w.Grund_der_RKR = grund;
    else { w.Grund_der_RKR = "AFR, Ausbildungsfahrten lt. Anlage 035_016 (Daten s. Anlage)"; w.Grund_der_RKR1 = daten; }

    const siehe = "siehe Anlage 035_016";
    Object.assign(w, { Beginn_der_Dienstreise: siehe, Beginn_des_Dienstgeschaefts: siehe,
      Ende_des_Dienstgeschaefts: siehe, Ende_der_Dienstreise: siehe,
      Reiseziel_Reiseweg: `${siehe} (${fahrten.length} Fahrten, ${blaetter} Blatt)` });

    const tage = fahrten.filter(({ r }) => r.tagegeld).length;
    if (tage) { w.Tage = String(tage); w.EUR = eur(TAGEGELD); }

    const text = ["Reisen zum Zweck der Ausbildung (generell genehmigt, Anlage 1 Leitfaden Genehmigung von Dienstreisen).",
      `Einzelaufstellung siehe Anlage 035_016 (${blaetter} Blatt).`];
    if (w.OBJ7) text.push("Erhebliches dienstliches Interesse an der Pkw-Nutzung (§ 5 Abs. 3 NRKVO): Gründe G1–G5 mit Begründung je Fahrt in der Anlage.");
    if (fahrten.some(({ r }) => r.gedeckelt)) text.push("Kleine Wegstreckenentschädigung je Reise auf 125 € begrenzt.");
    if (mittel.has("fahrrad")) text.push("Fahrrad: Wegstreckenentschädigung nach § 5 Abs. 5 NRKVO.");
    text.push(...fahrgemeinschaftText(fahrten));
    if (fahrten.some(({ r }) => r.abSchule)) text.push("Strecken an Tagen ohne Unterricht nach Nr. 2.1.5 VV-NRKVO ab Ausbildungsschule berechnet, soweit kürzer.");
    const einf = fahrten.filter(({ f }) => f.einfuehrung);
    if (einf.length) text.push(`Einführungswoche (${einf.map(({ f }) => deDatum(f.datum).slice(0, 6)).join(", ")}): noch kein Dienst an der Ausbildungsschule, Fahrten ab Wohnung.`);
    if (belege) text.push("Belege (Fahrkarten/Parkscheine) liegen bei.");
    w.Erlaeuterungen = text.join(" ");
    return w;
  }

  /** Eigener Antrag für eine mehrtägige Reise (z. B. Kompaktseminar): Zeiten, Tagegeld und Übernachtung direkt im Antrag. */
  function werteAntragMehrtaegig(profil, { f, r }) {
    const { w, belege } = basisAntrag(profil, [{ f, r }]);
    const anlass = f.anlass === "d" ? f.anlassText : (f.kompakt ? "Kompaktseminar" : "Seminarveranstaltung");
    w.Grund_der_RKR = `AFR, ${anlass}, ${deDatum(f.datum).slice(0, 6)}–${deDatum(f.datumBis)}`;
    if ((f.genehmigung || "").trim()) { w.OBJ3 = true; w.Dienststelle_Datum = f.genehmigung.trim(); }
    Object.assign(w, {
      Beginn_der_Dienstreise: `${deDatum(f.datum)}, ${f.abfahrt} Uhr`,
      Beginn_des_Dienstgeschaefts: `${deDatum(f.datum)}, ${f.veranstVon} Uhr`,
      Ende_des_Dienstgeschaefts: `${deDatum(f.datumBis)}, ${f.veranstBis} Uhr`,
      Ende_der_Dienstreise: `${deDatum(f.datumBis)}, ${f.ankunft} Uhr`,
      Reiseziel_Reiseweg: `${r.dienstgeschaeftIn} (${(f.route || []).join(" – ")})`,
    });

    // Tagegeld ungekürzt eintragen; Kürzungen für gestellte Mahlzeiten setzt das RLSB in den roten Feldern ab
    w.Tage = String(r.tageAnAb); w.EUR = eur(TAGEGELD);
    if (r.tageVoll) { w.Tage6 = String(r.tageVoll); w.EUR6 = eur(TAGEGELD_VOLL); }
    const mahlzeiten = mahlzeitenText(f);
    if (mahlzeiten) { delete w.OBJ37; w.OBJ36 = true; w.Verpflegung = mahlzeiten; }
    if (r.uebernachtungsgeld) w.Uebernachtungsgeld = eur(r.uebernachtungsgeld);
    if (r.uebernachtungskosten) w.Erstattung_Uebernachtungskosten = eur(r.uebernachtungskosten);

    const text = [`Mehrtägige Reise zum Zweck der Ausbildung (${anlass}), ${r.tage} Tage, ${r.naechte} Übernachtung${r.naechte === 1 ? "" : "en"}.`];
    if (f.kompakt) text.push("Kompaktveranstaltung des Studienseminars.");
    if (f.verkehrsmittel !== "oepnv") text.push(`Strecke ${km(r.km)} km.`);
    if (f.grund) text.push(`Pkw-Nutzung ${f.grund}: ${f.begruendung}`);
    text.push(...fahrgemeinschaftText([{ f, r }]));
    if (f.uebernachtung === "beleg") text.push(`Übernachtungskosten lt. Rechnung${(f.uebernachtungBegruendung || "").trim() ? `: ${f.uebernachtungBegruendung.trim()}` : "."}`);
    if (f.uebernachtung === "gestellt") text.push("Unterkunft wurde unentgeltlich gestellt.");
    if (belege || r.uebernachtungskosten) text.push("Belege liegen bei.");
    w.Erlaeuterungen = text.join(" ");
    return w;
  }

  // ------------------------------------------------------------ PDF

  // Verständliche Namen für Hinweise zu gekürzten oder sehr klein gesetzten Feldern
  const FELDNAMEN = {
    Begruendung_nein: "Begründung ohne Geschäftskundenrabatt", Strecke: "Ermäßigungskarte", Beschaeftigungsstelle: "Beschäftigungsstelle",
    Name__Vorname: "Name", Abrechnende_Dienststelle: "Abrechnende Dienststelle", Reiseziel_Reiseweg: "Reiseziel/Reiseweg",
    Verpflegung: "Gestellte Mahlzeiten", Dienststelle_Datum: "Genehmigt durch", Grund_der_RKR: "Grund der Reise",
    Name_Schule: "Schulname und Adresse", Adresse_Antragsteller: "Wohnanschrift", Seminarveranstaltung_in_Ort: "Ort der Veranstaltung",
    Begruendung: "Begründung G1–G5", Erlaeuterungen: "Erläuterungen", Wohnungsanschrift: "Wohnanschrift",
  };

  function machSicher(font, text) {
    // Standard-Helvetica kann nur WinAnsi; alles andere ersetzen statt abzustürzen
    let aus = "";
    for (const z of text.replace(/[↔→]/g, "-").replace(/[„“]/g, '"')) {
      if (z === "\n") { aus += z; continue; }
      try { font.widthOfTextAtSize(z, 8); aus += z; } catch (e) { aus += "?"; }
    }
    return aus;
  }

  function umbrechen(font, text, groesse, breite) {
    const zeilen = [];
    for (const absatz of text.split("\n")) {
      let zeile = "";
      for (const wort of absatz.split(/\s+/).filter(Boolean)) {
        const probe = zeile ? `${zeile} ${wort}` : wort;
        if (zeile && font.widthOfTextAtSize(probe, groesse) > breite) { zeilen.push(zeile); zeile = wort; }
        else zeile = probe;
      }
      zeilen.push(zeile);
    }
    return zeilen;
  }

  function passendeSchrift(font, text, rect) {
    const breite = rect.width - (rect.width < 15 ? 1 : 6), hoehe = rect.height - 2;
    const mehrzeilig = hoehe >= 15;
    for (const g of [8, 7, 6.5, 6, 5.5, 5, 4.5, 4]) {
      if (!mehrzeilig) {
        if (g <= hoehe * 0.85 && font.widthOfTextAtSize(text, g) <= breite) return { g, mehrzeilig, passt: true };
      } else if (umbrechen(font, text, g, breite).length * g * 1.4 <= hoehe) {
        return { g, mehrzeilig, passt: true };
      }
    }
    return { g: 4, mehrzeilig, passt: false };
  }

  async function fuelle(PDFLib, bytes, werte, etikett, zuLang) {
    const doc = await PDFLib.PDFDocument.load(bytes);
    const form = doc.getForm();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    for (const [name, wert] of Object.entries(werte)) {
      const feld = form.getField(name);
      if (feld instanceof PDFLib.PDFCheckBox) {
        if (wert) feld.check();
        continue;
      }
      let text = machSicher(font, String(wert ?? ""));
      if (!text) continue;
      // Viele Formularfelder erlauben höchstens 199 Zeichen: an einer Wortgrenze kürzen statt abzubrechen
      const max = feld.getMaxLength();
      if (max !== undefined && text.length > max) {
        const schnitt = text.slice(0, max - 1);
        text = (schnitt.lastIndexOf(" ") > max * 0.6 ? schnitt.slice(0, schnitt.lastIndexOf(" ")) : schnitt) + "…";
        zuLang.push(`${etikett}: ${FELDNAMEN[name.replace(/\d+$/, "")] || name} auf ${max} Zeichen gekürzt`);
      }
      const rect = feld.acroField.getWidgets()[0].getRectangle();
      const { g, mehrzeilig, passt } = passendeSchrift(font, text, rect);
      if (!passt) zuLang.push(`${etikett}: ${FELDNAMEN[name.replace(/\d+$/, "")] || name} steht in sehr kleiner Schrift`);
      if (mehrzeilig) feld.enableMultiline();
      feld.setText(text);
      feld.setFontSize(g);
    }
    // Verstecktes Systemfeld des Formularservers, wird beim Einbrennen sonst als grauer Balken sichtbar
    const dummy = form.getFieldMaybe("SYSTEM_P1_DUMMY");
    if (dummy) {
      for (const w of dummy.acroField.getWidgets()) {
        const ref = doc.context.getObjectRef(w.dict);
        if (ref) for (const seite of doc.getPages()) seite.node.removeAnnot(ref);
      }
      form.acroForm.removeField(dummy.acroField);
    }
    form.updateFieldAppearances(font);
    form.flatten();
    return doc;
  }

  async function zusammenfuegen(PDFLib, docs) {
    const ziel = await PDFLib.PDFDocument.create();
    for (const d of docs) {
      const seiten = await ziel.copyPages(d, d.getPageIndices());
      seiten.forEach((s) => ziel.addPage(s));
    }
    return ziel.save();
  }

  /**
   * Erzeugt die Abrechnung als flache PDFs. fahrten: [{f, r}] ohne Fehler.
   * Tagesfahrten: ein Antrag 035_002 + Anlage(n) 035_016. Jede mehrtägige Reise: ein eigener Antrag.
   * Liefert die Gesamtdatei und jedes Teil einzeln (zum getrennten Speichern und für die Vorschau).
   */
  async function erzeugePdf(PDFLib, { profil, fahrten, antragBytes, anlageBytes }) {
    const sortiert = [...fahrten].sort((x, y) => (x.f.datum + x.f.abfahrt).localeCompare(y.f.datum + y.f.abfahrt));
    const tagesfahrten = sortiert.filter(({ r }) => !r.mehrtaegig);
    const mehrtaegig = sortiert.filter(({ r }) => r.mehrtaegig);
    const zuLang = [];
    const teile = [];  // {art, titel, dateiname, docs}

    if (tagesfahrten.length) {
      const blaetter = [];
      for (let i = 0; i < tagesfahrten.length; i += ZEILEN_JE_ANLAGE) blaetter.push(tagesfahrten.slice(i, i + ZEILEN_JE_ANLAGE));
      teile.push({ art: "antrag", titel: `Antrag 035_002 für ${tagesfahrten.length} Tagesfahrt${tagesfahrten.length === 1 ? "" : "en"}`, dateiname: "Antrag_035_002",
        docs: [await fuelle(PDFLib, antragBytes, werteAntrag(profil, tagesfahrten, blaetter.length), "Antrag", zuLang)] });
      const anlageDocs = [];
      for (let i = 0; i < blaetter.length; i++) {
        anlageDocs.push(await fuelle(PDFLib, anlageBytes, werteAnlage(profil, blaetter[i]), `Anlage Blatt ${i + 1}`, zuLang));
      }
      teile.push({ art: "anlage", titel: `Anlage 035_016 (${blaetter.length} Blatt)`, dateiname: "Anlage_035_016", docs: anlageDocs });
    }
    for (const x of mehrtaegig) {
      teile.push({ art: "mehrtaegig", titel: `Antrag 035_002 für die Reise ${deDatum(x.f.datum).slice(0, 6)}–${deDatum(x.f.datumBis)}`,
        dateiname: `Antrag_035_002_${x.f.datum}_bis_${x.f.datumBis}`,
        docs: [await fuelle(PDFLib, antragBytes, werteAntragMehrtaegig(profil, x), `Antrag ${deDatum(x.f.datum)}`, zuLang)] });
    }

    let seite = 1;
    for (const t of teile) {
      t.bytes = await zusammenfuegen(PDFLib, t.docs);
      t.seiten = t.docs.reduce((s, d) => s + d.getPageCount(), 0);
      t.vonSeite = seite; seite += t.seiten;
      delete t.docs;
    }
    const gesamt = await PDFLib.PDFDocument.create();
    for (const t of teile) {
      const d = await PDFLib.PDFDocument.load(t.bytes);
      const seiten = await gesamt.copyPages(d, d.getPageIndices());
      seiten.forEach((s) => gesamt.addPage(s));
    }
    return { bytes: await gesamt.save(), teile, zuLang, seiten: seite - 1 };
  }

  const Kern = { SATZ_KLEIN, SATZ_GROSS, SATZ_FAHRRAD, DECKEL_KLEIN, TAGEGELD, TAGEGELD_VOLL, GRUENDE,
    UEBERNACHTUNG_PAUSCHAL, UEBERNACHTUNG_GRENZE, UEBERNACHTUNG_KOMPAKT,
    isoHeute, deDatum, fristEnde, berechne, istMehrtaegig, g2Vorschlag, g4Vorschlag, werteAntrag, werteAntragMehrtaegig, werteAnlage, erzeugePdf, eur, km };
  if (typeof module !== "undefined" && module.exports) module.exports = Kern;
  else root.Kern = Kern;
})(typeof globalThis !== "undefined" ? globalThis : this);
