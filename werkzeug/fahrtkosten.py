"""Füllt die Reisekostenformulare 035_002 (Antrag) und 035_016 (Anlage Studienseminare) aus.

Eingaben (im Datenordner, Standard: daten/):
  profil.json   feste Angaben (Name, IBAN, Schule, BahnCard ...)
  orte.json     benannte Orte mit Typ und Adresse + Entfernungen (Google Maps, einfache Richtung)
  fahrten.csv   eine Zeile pro Fahrt (Semikolon-getrennt, Excel-tauglich)

Aufruf:
  python werkzeug/fahrtkosten.py                 alle noch nicht abgerechneten Fahrten
  python werkzeug/fahrtkosten.py --von 01.09.2026 --bis 30.09.2026
  python werkzeug/fahrtkosten.py --nur-pruefen   nur prüfen, keine PDFs
  python werkzeug/fahrtkosten.py --markieren     abgerechnete Fahrten in fahrten.csv vermerken

Regeln: Leitfaden Reisekosten im Vorbereitungsdienst, RLSB, Stand 01.01.2025.
"""

import argparse
import calendar
import csv
import json
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

import fitz  # PyMuPDF

BASIS = Path(__file__).resolve().parent.parent
FORMULAR_ANTRAG = BASIS / "Reisekosten_Antrag_035_002.pdf"
FORMULAR_ANLAGE = BASIS / "Reisekosten_Anlage.pdf"

# Sätze nach NRKVO / Leitfaden (Stand 01.01.2025)
SATZ_KLEIN = 0.25          # € / km, § 5 Abs. 2
DECKEL_KLEIN = 125.00      # € je Reise bei kleiner Wegstreckenentschädigung
SATZ_GROSS = 0.38          # € / km, § 5 Abs. 3 (erhebliches dienstliches Interesse, G1–G5)
SATZ_FAHRRAD = 0.10        # € / km, § 5 Abs. 5
TAGEGELD_EINTAEGIG = 14.00  # € bei Abwesenheit > 8 Stunden
FRIST_MONATE = 6

PLATZHALTER = "BITTE AUSFÜLLEN"
ZEILEN_JE_ANLAGE = 15
GRUENDE = {"G1", "G2", "G3", "G4", "G5"}
ANLAESSE = {"a", "b", "c", "d"}
VERKEHRSMITTEL = {"pkw", "oepnv", "fahrrad"}

# Ankreuzfelder im Antrag 035_002 (per Position im Formular zugeordnet)
BAHNCARD_FELD = {
    "nein": "OBJ21", "business25": "OBJ23", "business50": "OBJ24",
    "business100": "OBJ25", "25": "OBJ26", "50": "OBJ27", "100": "OBJ28",
}
BAHNCARD_JA = "OBJ22"
IMMER_NEIN = [
    "OBJ34",  # Dienstgeschäft im Umkreis von 2 km
    "OBJ37",  # unentgeltliche Verpflegung/Unterkunft
    "OBJ38",  # Trennungsgeld
    "OBJ40",  # mit Urlaub > 5 Tage verbunden
    "OBJ42",  # Auslandsdienstreise
    "OBJ9",   # Zuwendungen Dritter
    "OBJ52",  # Reisekostenabschlag
    "OBJ54",  # Eigenanteile
]


class Fehler(Exception):
    pass


@dataclass
class Fahrt:
    zeile: int
    datum: date
    stationen: list
    unterricht_von: str
    unterricht_bis: str
    abfahrt: str
    anlass: str
    veranstaltung_von: str
    veranstaltung_bis: str
    ankunft: str
    verkehrsmittel: str
    grund: str
    begruendung: str
    fahrkarte: float
    sonstige: float
    notiz: str
    roh: dict
    # berechnet
    km: float = 0.0
    satz: float = 0.0
    wegstrecke_eur: float = 0.0
    gedeckelt: bool = False
    beginn_in: str = ""
    ende_in: str = ""
    dienstgeschaeft_in: str = ""
    tagegeld: float = 0.0
    fehler: list = field(default_factory=list)
    hinweise: list = field(default_factory=list)

    @property
    def summe(self):
        return self.wegstrecke_eur + self.fahrkarte + self.sonstige + self.tagegeld


