# Fahrtkostenabrechnung Vorbereitungsdienst

Füllt die Formulare **035_002** (Antrag auf Reisekostenvergütung) und **035_016** (Anlage für
Studienseminare) automatisch aus – nach dem Leitfaden des RLSB, Stand 01.01.2025.

## App (Handy und PC)

**https://claude.ai/artifact/Kvtvj73rsH6MEmVpN4TV5r**: privat, nur mit deinem Claude-Konto zu öffnen.
Fahrten, Orte und Angaben liegen in deinem Konto und sind auf allen Geräten gleich. Die PDFs entstehen im Browser.

- Tagesfahrten landen in einem Antrag 035_002 mit Anlage 035_016. Jede mehrtägige Reise (z. B. Kompaktseminar) bekommt einen
  eigenen Antrag mit Tagegeld (14 € An-/Abreisetag, 28 € voller Tag), Übernachtung (20 € pauschal oder Hotel lt. Rechnung)
  und gestellten Mahlzeiten. Nach dem Erstellen zeigt die App eine Vorschau aller Seiten; jedes Teil lässt sich einzeln speichern.
- Weitere Funktionen: Tagegeld automatisch ab mehr als 8 Std. oder per Knopf, Mitfahrt und Fahrgemeinschaft (G4),
  Erkennung fehlender Rückfahrt, Strecke wahlweise ab Wohnung oder kürzer ab Ausbildungsschule (Nr. 2.1.5 VV-NRKVO,
  mit Häkchen „Einführungswoche“), Warnung bei doppelten Tagen und Überschneidungen, Pkw + G-Grund + Fahrrad in einem
  Antrag (Fahrrad dann unter „sonstige Kosten“), automatisches Speichern und Sicherungen auf dem Gerät.
- Das Python-Skript kennt nur Tagesfahrten.
- **Android-App:** `Fahrtkosten.apk` (Android 10+, läuft offline, PDFs landen in `Download/Fahrtkosten`).
  Neu bauen: `python app/build.py`, dann `python android/build.py`. Werkzeuge liegen in `C:\Users\User\android-build`.
  Der Signaturschlüssel in `android/signatur/` muss erhalten bleiben, sonst lassen sich Updates nicht über die alte App installieren.
- Ohne Claude-Konto geht auch `Fahrtkosten-App.html` direkt im Browser. Die Daten bleiben dann nur in diesem Browser.
- Quellcode: `app/app.html` (Oberfläche), `app/kern.js` (Regeln und PDF-Ausfüllung, gleiche Regeln wie das Python-Skript).
  Nach Änderungen `python app/build.py` ausführen und `app/dist/fahrtkosten-artifact.html` neu veröffentlichen.
- App und Python-Skript teilen keine Daten. Nimm eins von beiden.

## Repository

Privates GitHub-Repo. Bewusst **nicht** enthalten (siehe `.gitignore`):

- `daten/` und `ausgabe/`: persönliche Angaben (IBAN, Adresse) und erzeugte Abrechnungen. Vorlagen liegen in `beispiel/`.
- `android/signatur/`: der Signaturschlüssel der APK. Nur lokal aufbewahren (liegt im OneDrive-Ordner). Ohne ihn lassen
  sich Updates nicht über die installierte App spielen.
- Build-Ergebnisse (`Fahrtkosten.apk`, `app/dist/`, `android/build/`) und die gespeicherten Leitfaden-Dokumente.

`Fahrtkosten-App.html` ist enthalten, damit die App direkt aus dem Repo heruntergeladen werden kann.

## Python-Skript und Claude-Befehl

**Am einfachsten:** In Claude Code in diesem Ordner `/fahrtkosten` aufrufen oder einfach sagen
„trag die Seminarfahrt von heute ein“ bzw. „mach die Abrechnung für September“.

**Von Hand:**

1. Einmalig `daten/profil.json` und `daten/orte.json` ausfüllen (alle `BITTE AUSFÜLLEN` ersetzen,
   km je Teilstrecke laut Google Maps eintragen).
2. Fahrten in `daten/fahrten.csv` eintragen (öffnet sich in Excel; eine Zeile pro Reisetag).
3. Prüfen: `python werkzeug/fahrtkosten.py --nur-pruefen`
4. Erzeugen: `python werkzeug/fahrtkosten.py` (optional `--von 01.09.2026 --bis 30.09.2026`)
5. `ausgabe/…/Zum_Drucken_komplett.pdf` gegenlesen, ausdrucken, unterschreiben, Belege beilegen,
   beim Studienseminar einreichen.
6. Danach dasselbe Kommando mit `--markieren`, damit die Fahrten als abgerechnet gelten.

Ein durchgerechnetes Beispiel liegt in `beispiel/` (Daten) und `ausgabe/BEISPIEL_Max_Mustermann/` (Ergebnis).
Selbst nachvollziehen: `python werkzeug/fahrtkosten.py --daten beispiel`

## Was das Skript automatisch erledigt

- **Abrechenbare Strecke:** Wohnung ↔ Ausbildungsschule wird nie gezählt (Leitfaden, Beispiele 3, 5, 6).
  Beginnt die Fahrt nach dem Unterricht an der Schule, steht „Dienstort“ als Beginn in der Anlage.
- **Sätze:** 0,25 €/km (max. 125 € je Reise), 0,38 €/km mit Grund G1–G5 und Begründung, Fahrrad 0,10 €/km,
  Fahrkarten und Parkkosten nach Beleg, Tagegeld 14 € ab mehr als 8 Stunden Abwesenheit.
- **Prüfungen:** 6-Monats-Ausschlussfrist, Grund ohne Begründung, fehlende Uhrzeiten oder Entfernungen,
  Daten in der Zukunft, Texte, die nicht ins Feld passen.
- **Mehr als 15 Fahrten:** Es werden automatisch weitere Anlage-Blätter angelegt.

## Grenzen des Prototyps

- Keine mehrtägigen Reisen, Übernachtungen (Kompaktseminar) und Auslandsreisen – die von Hand ergänzen.
- Höchstens zwei verschiedene km-Sätze pro Antrag, weil das Formular nur zwei Zeilen hat.
- Das Kästchen „Anlage(n) (035_003)“ im Antrag bleibt leer, weil die Anlage für Studienseminare 035_016 heißt.
  Im Feld „Erläuterungen“ steht stattdessen, dass die Anlage 035_016 beiliegt.
- Die Sätze stehen oben in `werkzeug/fahrtkosten.py`. Ändert sich die NRKVO, müssen sie dort angepasst werden.

## Datenschutz

`daten/profil.json` enthält deine IBAN und liegt in OneDrive. Gib den Ordner nicht weiter, ohne vorher
`daten/` herauszunehmen.

## Ordner

| Pfad | Inhalt |
|---|---|
| `Reisekosten_Antrag_035_002.pdf`, `Reisekosten_Anlage.pdf` | leere Originalformulare (nicht verändern, das Skript nutzt sie als Vorlage) |
| `werkzeug/fahrtkosten.py` | das Skript (benötigt Python mit PyMuPDF: `pip install pymupdf`) |
| `daten/` | deine Angaben und Fahrten |
| `beispiel/` | Beispieldaten |
| `ausgabe/` | erzeugte Abrechnungen |
| `.claude/skills/fahrtkosten/` | der Claude-Befehl `/fahrtkosten` |
