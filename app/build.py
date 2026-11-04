"""Baut app/app.html, app/kern.js und die beiden Formular-PDFs zu einer einzigen Datei zusammen.

    python app/build.py

Ergebnis:
  Fahrtkosten-App.html              eigenständig: läuft offline im Browser (PC, Handy) und ist die Grundlage
                                    der Android-App. Alle Bibliotheken sind eingebettet, keine Verbindung zu
                                    Google oder anderen Servern.
  app/dist/fahrtkosten-artifact.html  für claude.ai: nur der Seiteninhalt, Bibliotheken und Schriften vom CDN
"""

import base64
import re
from pathlib import Path

BASIS = Path(__file__).resolve().parent.parent
APP = BASIS / "app"
BIBLIOTHEKEN = BASIS / "android" / "bibliotheken"
PDF_LIB_CDN = '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>'
VERSION = "3.1"
NAME = "Fahrtkosten Planer Studienseminar BBS OS"
KURZNAME = "Fahrtkosten"   # unter dem Symbol auf dem Home-Bildschirm (dort passen nur etwa 11 Zeichen)


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

    symbol = teile["/*SYMBOL*/"]
    ziel = BASIS / "Fahrtkosten-App.html"
    ziel.write_text(
        '<!doctype html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="theme-color" content="#373736">'
        # iPhone/iPad: „Zum Home-Bildschirm“ zeigt die App dann ohne Browserleiste und mit eigenem Symbol
        '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
        f'<meta name="apple-mobile-web-app-title" content="{KURZNAME}"><meta name="application-name" content="{NAME}">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
        f'<link rel="icon" type="image/png" href="data:image/png;base64,{symbol}">'
        f'<link rel="apple-touch-icon" href="data:image/png;base64,{symbol}">'
        '<style>body{margin:0}[hidden]{display:none!important}</style></head><body>'
        + offline + "</body></html>", encoding="utf-8")
    for datei in (ziel, artifact):
        print(f"{datei.relative_to(BASIS)}: {datei.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