# ---------------------------------------------------------------- Einlesen

def lies_datum(text):
    text = text.strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d.%m.%y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise Fehler(f"Datum nicht lesbar: '{text}' (erwartet TT.MM.JJJJ)")


def lies_zeit(text):
    """'8:00', '08.00', '800' -> '08:00'; leer bleibt leer."""
    text = text.strip().replace(".", ":")
    if not text:
        return ""
    if ":" not in text and text.isdigit() and len(text) in (3, 4):
        text = text[:-2] + ":" + text[-2:]
    try:
        return datetime.strptime(text, "%H:%M").strftime("%H:%M")
    except ValueError:
        raise Fehler(f"Uhrzeit nicht lesbar: '{text}' (erwartet HH:MM)")


def lies_betrag(text):
    text = text.strip().replace("€", "").replace(" ", "")
    if not text:
        return 0.0
    return float(text.replace(".", "").replace(",", ".") if "," in text else text)


def lade_daten(ordner):
    profil = json.loads((ordner / "profil.json").read_text(encoding="utf-8"))
    orte = json.loads((ordner / "orte.json").read_text(encoding="utf-8"))
    with open(ordner / "fahrten.csv", encoding="utf-8-sig", newline="") as f:
        zeilen = list(csv.DictReader(f, delimiter=";"))
    return profil, orte, zeilen


def baue_fahrt(nr, z, profil):
    def wert(schluessel):
        return (z.get(schluessel) or "").strip()

    return Fahrt(
        zeile=nr,
        datum=lies_datum(wert("datum")),
        stationen=[s.strip() for s in wert("route").split(">") if s.strip()],
        unterricht_von=lies_zeit(wert("unterricht_von")),
        unterricht_bis=lies_zeit(wert("unterricht_bis")),
        abfahrt=lies_zeit(wert("abfahrt")),
        anlass=wert("anlass").lower() or "a",
        veranstaltung_von=lies_zeit(wert("veranstaltung_von")),
        veranstaltung_bis=lies_zeit(wert("veranstaltung_bis")),
        ankunft=lies_zeit(wert("ankunft")),
        verkehrsmittel=(wert("verkehrsmittel") or profil.get("standard_verkehrsmittel", "pkw")).lower(),
        grund=wert("grund").upper(),
        begruendung=wert("begruendung"),
        fahrkarte=lies_betrag(wert("fahrkarte_eur")),
        sonstige=lies_betrag(wert("sonstige_eur")),
        notiz=wert("notiz"),
        roh=z,
    )


# ---------------------------------------------------------------- Regeln

def entfernung(orte, a, b):
    for x, y, km in orte["entfernungen_km"]:
        if {x, y} == {a, b}:
            return float(km)
    raise Fehler(f"Keine Entfernung für '{a}' ↔ '{b}' in orte.json – bitte aus Google Maps nachtragen")


def ist_arbeitsweg(typ_a, typ_b):
    """Wohnung ↔ Ausbildungsschule zählt nie (Leitfaden, Beispiele 3, 5, 6)."""
    return {typ_a, typ_b} == {"wohnung", "ausbildungsschule"}


def ortsbezeichnung(typ):
    return {"wohnung": "Wohnort", "ausbildungsschule": "Dienstort"}.get(typ, "")


def dauer_stunden(von, bis):
    if not von or not bis:
        return 0.0
    t0 = datetime.strptime(von, "%H:%M")
    t1 = datetime.strptime(bis, "%H:%M")
    if t1 < t0:
        t1 += timedelta(days=1)
    return (t1 - t0).total_seconds() / 3600


