"""Baut die Android-App (APK) aus Fahrtkosten-App.html – ohne Gradle, direkt mit den SDK-Werkzeugen.

    python app/build.py        (zuerst: HTML neu bauen)
    python android/build.py    ->  Fahrtkosten.apk im Projektordner

Werkzeuge: JDK 17 (mit JDK 21 stürzt d8 aus build-tools 34 ab) und Android SDK (build-tools 34.0.0, platforms/android-34).
  Windows: C:\\Users\\User\\android-build (jdk-17*, sdk/...)
  Linux/Cloud: ANDROID_HOME (Standard /opt/android/sdk) und JAVA_HOME (Standard: java im PATH)
Der Signaturschlüssel liegt in android/signatur/ (oder FAHRTKOSTEN_SIGNATUR) und muss für Updates derselbe bleiben.
"""

import os
import re
import secrets
import sys
import shutil
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASIS = Path(__file__).resolve().parent.parent
ANDROID = BASIS / "android"
BUILD = ANDROID / "build"
WINDOWS = sys.platform.startswith("win")
if WINDOWS:
    WERKZEUG = Path(r"C:\Users\User\android-build")
    JDK = next(WERKZEUG.glob("jdk-17*"))
    SDK = WERKZEUG / "sdk"
else:
    SDK = Path(os.environ.get("ANDROID_HOME", "/opt/android/sdk"))
    JDK = Path(os.environ["JAVA_HOME"]) if os.environ.get("JAVA_HOME") else Path(shutil.which("javac")).resolve().parent.parent
BT = SDK / "build-tools" / "34.0.0"
ANDROID_JAR = SDK / "platforms" / "android-34" / "android.jar"
EXE, BAT = (".exe", ".bat") if WINDOWS else ("", "")
SIGNATUR = Path(os.environ.get("FAHRTKOSTEN_SIGNATUR", ANDROID / "signatur"))
# Eine Versionsnummer für HTML und APK: steht in app/build.py
VERSION = re.search(r'^VERSION = "([^"]+)"', (BASIS / "app" / "build.py").read_text(encoding="utf-8"), re.M).group(1)

UMGEBUNG = {**os.environ, "JAVA_HOME": str(JDK), "PATH": f"{JDK / 'bin'}{os.pathsep}{os.environ['PATH']}"}


def lauf(*befehl):
    ergebnis = subprocess.run([str(b) for b in befehl], env=UMGEBUNG, capture_output=True, text=True)
    if ergebnis.returncode != 0:
        raise SystemExit(f"Fehler bei {Path(str(befehl[0])).name}:\n{ergebnis.stdout}\n{ergebnis.stderr}")
    return ergebnis.stdout


def assets():
    """index.html = die fertige Offline-App (Bibliotheken und Formulare sind schon eingebettet)."""
    ziel = BUILD / "assets"
    ziel.mkdir(parents=True)
    html = (BASIS / "Fahrtkosten-App.html").read_text(encoding="utf-8")
    if 'id="lib-pdfjs"' not in html or "fonts.googleapis" in html:
        raise SystemExit("Fahrtkosten-App.html ist nicht die Offline-Version – zuerst python app/build.py ausführen")
    if f'APP_VERSION = "{VERSION}"' not in html:
        raise SystemExit(f"Fahrtkosten-App.html hat nicht Version {VERSION} – zuerst python app/build.py ausführen")
    (ziel / "index.html").write_text(html, encoding="utf-8")
    return ziel


SCHRIFT = next((s for s in (r"C:\Windows\Fonts\arialbd.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") if Path(s).exists()), None)


