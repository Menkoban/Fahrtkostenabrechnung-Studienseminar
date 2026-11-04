---
name: fahrtkosten
description: Reisekostenabrechnung im Vorbereitungsdienst (Niedersachsen, RLSB) – erfasst Seminar- und Ausbildungsfahrten in daten/fahrten.csv und erzeugt mit werkzeug/fahrtkosten.py die ausgefüllten Formulare 035_002 (Antrag) und 035_016 (Anlage Studienseminare). Verwenden, wenn der Nutzer Fahrten eintragen, Fahrtkosten/Reisekosten abrechnen, den Antrag erstellen, Seminartermine aus dem Kalender übernehmen oder abgerechnete Fahrten abhaken will – z. B. „/fahrtkosten“, „trag die Fahrt von heute ein“, „mach die Abrechnung für September“.
---

# Fahrtkosten abrechnen

Arbeitsordner ist der Projektordner `Fahrkostenabrechnung`. Alle Regeln stehen im Skript
`werkzeug/fahrtkosten.py` (Konstanten oben) – nicht selbst nachrechnen, sondern das Skript laufen lassen.

**Wichtig:** Die Hauptversion ist inzwischen die App (`app/kern.js` + `app/app.html`, gebaut mit `python app/build.py`
zu `Fahrtkosten-App.html`, Online-Version und APK). Nur die App kann mehrtägige Reisen, Mitfahrt/Fahrgemeinschaft,
Tagegeld-Knopf, Strecke ab Ausbildungsschule (Nr. 2.1.5 VV-NRKVO) mit Einführungswoche und Doppel-Warnungen.
Das Python-Skript rechnet nur Tagesfahrten. Bittet der Nutzer um Änderungen an der Abrechnung, die App ändern,
neu bauen und alle drei Versionen aktualisieren (README, Abschnitt „App“).

## 0. Einrichtung prüfen

Steht in `daten/profil.json` oder `daten/orte.json` noch `BITTE AUSFÜLLEN`, zuerst einrichten:

- Profil im Gespräch abfragen (Name, Amtsbezeichnung, Adresse, IBAN, BIC, Schule mit Schul-Nr.,
  abrechnende Dienststelle, BahnCard, Ermäßigungskarte/Deutschlandticket, Standard-Verkehrsmittel).
  IBAN/BIC nur vom Nutzer übernehmen, nie raten.
- Orte anlegen: Wohnung (`wohnung`), Ausbildungsschule (`ausbildungsschule`), Studienseminar (`seminar`),
  weitere Veranstaltungsorte (`sonstiges`). Der Schlüssel (z. B. `Seminar`) ist der Kurzname für Routen.
- Entfernungen je Teilstrecke **einfache Richtung**, verkehrsübliche (kürzeste) Strecke **laut Google Maps**.
  Der Nutzer liefert die km; auf Wunsch im Browser bei Google Maps nachschlagen und vom Nutzer bestätigen lassen.

## 1. Fahrten erfassen

Eine Zeile pro Reisetag in `daten/fahrten.csv` (Semikolon, Datum TT.MM.JJJJ, Zeiten HH:MM):

| Spalte | Inhalt |
|---|---|
| `route` | Stationen mit `>`: `Wohnung > Schule > Seminar > Wohnung`. Wohnung↔Ausbildungsschule zählt das Skript automatisch nicht mit. |
| `unterricht_von/bis` | eigene Unterrichtsverpflichtung an dem Tag (sonst leer) |
| `abfahrt` / `ankunft` | Beginn/Ende der abrechenbaren Fahrt (bei Start an der Schule: Abfahrt an der Schule) |
| `anlass` | `a` Seminarveranstaltung, `d` sonstiger Anlass (dann Beschreibung in `notiz`) |
| `veranstaltung_von/bis` | Zeiten der Veranstaltung |
| `verkehrsmittel` | `pkw` (Standard aus Profil), `oepnv`, `fahrrad` |
| `grund` + `begruendung` | nur Pkw: G1–G5 für 0,38 €/km, Begründung **konkret für diese Fahrt** |
| `fahrkarte_eur`, `sonstige_eur` | Ticketpreis bzw. Parkkosten (Beleg nötig) |
| `abgerechnet_am` | leer lassen – setzt das Skript |

Quellen für Fahrten:
- **Aussage des Nutzers** („heute Seminar 14–17 Uhr, vorher Unterricht bis 12:15“) → Zeile ableiten.
- **Google Kalender** (falls verbunden): Termine im Zeitraum nach Seminar/Studienseminar/Fachseminar
  durchsuchen, als Tabelle vorschlagen, **erst nach Bestätigung** eintragen. Fehlende Abfahrts-/Ankunftszeiten erfragen.

Pkw-Gründe: Bei Unterricht und Seminar am selben Tag G2 **vorschlagen**, mit Begründung aus den echten
Zeiten (z. B. „Unterricht bis 12:15, Seminar ab 14:00; mit ÖPNV nicht rechtzeitig erreichbar“).
Keine Gründe erfinden – der Nutzer versichert die Richtigkeit mit seiner Unterschrift.

## 2. Prüfen und erzeugen

```
python werkzeug/fahrtkosten.py --nur-pruefen [--von TT.MM.JJJJ --bis TT.MM.JJJJ]
python werkzeug/fahrtkosten.py [--von ... --bis ...]
```

- Ohne `--von/--bis` werden alle noch nicht abgerechneten Fahrten genommen.
- Mit ✗ markierte Zeilen (Fehler) mit dem Nutzer klären und korrigieren, Hinweise (Frist, Belege, G2) weitergeben.
- Ergebnis liegt in `ausgabe/<Datum>_<Zeitraum>/`: `Zum_Drucken_komplett.pdf` (flach, zum Drucken),
  die editierbaren Einzel-PDFs und `Zusammenfassung.md`. Die Druck-PDF dem Nutzer zeigen/schicken und
  die Checkliste aus der Zusammenfassung nennen (gegenlesen, unterschreiben, Belege, beim Seminar einreichen).

## 3. Abhaken

Erst wenn der Nutzer bestätigt, dass er eingereicht hat: dasselbe Kommando mit `--markieren` ausführen.
Dann tauchen die Fahrten in künftigen Abrechnungen nicht mehr auf.

## Grenzen

Nicht abgedeckt: mehrtägige Reisen/Kompaktseminare mit Übernachtung, Auslandsreisen, Tagegeld über
mehrere Tage, mehr als zwei km-Sätze in einem Antrag (Fahrradfahrten dann getrennt abrechnen).
In diesen Fällen den Nutzer darauf hinweisen und die Formulare entsprechend von Hand ergänzen lassen.