def berechne(f, orte, heute):
    katalog = orte["orte"]
    for s in f.stationen:
        if s not in katalog:
            f.fehler.append(f"Ort '{s}' fehlt in orte.json")
    if f.fehler:
        return
    if len(f.stationen) < 2:
        f.fehler.append("Route braucht mindestens zwei Stationen, z. B. 'Wohnung > Seminar > Wohnung'")
        return

    typ = lambda s: katalog[s]["typ"]
    gezaehlt = []
    for a, b in zip(f.stationen, f.stationen[1:]):
        if a == b or ist_arbeitsweg(typ(a), typ(b)):
            continue
        try:
            gezaehlt.append((a, b, entfernung(orte, a, b)))
        except Fehler as e:
            f.fehler.append(str(e))
    if f.fehler:
        return
    if not gezaehlt:
        f.fehler.append("Keine abrechenbare Teilstrecke: Fahrten Wohnung ↔ Ausbildungsschule sind "
                        "nicht erstattungsfähig (Leitfaden Beispiele 5 und 6)")
        return

    f.km = sum(km for _, _, km in gezaehlt)
    f.beginn_in = ortsbezeichnung(typ(gezaehlt[0][0])) or gezaehlt[0][0]
    f.ende_in = ortsbezeichnung(typ(gezaehlt[-1][1])) or gezaehlt[-1][1]
    ziele = [s for s in dict.fromkeys(f.stationen) if typ(s) not in ("wohnung", "ausbildungsschule")]
    f.dienstgeschaeft_in = " / ".join(katalog[s]["adresse"] for s in ziele)

    # Pflichtangaben
    for name, wert in (("abfahrt", f.abfahrt), ("ankunft", f.ankunft),
                       ("veranstaltung_von", f.veranstaltung_von), ("veranstaltung_bis", f.veranstaltung_bis)):
        if not wert:
            f.fehler.append(f"Uhrzeit '{name}' fehlt")
    if f.anlass not in ANLAESSE:
        f.fehler.append(f"Anlass '{f.anlass}' ungültig (a = Seminarveranstaltung, d = sonstiger Anlass)")
    if f.anlass == "d" and not f.notiz:
        f.fehler.append("Anlass d (sonstiger Anlass) braucht eine Beschreibung in der Spalte 'notiz'")
    if f.verkehrsmittel not in VERKEHRSMITTEL:
        f.fehler.append(f"Verkehrsmittel '{f.verkehrsmittel}' unbekannt (pkw, oepnv oder fahrrad)")
    if f.grund:
        if f.grund not in GRUENDE:
            f.fehler.append(f"Grund '{f.grund}' ungültig (G1–G5)")
        if f.verkehrsmittel != "pkw":
            f.fehler.append("Grund G1–G5 gilt nur für die Nutzung des privaten Pkw")
        if not f.begruendung:
            f.fehler.append(f"{f.grund} ohne Begründung wird abgelehnt – Spalte 'begruendung' ausfüllen")
    if f.datum > heute:
        f.fehler.append("Datum liegt in der Zukunft")

    # Frist: 6 Monate nach Ende jeder einzelnen Reise
    monat = f.datum.month - 1 + FRIST_MONATE
    jahr, monat = f.datum.year + monat // 12, monat % 12 + 1
    frist_ende = date(jahr, monat, min(f.datum.day, calendar.monthrange(jahr, monat)[1]))
    if heute > frist_ende:
        f.fehler.append(f"Ausschlussfrist abgelaufen (6 Monate, endete {frist_ende:%d.%m.%Y})")
    elif (frist_ende - heute).days <= 30:
        f.hinweise.append(f"Frist endet bald: {frist_ende:%d.%m.%Y}")

    # Erstattung
    if f.verkehrsmittel == "pkw":
        f.satz = SATZ_GROSS if f.grund else SATZ_KLEIN
        f.wegstrecke_eur = round(f.km * f.satz, 2)
        if not f.grund and f.wegstrecke_eur > DECKEL_KLEIN:
            f.wegstrecke_eur, f.gedeckelt = DECKEL_KLEIN, True
            f.hinweise.append("Kleine Wegstreckenentschädigung auf 125 € gedeckelt")
        if not f.grund and f.unterricht_bis and f.veranstaltung_von:
            f.hinweise.append("Unterricht und Seminar am selben Tag – prüfen, ob G2 (0,38 €/km) passt")
    elif f.verkehrsmittel == "fahrrad":
        f.satz = SATZ_FAHRRAD
        f.wegstrecke_eur = round(f.km * f.satz, 2)
    elif f.verkehrsmittel == "oepnv" and not f.fahrkarte:
        f.hinweise.append("ÖPNV ohne Fahrkartenbetrag – nur korrekt, wenn die Fahrt durch ein Abo/Deutschlandticket abgedeckt ist")
    if f.fahrkarte or f.sonstige:
        f.hinweise.append("Beleg (Fahrkarte/Parkschein) beifügen")

    if dauer_stunden(f.abfahrt, f.ankunft) > 8:
        f.tagegeld = TAGEGELD_EINTAEGIG


