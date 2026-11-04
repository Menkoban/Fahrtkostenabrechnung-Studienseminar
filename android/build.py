"""Baut die Android-App (APK) aus Fahrtkosten-App.html – ohne Gradle, direkt mit den SDK-Werkzeugen.

    python app/build.py        (zuerst: HTML neu bauen)
    python android/build.py    ->  Fahrtkosten.apk im Projektordner

Werkzeuge liegen in C:\\Users\\User\\android-build (JDK 17, Android SDK build-tools 34, platform android-34).
Der Signaturschlüssel liegt in android/signatur/ und muss für Updates derselbe bleiben.
"""

import os
import re
import secrets
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASIS = Path(__file__).resolve().parent.parent
ANDROID = BASIS / "android"
BUILD = ANDROID / "build"
WERKZEUG = Path(r"C:\Users\User\android-build")
JDK = next(WERKZEUG.glob("jdk-17*"))
BT = WERKZEUG / "sdk" / "build-tools" / "34.0.0"
ANDROID_JAR = WERKZEUG / "sdk" / "platforms" / "android-34" / "android.jar"
VERSION = "2.6"

UMGEBUNG = {**os.environ, "JAVA_HOME": str(JDK), "PATH": f"{JDK / 'bin'};{os.environ['PATH']}"}


def lauf(*befehl):
    ergebnis = subprocess.run([str(b) for b in befehl], env=UMGEBUNG, capture_output=True, text=True)
    if ergebnis.returncode != 0:
        raise SystemExit(f"Fehler bei {Path(str(befehl[0])).name}:\n{ergebnis.stdout}\n{ergebnis.stderr}")
    return ergebnis.stdout


def assets():
    """index.html aus der fertigen App, CDN-Bibliotheken durch mitgelieferte Dateien ersetzt (läuft offline)."""
    ziel = BUILD / "assets"
    ziel.mkdir(parents=True)
    html = (BASIS / "Fahrtkosten-App.html").read_text(encoding="utf-8")
    ersetzen = {
        "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js": "pdf-lib.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js": "pdf.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js": "pdf.worker.min.js",
    }
    for alt, neu in ersetzen.items():
        if alt not in html:
            raise SystemExit(f"{alt} nicht in Fahrtkosten-App.html gefunden – app/build.py ausgeführt?")
        html = html.replace(alt, neu)
    # Webschriften sind online optional; ohne Netz greifen die Ersatzschriften
    html = re.sub(r'<link rel="preconnect"[^>]*>\s*', "", html)
    (ziel / "index.html").write_text(html, encoding="utf-8")
    for datei in (ANDROID / "bibliotheken").iterdir():
        shutil.copy(datei, ziel / datei.name)
    return ziel


def symbol():
    """Startsymbol: Anthrazit mit rotem Block und weißem Euro-Zeichen (Farben des Studienseminars)."""
    groessen = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dichte, px in groessen.items():
        gross = px * 4
        bild = Image.new("RGBA", (gross, gross), (0, 0, 0, 0))
        z = ImageDraw.Draw(bild)
        z.rounded_rectangle([0, 0, gross - 1, gross - 1], radius=gross // 5, fill=(55, 55, 54, 255))
        z.rectangle([gross * 0.18, gross * 0.22, gross * 0.30, gross * 0.78], fill=(228, 1, 58, 255))
        schrift = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", int(gross * 0.5))
        z.text((gross * 0.62, gross * 0.5), "€", font=schrift, fill=(255, 255, 255, 255), anchor="mm")
        ordner = ANDROID / "res" / f"mipmap-{dichte}"
        ordner.mkdir(parents=True, exist_ok=True)
        bild.resize((px, px), Image.LANCZOS).save(ordner / "ic_launcher.png")


def schluessel():
    ordner = ANDROID / "signatur"
    ks, pw = ordner / "fahrtkosten.keystore", ordner / "passwort.txt"
    if not ks.exists():
        ordner.mkdir(exist_ok=True)
        pw.write_text(secrets.token_urlsafe(24), encoding="utf-8")
        passwort = pw.read_text(encoding="utf-8").strip()
        lauf(JDK / "bin" / "keytool.exe", "-genkeypair", "-keystore", ks, "-storetype", "PKCS12", "-alias", "fahrtkosten",
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-storepass", passwort, "-keypass", passwort,
             "-dname", "CN=Fahrtkosten Vorbereitungsdienst")
    return ks, pw


def main():
    if BUILD.exists():
        shutil.rmtree(BUILD)
    (BUILD / "gen").mkdir(parents=True)
    (BUILD / "klassen").mkdir()
    (BUILD / "dex").mkdir()
    symbol()
    asset_ordner = assets()

    lauf(BT / "aapt2.exe", "compile", "--dir", ANDROID / "res", "-o", BUILD / "res.zip")
    versionscode = int(datetime.now().strftime("%y%j%H%M"))  # Jahr, Tag im Jahr, Uhrzeit: steigt mit jedem Build
    lauf(BT / "aapt2.exe", "link", "-o", BUILD / "roh.apk", "-I", ANDROID_JAR, "--manifest", ANDROID / "AndroidManifest.xml",
         "-A", asset_ordner, "--java", BUILD / "gen", "--min-sdk-version", "29", "--target-sdk-version", "34",
         "--version-code", versionscode, "--version-name", VERSION, BUILD / "res.zip")

    quellen = [*(ANDROID / "src").rglob("*.java"), *(BUILD / "gen").rglob("*.java")]
    lauf(JDK / "bin" / "javac.exe", "-encoding", "UTF-8", "-source", "8", "-target", "8", "-nowarn", "-Xlint:-options",
         "-bootclasspath", ANDROID_JAR, "-d", BUILD / "klassen", *quellen)
    klassen = list((BUILD / "klassen").rglob("*.class"))
    lauf(BT / "d8.bat", "--release", "--min-api", "29", "--lib", ANDROID_JAR, "--output", BUILD / "dex", *klassen)

    with zipfile.ZipFile(BUILD / "roh.apk", "a", zipfile.ZIP_DEFLATED) as apk:
        apk.write(BUILD / "dex" / "classes.dex", "classes.dex")
    lauf(BT / "zipalign.exe", "-p", "-f", "4", BUILD / "roh.apk", BUILD / "ausgerichtet.apk")

    ks, pw = schluessel()
    ziel = BASIS / "Fahrtkosten.apk"
    lauf(BT / "apksigner.bat", "sign", "--ks", ks, "--ks-pass", f"file:{pw}", "--ks-key-alias", "fahrtkosten",
         "--out", ziel, BUILD / "ausgerichtet.apk")
    print(lauf(BT / "apksigner.bat", "verify", "--verbose", ziel).splitlines()[0])
    print(f"{ziel.name}: {ziel.stat().st_size / 1024 / 1024:.1f} MB, Version {VERSION} ({versionscode})")


if __name__ == "__main__":
    main()
