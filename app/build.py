"""Baut app/app.html, app/kern.js und die beiden Formular-PDFs zu einer einzigen Datei zusammen.

    python app/build.py

Ergebnis:
  Fahrtkosten-App.html              eigenständig: läuft offline im Browser (PC, Handy) und ist die Grundlage
                                    der Android-App. Alle Bibliotheken sind eingebettet, keine Verbindung zu
                                    Google oder anderen Servern.
  app/dist/fahrtkosten-artifact.html  für claude.ai: nur der Seiteninhalt, Bibliotheken und Schriften vom CDN
  app/dist/web/                     die Webseite (GitHub Pages): Startseite, App mit Manifest und Service Worker
                                    (offline, „Zum Home-Bildschirm“ auf iPhone/Android), APK und Anleitung
"""

import base64
import re
import shutil
from pathlib import Path

BASIS = Path(__file__).resolve().parent.parent
APP = BASIS / "app"
BIBLIOTHEKEN = BASIS / "android" / "bibliotheken"
PDF_LIB_CDN = '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>'
VERSION = "3.4"
NAME = "Fahrtkosten Planer Studienseminar BBS OS"
KURZNAME = "Fahrtkosten"   # unter dem Symbol auf dem Home-Bildschirm (dort passen nur etwa 11 Zeichen)
# Impressum der Webseite (§ 18 Abs. 1 Medienstaatsvertrag: Name und Anschrift)
IMPRESSUM_NAME = "Andre Menke"   # ohne Namen bricht der Bau der Webseite ab
IMPRESSUM_ANSCHRIFT = ["Sachsenring 9", "49733 Haren (Ems)"]


def bibliothek(name):
    text = (BIBLIOTHEKEN / name).read_text(encoding="utf-8")
    # Darf den umgebenden <script>-Block nicht vorzeitig beenden
    if re.search(r"</script|<!--", text, re.IGNORECASE):
        raise SystemExit(f"{name} enthält </script> oder <!-- und kann nicht eingebettet werden")
    return text


def main():
    html = (APP / "app.html").read_text(encoding="utf-8")
    teile = {
        "/*KERN*/": (APP / "kern.js").read_text(encoding="utf-8"),
        "/*PDF_ANTRAG*/": base64.b64encode((BASIS / "Reisekosten_Antrag_035_002.pdf").read_bytes()).decode(),
        "/*PDF_ANLAGE*/": base64.b64encode((BASIS / "Reisekosten_Anlage.pdf").read_bytes()).decode(),
        "/*VERSION*/": VERSION,
        "/*SYMBOL*/": base64.b64encode((APP / "symbol.png").read_bytes()).decode(),
    }
    for marke, inhalt in teile.items():
        if html.count(marke) != 1:
            raise SystemExit(f"Marke {marke} nicht genau einmal in app.html")
        html = html.replace(marke, inhalt)

    # Für claude.ai: nur der Seiteninhalt (das Gerüst ergänzt die Plattform beim Veröffentlichen)
    artifact = APP / "dist" / "fahrtkosten-artifact.html"
    artifact.parent.mkdir(exist_ok=True)
    artifact.write_text(html, encoding="utf-8")

    # Eigenständige Datei: keine Webschriften (Datenschutz, offline), Bibliotheken eingebettet
    offline = re.sub(r'<link rel="(preconnect|stylesheet)" href="https://fonts\.[^"]*"[^>]*>\s*', "", html)
    if PDF_LIB_CDN not in offline:
        raise SystemExit("pdf-lib-Einbindung in app.html nicht gefunden")
    offline = offline.replace(PDF_LIB_CDN, "<script>" + bibliothek("pdf-lib.min.js") + "</script>")
    # pdf.js nur für die Vorschau: als Text abgelegt, die App lädt es erst bei Bedarf
    offline += ('\n<script type="text/plain" id="lib-pdfjs">' + bibliothek("pdf.min.js") + "</script>"
                '\n<script type="text/plain" id="lib-pdfjs-worker">' + bibliothek("pdf.worker.min.js") + "</script>")
    if "cdnjs.cloudflare.com/ajax/libs/pdf-lib" in offline or "fonts.googleapis" in offline:
        raise SystemExit("Offline-Version verweist noch auf einen Server")

    symbol = f"data:image/png;base64,{teile['/*SYMBOL*/']}"
    ziel = BASIS / "Fahrtkosten-App.html"
    ziel.write_text(seite(offline, symbol, symbol), encoding="utf-8")
    web = webseite(offline)
    for datei in (ziel, artifact, web / "app.html"):
        print(f"{datei.relative_to(BASIS)}: {datei.stat().st_size / 1024:.0f} KB")


def seite(inhalt, icon, apple_icon, kopf_extra=""):
    """Vollständige HTML-Seite um den App-Inhalt."""
    return ('<!doctype html><html lang="de"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<meta name="theme-color" content="#373736">'
            # iPhone/iPad: „Zum Home-Bildschirm“ zeigt die App dann ohne Browserleiste und mit eigenem Symbol
            '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
            f'<meta name="apple-mobile-web-app-title" content="{KURZNAME}"><meta name="application-name" content="{NAME}">'
            '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
            f'<link rel="icon" type="image/png" href="{icon}"><link rel="apple-touch-icon" href="{apple_icon}">'
            + kopf_extra +
            '<style>body{margin:0}[hidden]{display:none!important}</style></head><body>'
            + inhalt + "</body></html>")


def webseite(offline):
    """app/dist/web: was GitHub Pages ausliefert (.github/workflows/webseite.yml)."""
    ziel = APP / "dist" / "web"
    if ziel.exists():
        shutil.rmtree(ziel)
    ziel.mkdir(parents=True)
    if not IMPRESSUM_NAME.strip():
        raise SystemExit("IMPRESSUM_NAME in app/build.py fehlt – ohne Impressum wird die Webseite nicht gebaut")
    ersetzen = {"/*VERSION*/": VERSION, "/*NAME*/": NAME, "/*KURZNAME*/": KURZNAME,
                "/*IMPRESSUM*/": "<br>".join([IMPRESSUM_NAME, *IMPRESSUM_ANSCHRIFT])}
    for datei in ("index.html", "impressum.html", "sw.js", "manifest.webmanifest"):
        text = (BASIS / "web" / datei).read_text(encoding="utf-8")
        for marke, wert in ersetzen.items():
            text = text.replace(marke, wert)
        (ziel / datei).write_text(text, encoding="utf-8")
    for datei in ("symbol-512.png", "apple-touch-icon.png"):
        shutil.copy(BASIS / "web" / datei, ziel / datei)
    # iOS nimmt für den Home-Bildschirm kein data:-Bild, deshalb hier echte Dateien; das Manifest schaltet den Offline-Betrieb ein
    (ziel / "app.html").write_text(seite(offline, "symbol-512.png", "apple-touch-icon.png",
                                         '<link rel="manifest" href="manifest.webmanifest"><meta name="robots" content="noindex, nofollow">'),
                                    encoding="utf-8")
    # Downloads: dieselben Dateien wie im Repo
    for datei in ("Fahrtkosten-App.html", "Fahrtkosten.apk", "Anleitung_Fahrtkosten-App.pdf", "Kurzanleitung_Fahrtkosten-App.pdf"):
        if (BASIS / datei).exists():
            shutil.copy(BASIS / datei, ziel / datei)
    return ziel


if __name__ == "__main__":
    main()