# ---------------------------------------------------------------- PDF

def eur(betrag):
    return f"{betrag:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def km_text(km):
    return f"{km:g}".replace(".", ",")


def umbrechen(text, groesse, breite):
    zeilen = []
    for absatz in text.split("\n"):
        zeile = ""
        for wort in absatz.split():
            probe = f"{zeile} {wort}".strip()
            if zeile and fitz.get_text_length(probe, "helv", groesse) > breite:
                zeilen.append(zeile)
                zeile = wort
            else:
                zeile = probe
        zeilen.append(zeile)
    return zeilen


def passende_schrift(text, rect):
    """Größte Schrift (8–4 pt), mit der der Text ins Feld passt; mehrzeilig, wenn das Feld hoch genug ist."""
    breite, hoehe = rect.width - 6, rect.height - 2
    mehrzeilig = hoehe >= 15
    for groesse in (8, 7, 6.5, 6, 5.5, 5, 4.5, 4):
        if not mehrzeilig:
            if groesse <= hoehe * 0.85 and fitz.get_text_length(text, "helv", groesse) <= breite:
                return groesse, False, True
        elif len(umbrechen(text, groesse, breite)) * groesse * 1.4 <= hoehe:
            return groesse, True, True
    return 4, mehrzeilig, False


def fuelle(doc, werte):
    """werte: Feldname -> str (Text) oder True (Kreuz). Liefert Felder, deren Text nicht ganz passt."""
    offen = dict(werte)
    zu_lang = []
    for seite in doc:
        for w in seite.widgets():
            if w.field_name not in offen:
                continue
            wert = offen.pop(w.field_name)
            if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                if not wert:
                    continue  # leer lassen, sonst verschwindet der Kasten
                w.field_value = w.on_state()
            else:
                wert = str(wert)
                if not wert:
                    continue
                groesse, mehrzeilig, passt = passende_schrift(wert, w.rect)
                if mehrzeilig:
                    w.field_flags |= fitz.PDF_TX_FIELD_IS_MULTILINE
                if not passt:
                    zu_lang.append(w.field_name)
                w.text_font = "Helv"
                w.text_fontsize = groesse
                w.field_value = wert
            w.update()
    if offen:
        raise Fehler(f"Felder nicht im Formular gefunden: {', '.join(offen)}")
    return zu_lang


