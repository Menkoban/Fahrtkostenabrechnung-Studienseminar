# Fahrtkosten Planer Studienseminar BBS OS

Füllt die Formulare **035_002** (Antrag auf Reisekostenvergütung) und **035_016** (Anlage für
Studienseminare) automatisch aus – nach dem Leitfaden des RLSB, Stand 01.01.2025.

## App (Handy und PC)

Alle Wege mit demselben Stand (Version 3.4). Auf dem Home-Bildschirm heißt die App kurz „Fahrtkosten“.
Logo „Fahrschein“: Quelle in `android/symbol.js` (`node android/symbol.js` erzeugt alle Symbolgrößen und `app/symbol.png`).

| Datei | Für | Daten liegen |
|---|---|---|
| **https://menkoban.github.io/Fahrtkostenabrechnung-Studienseminar/** | Webseite mit App, APK und Anleitung. iPhone/iPad: in Safari „App öffnen“ → Teilen → „Zum Home-Bildschirm“, läuft danach offline | im Browser auf dem Gerät |
| `Fahrtkosten.apk` | Android 10+, offline, keine Berechtigungen. PDFs landen in `Download/Fahrtkosten` | in der App auf dem Handy |
| `Fahrtkosten-App.html` | PC (Doppelklick, läuft im Browser) und – unter einer Webadresse – iPhone/iPad über „Zum Home-Bildschirm“ | im Browser auf dem Gerät |
| **https://claude.ai/artifact/Kvtvj73rsH6MEmVpN4TV5r** | eigene Nutzung mit Claude-Konto | im Claude-Konto, auf allen Geräten gleich |

`Anleitung_Fahrtkosten-App.pdf` (eine Seite, mit QR-Code zur Webseite) erklärt Installation und Bedienung für Referendarinnen und Referendare
(Quelle: `docs/anleitung.html`, PDF neu erzeugen mit `node docs/anleitung-pdf.js`).

- `Fahrtkosten-App.html` und die APK sind **vollständig offline**: pdf-lib, pdf.js und die Formulare sind eingebettet,
  es gibt keine Webschriften und keine Verbindung zu Google oder anderen Servern. Nur die claude.ai-Version lädt
  Bibliotheken und Schriften vom CDN.
- Tagesfahrten landen in einem Antrag 035_002 mit Anlage 035_016. Jede mehrtägige Reise (z. B. Kompaktseminar) bekommt einen
  eigenen Antrag mit Tagegeld (14 € An-/Abreisetag, 28 € voller Tag), Übernachtung (20 € pauschal oder Hotel lt. Rechnung)
  und gestellten Mahlzeiten. Nach dem Erstellen zeigt die App eine Vorschau aller Seiten; jedes Teil lässt sich einzeln speichern.
- Weitere Funktionen: Tagegeld automatisch ab mehr als 8 Std. oder per Knopf, Mitfahrt und Fahrgemeinschaft (G4),
  Erkennung fehlender Rückfahrt, Strecke wahlweise ab Wohnung oder kürzer ab Ausbildungsschule (Nr. 2.1.5 VV-NRKVO,
  mit Häkchen „Einführungswoche“), Warnung bei doppelten Tagen und Überschneidungen, Pkw + G-Grund + Fahrrad in einem
  Antrag (Fahrrad dann unter „sonstige Kosten“), lange Schuladressen werden für Spalte 5b lesbar gekürzt,
  automatisches Speichern und Sicherungen auf dem Gerät.
- Das Python-Skript kennt nur Tagesfahrten. App und Python-Skript teilen keine Daten. Nimm eins von beiden.

### Webseite (GitHub Pages)

`.github/workflows/webseite.yml` baut bei jedem Push auf `main` mit `python app/build.py` die Seite aus `app/dist/web/`
und veröffentlicht sie. Quellen: `web/index.html` (Startseite), `web/sw.js` (Offline-Betrieb), `web/manifest.webmanifest`,
Symbole aus `node android/symbol.js`. APK, HTML und Anleitung kommen aus dem Repo, deshalb vor dem Push neu bauen.
Einmalig nötig: Repo öffentlich und unter Settings → Pages als Source „GitHub Actions“ wählen.
Die Seite ist für Suchmaschinen gesperrt (`noindex`) und nur über den geteilten Link gedacht. Das Impressum
(`web/impressum.html`) füllt `app/build.py` aus `IMPRESSUM_NAME` und `IMPRESSUM_ANSCHRIFT`; ohne Namen bricht der Bau ab.

