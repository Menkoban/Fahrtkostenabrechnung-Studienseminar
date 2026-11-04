"""Baut app/app.html, app/kern.js und die beiden Formular-PDFs zu einer einzigen Datei zusammen.

    python app/build.py   ->   Fahrtkosten-App.html (läuft im Browser und als claude.ai-Artifact)
"""

import base64
from pathlib import Path

BASIS = Path(__file__).resolve().parent.parent
APP = BASIS / "app"


def main():
    html = (APP / "app.html").read_text(encoding="utf-8")
    teile = {
        "/*KERN*/": (APP / "kern.js").read_text(encoding="utf-8"),
        "/*PDF_ANTRAG*/": base64.b64encode((BASIS / "Reisekosten_Antrag_035_002.pdf").read_bytes()).decode(),
        "/*PDF_ANLAGE*/": base64.b64encode((BASIS / "Reisekosten_Anlage.pdf").read_bytes()).decode(),
    }
    for marke, inhalt in teile.items():
        if html.count(marke) != 1:
            raise SystemExit(f"Marke {marke} nicht genau einmal in app.html")
        html = html.replace(marke, inhalt)
    # Für claude.ai: nur der Seiteninhalt (das Gerüst ergänzt die Plattform beim Veröffentlichen)
    artifact = APP / "dist" / "fahrtkosten-artifact.html"
    artifact.parent.mkdir(exist_ok=True)
    artifact.write_text(html, encoding="utf-8")
    # Zum Öffnen im Browser: mit eigenem Gerüst
    ziel = BASIS / "Fahrtkosten-App.html"
    ziel.write_text('<!doctype html><html lang="de"><head><meta charset="utf-8">'
                    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                    '<style>body{margin:0}[hidden]{display:none!important}</style></head><body>'
                    + html + "</body></html>", encoding="utf-8")
    for datei in (ziel, artifact):
        print(f"{datei.relative_to(BASIS)}: {datei.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