def werte_anlage(profil, fahrten, summe_km):
    name = profil["name"]
    if profil.get("amtsbezeichnung"):
        name += f" ({profil['amtsbezeichnung']})"
    werte = {
        "Name_Antragsteller": name,
        "Name_Schule": profil["schule_name_adresse"],
        "Adresse_Antragsteller": profil["wohnanschrift"],
    }
    for i, f in enumerate(fahrten):
        n = "" if i == 0 else str(i)
        anlass_text = f.dienstgeschaeft_in
        if f.anlass == "d":
            anlass_text = f"{f.notiz}: {anlass_text}"
        werte.update({
            f"Datum{n}": f"{f.datum:%d.%m.%y}",
            f"von_Uhrzeit{n}": f.unterricht_von,
            f"bis_Uhrzeit{i + 1}": f.unterricht_bis,
            f"Beginn_der_Fahrt_Wohnort{n}": f.beginn_in,
            f"Beginn_der_Fahrt_Uhrzeit{n}": f.abfahrt,
            f"Anlass_DR{n}": f.anlass,
            f"Seminarveranstaltung_in_Ort{n}": anlass_text,
            f"Seminar_von_Uhrzeit{n}": f.veranstaltung_von,
            f"Seminar_bis_Uhrzeit{n}": f.veranstaltung_bis,
            f"Ende_der_Fahrt_Wohnort{n}": f.ende_in,
            f"Ende_der_Fahrt_Uhrzeit{n}": f.ankunft,
            f"Strecke{n}": km_text(f.km) if f.verkehrsmittel != "oepnv" else "",
            f"Nutzung_Befoerderungsmittel{n}": f.verkehrsmittel == "fahrrad",
            f"Grund_Nutzung_Pkw{n}": f.grund,
            f"Begruendung{n}": f.begruendung,
            f"Oepnv_Parken{n}": bool(f.fahrkarte or f.sonstige),
        })
    werte["Summe_Strecke"] = km_text(summe_km)
    return werte


def daten_text(fahrten):
    """'02.09., 09.09., 16.09.2026' – kompakt für das Feld 'Grund der RKR'."""
    jahre = sorted({f.datum.year for f in fahrten})
    teile = []
    for jahr in jahre:
        tage = [f"{f.datum:%d.%m.}" for f in fahrten if f.datum.year == jahr]
        teile.append(", ".join(tage) + str(jahr))
    return "; ".join(teile)


