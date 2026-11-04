package de.fahrtkosten.vorbereitungsdienst;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

/** Zeigt die Fahrtkosten-App (assets/index.html) und speichert erzeugte PDFs im Download-Ordner. */
public class MainActivity extends Activity {

    private static final int DATEIWAHL = 1;
    private WebView web;
    private ValueCallback<Uri[]> dateiRueckruf;

    @Override
    protected void onCreate(Bundle zustand) {
        super.onCreate(zustand);
        getWindow().setStatusBarColor(0xFF373736);
        getWindow().setNavigationBarColor(0xFFFFFFFF);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setDatabaseEnabled(true);

        web.addJavascriptInterface(new Bruecke(), "AndroidApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest anfrage) {
                Uri uri = anfrage.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                // Links nach außen (z. B. Google Maps) im Browser bzw. in der passenden App öffnen
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "Keine App für diesen Link gefunden", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> rueckruf, FileChooserParams parameter) {
                if (dateiRueckruf != null) dateiRueckruf.onReceiveValue(null);
                dateiRueckruf = rueckruf;
                try {
                    startActivityForResult(parameter.createIntent(), DATEIWAHL);
                } catch (ActivityNotFoundException e) {
                    dateiRueckruf = null;
                    return false;
                }
                return true;
            }
        });

        setContentView(web);
        if (zustand != null) web.restoreState(zustand);
        else web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle zustand) {
        super.onSaveInstanceState(zustand);
        web.saveState(zustand);
    }

    @Override
    protected void onActivityResult(int anfrage, int ergebnis, Intent daten) {
        if (anfrage == DATEIWAHL && dateiRueckruf != null) {
            dateiRueckruf.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(ergebnis, daten));
            dateiRueckruf = null;
            return;
        }
        super.onActivityResult(anfrage, ergebnis, daten);
    }

    @Override
    public void onBackPressed() {
        // Zurück-Taste: in der App erst zur Fahrtenliste, dann schließen
        web.evaluateJavascript("(function(){ if (typeof ui !== 'undefined' && ui.view !== 'fahrten') { gehe('fahrten'); return 'ja'; } return 'nein'; })()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String antwort) {
                        if (!"\"ja\"".equals(antwort)) MainActivity.super.onBackPressed();
                    }
                });
    }

    /** Wird aus JavaScript als window.AndroidApp aufgerufen. */
    private class Bruecke {
        @JavascriptInterface
        public String speichere(String name, String base64, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                ContentResolver resolver = getContentResolver();
                ContentValues werte = new ContentValues();
                werte.put(MediaStore.Downloads.DISPLAY_NAME, name);
                werte.put(MediaStore.Downloads.MIME_TYPE, mime);
                werte.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Fahrtkosten");
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, werte);
                if (uri == null) return "fehler: Der Download-Ordner ist nicht erreichbar";
                try (OutputStream aus = resolver.openOutputStream(uri)) {
                    aus.write(bytes);
                }
                final Uri gespeichert = uri;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        oeffne(gespeichert, mime, name);
                    }
                });
                return "ok";
            } catch (Exception e) {
                return "fehler: " + e.getMessage();
            }
        }
    }

    private void oeffne(Uri uri, String mime, String name) {
        Toast.makeText(this, name + " im Ordner Download/Fahrtkosten gespeichert", Toast.LENGTH_LONG).show();
        if (!"application/pdf".equals(mime)) return;
        Intent anzeigen = new Intent(Intent.ACTION_VIEW);
        anzeigen.setDataAndType(uri, mime);
        anzeigen.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(anzeigen, "PDF öffnen mit"));
        } catch (ActivityNotFoundException e) {
            // Kein PDF-Betrachter installiert: Datei bleibt im Download-Ordner
        }
    }
}