### Ändern, testen, bauen

Quellcode: `app/app.html` (Oberfläche), `app/kern.js` (Regeln und PDF-Ausfüllung). Versionsnummer: `VERSION` in `app/build.py`.

```
python app/build.py          # Fahrtkosten-App.html (offline) und app/dist/fahrtkosten-artifact.html (claude.ai)
node --test tests/           # Regeltests für kern.js inkl. PDF-Erzeugung
node tests/app.e2e.js        # Durchklick-Test der fertigen HTML im Browser (Playwright/Chromium)
node tests/web.e2e.js        # Webseite im iPhone-Format: Startseite, Downloads, offline nach dem ersten Laden
python android/build.py      # Fahrtkosten.apk
```

Danach `app/dist/fahrtkosten-artifact.html` unter dem Link oben neu veröffentlichen.

**Android-Build** braucht JDK 17 (mit JDK 21 stürzt d8 ab) und das Android SDK mit build-tools 34.0.0 und platforms/android-34.
Unter Windows liegen die Werkzeuge in `C:\Users\User\android-build`, sonst gelten `JAVA_HOME` und `ANDROID_HOME`
(Standard `/opt/android/sdk`). In der Cloud-Sitzung:

```
curl -sSLo /tmp/cmd.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q /tmp/cmd.zip -d /opt/android/sdk/cmdline-tools && mv /opt/android/sdk/cmdline-tools/cmdline-tools /opt/android/sdk/cmdline-tools/latest
yes | /opt/android/sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/opt/android/sdk "build-tools;34.0.0" "platforms;android-34"
curl -sSL https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse | tar xz -C /opt/android && mv /opt/android/jdk-17* /opt/android/jdk17
JAVA_HOME=/opt/android/jdk17 FAHRTKOSTEN_SIGNATUR=/pfad/zur/signatur python3 android/build.py
```

**Signaturschlüssel:** `fahrtkosten.keystore` + `passwort.txt`, Ordner `android/signatur/` oder `FAHRTKOSTEN_SIGNATUR`.
Er liegt **nicht** im Repo. Ab Version 3.0 (in der Cloud gebaut) gilt ein neuer Schlüssel
(SHA-256 des Zertifikats `763baa59…edad4`). Für jedes Update denselben Schlüssel verwenden, sonst lässt sich die APK
nicht über die installierte App spielen. Fehlt der Ordner, legt der Build einen neuen Schlüssel an.

## Repository

Öffentliches GitHub-Repo (für die Webseite über GitHub Pages). Bewusst **nicht** enthalten (siehe `.gitignore`):

- `daten/` und `ausgabe/`: persönliche Angaben (IBAN, Adresse) und erzeugte Abrechnungen. Vorlagen liegen in `beispiel/`.
- `android/signatur/`: der Signaturschlüssel der APK. Nur sicher außerhalb des Repos aufbewahren (z. B. OneDrive).
  Ohne ihn lassen sich Updates nicht über die installierte App spielen.
- Zwischenergebnisse (`app/dist/`, `android/build/`) und die gespeicherten Leitfaden-Dokumente.

`Fahrtkosten-App.html`, `Fahrtkosten.apk` und `Anleitung_Fahrtkosten-App.pdf` sind enthalten, damit sie direkt
heruntergeladen werden können und die Webseite sie ausliefert.

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
| `app/`, `android/` | Quellcode der App und der Android-Hülle |
| `tests/` | Regeltests (`node --test tests/`), Browser-Durchklick (`node tests/app.e2e.js`), Webseite (`node tests/web.e2e.js`) |
| `web/`, `.github/workflows/` | Webseite für GitHub Pages |
| `docs/` | Anleitung (HTML-Quelle und PDF-Erzeugung) |
| `ausgabe/` | erzeugte Abrechnungen |
| `.claude/skills/fahrtkosten/` | der Claude-Befehl `/fahrtkosten` |