def werte_antrag(profil, fahrten, anzahl_anlagen):
    iban = profil["iban"].replace(" ", "").upper()
    werte = {
        "Beschaeftigungsstelle": profil["beschaeftigungsstelle"],
        "Name__Vorname": profil["name"],
        "Kreditinstitut": profil["bic"],
        "Abrechnende_Dienststelle": profil["abrechnende_dienststelle"],
        "Wohnungsanschrift": "\n".join(x for x in (profil["wohnanschrift"], profil.get("telefon", ""),
                                                   profil.get("email", "")) if x),
    }
    for i, zeichen in enumerate(iban[:22], start=1):
        werte[f"IBAN{i}"] = zeichen

    daten = daten_text(fahrten)
    grund = f"AFR, Ausbildungsfahrten lt. Anlage 035_016: {daten}"
    if len(grund) <= 75:
        werte["Grund_der_RKR"] = grund
    else:
        werte["Grund_der_RKR"] = "AFR, Ausbildungsfahrten lt. Anlage 035_016 (Daten s. Anlage)"
        werte["Grund_der_RKR1"] = daten

    # Allgemeines
    bahncard = str(profil.get("bahncard", "nein")).lower().replace(" ", "")
    if bahncard not in BAHNCARD_FELD:
        raise Fehler(f"profil.json: bahncard '{bahncard}' unbekannt ({', '.join(BAHNCARD_FELD)})")
    werte[BAHNCARD_FELD[bahncard]] = True
    if bahncard != "nein":
        werte[BAHNCARD_JA] = True
    if profil.get("geschaeftskundenrabatt"):
        werte["OBJ29"] = True
    else:
        werte["OBJ30"] = True
        werte["Begruendung_nein"] = profil.get("begruendung_kein_geschaeftskundenrabatt", "")
    if profil.get("ermaessigungskarte"):
        werte["OBJ33"] = True
        werte["Strecke"] = profil["ermaessigungskarte"]
    else:
        werte["OBJ32"] = True
    for feld in IMMER_NEIN:
        werte[feld] = True

    # Reiseangaben stehen je Fahrt in der Anlage
    siehe = "siehe Anlage 035_016"
    werte.update({
        "Beginn_der_Dienstreise": siehe, "Beginn_des_Dienstgeschaefts": siehe,
        "Ende_des_Dienstgeschaefts": siehe, "Ende_der_Dienstreise": siehe,
        "Reiseziel_Reiseweg": f"{siehe} ({len(fahrten)} Fahrten, {anzahl_anlagen} Blatt)",
    })

    # Tagegeld
    tage = sum(1 for f in fahrten if f.tagegeld)
    if tage:
        werte["Tage"] = str(tage)
        werte["EUR"] = eur(TAGEGELD_EINTAEGIG)

    # Beförderungsmittel und Fahrtkosten
    mittel = {f.verkehrsmittel for f in fahrten}
    if "oepnv" in mittel:
        werte["OBJ4"] = True
    if any(f.verkehrsmittel == "pkw" and not f.grund for f in fahrten):
        werte["OBJ6"] = True
    if any(f.verkehrsmittel == "pkw" and f.grund for f in fahrten):
        werte["OBJ7"] = True
    if "fahrrad" in mittel:
        werte["OBJ8"] = True

    fahrkarte = sum(f.fahrkarte for f in fahrten)
    sonstige = sum(f.sonstige for f in fahrten)
    if fahrkarte:
        werte["Fahrkarte"] = eur(fahrkarte)
    if sonstige:
        werte["Sonstige_Fahrauslagen"] = eur(sonstige)

    # Wegstreckenentschädigung: je Satz eine Zeile (Formular hat zwei)
    gruppen = {}
    for f in fahrten:
        if f.satz:
            km, betrag = gruppen.get(f.satz, (0.0, 0.0))
            gruppen[f.satz] = (km + f.km, betrag + f.wegstrecke_eur)
    if len(gruppen) > 2:
        raise Fehler("Drei verschiedene km-Sätze (0,25 / 0,38 / 0,10) in einer Abrechnung – das Formular "
                     "hat nur zwei Zeilen. Bitte Fahrradfahrten getrennt abrechnen.")
    reihenfolge = [s for s in (SATZ_KLEIN, SATZ_GROSS, SATZ_FAHRRAD) if s in gruppen]
    for (feld_km, feld_satz, feld_eur), satz in zip(
            [("Tage3", "EUR3", "Wegstreckenentschaedigung"), ("Tage4", "EUR4", "Wegstreckenentschaedigung1")],
            reihenfolge):
        km, betrag = gruppen[satz]
        werte[feld_km] = km_text(km)
        werte[feld_satz] = eur(satz)
        werte[feld_eur] = eur(betrag)

    # Erläuterungen
    text = ["Reisen zum Zweck der Ausbildung (generell genehmigt, Anlage 1 Leitfaden Genehmigung von Dienstreisen).",
            f"Einzelaufstellung siehe Anlage 035_016 ({anzahl_anlagen} Blatt)."]
    if "OBJ7" in werte:
        text.append("Erhebliches dienstliches Interesse an der Pkw-Nutzung (§ 5 Abs. 3 NRKVO): Gründe G1–G5 "
                    "mit Begründung je Fahrt in der Anlage.")
    if any(f.gedeckelt for f in fahrten):
        text.append("Kleine Wegstreckenentschädigung je Reise auf 125 € begrenzt.")
    if "fahrrad" in mittel:
        text.append("Fahrrad: Wegstreckenentschädigung nach § 5 Abs. 5 NRKVO.")
    if fahrkarte or sonstige:
        text.append("Belege (Fahrkarten/Parkscheine) liegen bei.")
    werte["Erlaeuterungen"] = " ".join(text)
    return werte


def erzeuge_pdfs(profil, fahrten, ziel):
    ziel.mkdir(parents=True, exist_ok=True)
    blaetter = [fahrten[i:i + ZEILEN_JE_ANLAGE] for i in range(0, len(fahrten), ZEILEN_JE_ANLAGE)]
    dateien, zu_lang = [], []

    antrag = fitz.open(FORMULAR_ANTRAG)
    zu_lang += [f"Antrag: {n}" for n in fuelle(antrag, werte_antrag(profil, fahrten, len(blaetter)))]
    pfad = ziel / "Antrag_035_002.pdf"
    antrag.save(pfad)
    dateien.append(pfad)

    for nr, blatt in enumerate(blaetter, start=1):
        anlage = fitz.open(FORMULAR_ANLAGE)
        summe_km = sum(f.km for f in blatt if f.verkehrsmittel != "oepnv")
        zu_lang += [f"Anlage Blatt {nr}: {n}" for n in fuelle(anlage, werte_anlage(profil, blatt, summe_km))]
        pfad = ziel / f"Anlage_035_016_Blatt{nr}.pdf"
        anlage.save(pfad)
        dateien.append(pfad)

    # Eine flache Druckdatei (Formularfelder eingebrannt, damit gleichnamige Felder nicht kollidieren)
    druck = fitz.open()
    for pfad in dateien:
        teil = fitz.open(pfad)
        teil.bake()
        druck.insert_pdf(teil)
    druck_pfad = ziel / "Zum_Drucken_komplett.pdf"
    druck.save(druck_pfad)
    return dateien + [druck_pfad], zu_lang