def symbol():
    """Startsymbol: Anthrazit mit rotem Block und weißem Euro-Zeichen (Farben des Studienseminars)."""
    groessen = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    # Die Symbole liegen im Repo; nur neu zeichnen, wenn eines fehlt (sonst ändert jede Schrift das Bild)
    if all((ANDROID / "res" / f"mipmap-{d}" / "ic_launcher.png").exists() for d in groessen):
        return
    if not SCHRIFT:
        raise SystemExit("Startsymbole fehlen und keine passende Schrift gefunden")
    for dichte, px in groessen.items():
        gross = px * 4
        bild = Image.new("RGBA", (gross, gross), (0, 0, 0, 0))
        z = ImageDraw.Draw(bild)
        z.rounded_rectangle([0, 0, gross - 1, gross - 1], radius=gross // 5, fill=(55, 55, 54, 255))
        z.rectangle([gross * 0.18, gross * 0.22, gross * 0.30, gross * 0.78], fill=(228, 1, 58, 255))
        schrift = ImageFont.truetype(SCHRIFT, int(gross * 0.5))
        z.text((gross * 0.62, gross * 0.5), "€", font=schrift, fill=(255, 255, 255, 255), anchor="mm")
        ordner = ANDROID / "res" / f"mipmap-{dichte}"
        ordner.mkdir(parents=True, exist_ok=True)
        bild.resize((px, px), Image.LANCZOS).save(ordner / "ic_launcher.png")


def schluessel():
    ordner = SIGNATUR
    ks, pw = ordner / "fahrtkosten.keystore", ordner / "passwort.txt"
    if not ks.exists():
        ordner.mkdir(exist_ok=True)
        pw.write_text(secrets.token_urlsafe(24), encoding="utf-8")
        passwort = pw.read_text(encoding="utf-8").strip()
        lauf(JDK / "bin" / f"keytool{EXE}", "-genkeypair", "-keystore", ks, "-storetype", "PKCS12", "-alias", "fahrtkosten",
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

    lauf(BT / f"aapt2{EXE}", "compile", "--dir", ANDROID / "res", "-o", BUILD / "res.zip")
    versionscode = int(datetime.now().strftime("%y%j%H%M"))  # Jahr, Tag im Jahr, Uhrzeit: steigt mit jedem Build
    lauf(BT / f"aapt2{EXE}", "link", "-o", BUILD / "roh.apk", "-I", ANDROID_JAR, "--manifest", ANDROID / "AndroidManifest.xml",
         "-A", asset_ordner, "--java", BUILD / "gen", "--min-sdk-version", "29", "--target-sdk-version", "34",
         "--version-code", versionscode, "--version-name", VERSION, BUILD / "res.zip")

    quellen = [*(ANDROID / "src").rglob("*.java"), *(BUILD / "gen").rglob("*.java")]
    lauf(JDK / "bin" / f"javac{EXE}", "-encoding", "UTF-8", "-source", "8", "-target", "8", "-nowarn", "-Xlint:-options",
         "-bootclasspath", ANDROID_JAR, "-d", BUILD / "klassen", *quellen)
    klassen = list((BUILD / "klassen").rglob("*.class"))
    lauf(BT / f"d8{BAT}", "--release", "--min-api", "29", "--lib", ANDROID_JAR, "--output", BUILD / "dex", *klassen)

    with zipfile.ZipFile(BUILD / "roh.apk", "a", zipfile.ZIP_DEFLATED) as apk:
        apk.write(BUILD / "dex" / "classes.dex", "classes.dex")
    lauf(BT / f"zipalign{EXE}", "-p", "-f", "4", BUILD / "roh.apk", BUILD / "ausgerichtet.apk")

    ks, pw = schluessel()
    ziel = BASIS / "Fahrtkosten.apk"
    lauf(BT / f"apksigner{BAT}", "sign", "--ks", ks, "--ks-pass", f"file:{pw}", "--ks-key-alias", "fahrtkosten",
         "--out", ziel, BUILD / "ausgerichtet.apk")
    print(lauf(BT / f"apksigner{BAT}", "verify", "--verbose", ziel).splitlines()[0])
    print(f"{ziel.name}: {ziel.stat().st_size / 1024 / 1024:.1f} MB, Version {VERSION} ({versionscode})")


if __name__ == "__main__":
    main()