# ---------------------------------------------------------------- Bericht

def bericht(fahrten, uebersprungen, dateien, zu_lang, ziel):
    zeilen = ["# Reisekostenabrechnung", "", f"Erstellt am {date.today():%d.%m.%Y}", "",
              "| Datum | Route | km | Mittel | Satz | Wegstrecke | Fahrkarte | Sonstiges | Tagegeld | Summe |",
              "|---|---|---:|---|---:|---:|---:|---:|---:|---:|"]
    for f in fahrten:
        zeilen.append(
            f"| {f.datum:%d.%m.%Y} | {' > '.join(f.stationen)} | {km_text(f.km)} | {f.verkehrsmittel}"
            f"{' ' + f.grund if f.grund else ''} | {eur(f.satz) if f.satz else '–'} | {eur(f.wegstrecke_eur)} | "
            f"{eur(f.fahrkarte)} | {eur(f.sonstige)} | {eur(f.tagegeld)} | **{eur(f.summe)}** |")
    gesamt = sum(f.summe for f in fahrten)
    zeilen += ["", f"**Voraussichtliche Erstattung: {eur(gesamt)} €** (die Festsetzung macht das RLSB)", ""]

    hinweise = [f"- {f.datum:%d.%m.%Y}: {h}" for f in fahrten for h in f.hinweise]
    hinweise += [f"- Text passt nicht ganz ins Feld, bitte kürzen: {n}" for n in zu_lang]
    if hinweise:
        zeilen += ["## Hinweise", ""] + hinweise + [""]
    if uebersprungen:
        zeilen += ["## Nicht aufgenommen", ""]
        zeilen += [f"- Zeile {f.zeile} ({f.datum:%d.%m.%Y}): {'; '.join(f.fehler)}" for f in uebersprungen] + [""]

    zeilen += ["## Vor dem Einreichen", "",
               "- [ ] PDFs gegenlesen (Uhrzeiten, km, Begründungen)",
               "- [ ] Antrag Seite 2 unterschreiben (Unterschrift, Amtsbezeichnung, Datum)"]
    if any(f.fahrkarte or f.sonstige for f in fahrten):
        zeilen.append("- [ ] Belege beifügen")
    zeilen += ["- [ ] Beim Studienseminar einreichen (Eingangsstempel wahrt die 6-Monats-Frist)",
               "- [ ] Danach: `python werkzeug/fahrtkosten.py --markieren` mit denselben Optionen", "",
               "## Dateien", ""] + [f"- {p.name}" for p in dateien]
    pfad = ziel / "Zusammenfassung.md"
    pfad.write_text("\n".join(zeilen), encoding="utf-8")
    return pfad, gesamt


def markiere(datei, nummern, stempel):
    with open(datei, encoding="utf-8-sig", newline="") as f:
        leser = csv.DictReader(f, delimiter=";")
        spalten = leser.fieldnames
        zeilen = list(leser)
    for nr in nummern:
        zeilen[nr]["abgerechnet_am"] = stempel
    with open(datei, "w", encoding="utf-8-sig", newline="") as f:
        schreiber = csv.DictWriter(f, fieldnames=spalten, delimiter=";")
        schreiber.writeheader()
        schreiber.writerows(zeilen)


# ---------------------------------------------------------------- Hauptprogramm

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Reisekostenabrechnung Vorbereitungsdienst (035_002 + 035_016)")
    p.add_argument("--daten", default=str(BASIS / "daten"), help="Ordner mit profil.json, orte.json, fahrten.csv")
    p.add_argument("--von", help="erste Fahrt (TT.MM.JJJJ)")
    p.add_argument("--bis", help="letzte Fahrt (TT.MM.JJJJ)")
    p.add_argument("--alle", action="store_true", help="auch bereits abgerechnete Fahrten aufnehmen")
    p.add_argument("--nur-pruefen", action="store_true", help="nur prüfen, keine PDFs erzeugen")
    p.add_argument("--markieren", action="store_true", help="aufgenommene Fahrten in fahrten.csv als abgerechnet vermerken")
    p.add_argument("--heute", help=argparse.SUPPRESS)
    args = p.parse_args()

    ordner = Path(args.daten)
    heute = lies_datum(args.heute) if args.heute else date.today()
    von = lies_datum(args.von) if args.von else date.min
    bis = lies_datum(args.bis) if args.bis else date.max

    try:
        profil, orte, zeilen = lade_daten(ordner)
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"Fehler beim Einlesen von {ordner}: {e}")
    offen = [k for k, v in {**profil, **orte["orte"]}.items() if PLATZHALTER in json.dumps(v, ensure_ascii=False)]
    if offen:
        sys.exit(f"Noch nicht eingerichtet – Platzhalter '{PLATZHALTER}' in profil.json/orte.json: {', '.join(offen)}")

    fahrten, uebersprungen, nummern = [], [], []
    for i, z in enumerate(zeilen):
        if not any((v or "").strip() for v in z.values()):
            continue
        if (z.get("abgerechnet_am") or "").strip() and not args.alle:
            continue
        try:
            f = baue_fahrt(i + 2, z, profil)  # +2: Kopfzeile, Excel zählt ab 1
        except Fehler as e:
            print(f"Zeile {i + 2}: {e}")
            continue
        if not von <= f.datum <= bis:
            continue
        berechne(f, orte, heute)
        if f.fehler:
            uebersprungen.append(f)
        else:
            fahrten.append(f)
            nummern.append(i)

    fahrten.sort(key=lambda f: (f.datum, f.abfahrt))
    print(f"{len(fahrten)} Fahrt(en) abrechenbar, {len(uebersprungen)} nicht aufgenommen.")
    for f in uebersprungen:
        print(f"  ✗ Zeile {f.zeile} ({f.datum:%d.%m.%Y}): {'; '.join(f.fehler)}")
    for f in fahrten:
        merk = f"  [{'; '.join(f.hinweise)}]" if f.hinweise else ""
        print(f"  ✓ {f.datum:%d.%m.%Y}  {km_text(f.km):>5} km  {f.verkehrsmittel:7} {eur(f.summe):>8} €{merk}")

    if args.nur_pruefen or not fahrten:
        return

    ziel = BASIS / "ausgabe" / f"{date.today():%Y-%m-%d}_{fahrten[0].datum:%d.%m}-{fahrten[-1].datum:%d.%m.%Y}"
    try:
        dateien, zu_lang = erzeuge_pdfs(profil, fahrten, ziel)
    except Fehler as e:
        sys.exit(f"Fehler: {e}")
    bericht_pfad, gesamt = bericht(fahrten, uebersprungen, dateien, zu_lang, ziel)
    for n in zu_lang:
        print(f"  ! Text zu lang, bitte kürzen: {n}")
    print(f"\nVoraussichtliche Erstattung: {eur(gesamt)} €")
    print(f"Ausgabe: {ziel}")
    for d in dateien + [bericht_pfad]:
        print(f"  - {d.name}")

    if args.markieren:
        markiere(ordner / "fahrten.csv", nummern, f"{date.today():%d.%m.%Y}")
        print(f"{len(nummern)} Fahrt(en) in fahrten.csv als abgerechnet markiert.")


if __name__ == "__main__":
    main()
