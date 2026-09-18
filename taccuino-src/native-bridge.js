/* Integrazione nativa del taccuino, attiva solo dentro l'app Android.
   Non tocca la logica del taccuino (variabili e funzioni di app_modello.html):
   aggiunge un pulsante "Esporta e condividi" che, oltre al salvataggio nel
   browser gia' previsto, scrive nella cartella privata dell'app tre file per
   il negozio corrente (HTML di lavoro, JSON di esportazione, PDF di sintesi
   grezza) li' impacchetta in uno .zip e apre il foglio di condivisione nativo
   di Android, cosi' l'utente sceglie con un tocco dove mandarlo (pCloud, mail,
   ecc.) senza che l'app debba conoscere alcuna chiave o token. */
(function () {
  function nativo() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  if (!nativo()) return;

  function hhmm(ms) {
    var d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function nomeCartella(s) {
    var base = (s.negozio || 'sopralluogo').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return base + (s.cdc ? '_' + s.cdc : '') + '_' + (s.data || new Date().toISOString().slice(0, 10));
  }
  function arrayBufferToBase64(buf) {
    var bytes = new Uint8Array(buf), bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function uint8ToBase64(bytes) { return arrayBufferToBase64(bytes.buffer); }

  function pdfDaSessione(s) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var y = 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Taccuino di sopralluogo — sintesi grezza', 14, y); y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Negozio: ' + (s.negozio || '—') + '    CDC: ' + (s.cdc || '—') +
      '    Data: ' + (s.data || '—'), 14, y); y += 8;
    doc.setDrawColor(180); doc.line(14, y, 196, y); y += 6;

    var righe = Object.keys(s.righe || {}).map(function (n) {
      var r = s.righe[n]; return { n: Number(n), r: r.r, nota: r.nota, foto: r.foto || [] };
    }).filter(function (r) { return r.r || (r.nota && r.nota.trim()) || r.foto.length; })
      .sort(function (a, b) { return a.n - b.n; });

    righe.forEach(function (r) {
      if (y > 270) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('Punto ' + r.n + (r.r ? '  —  ' + r.r : ''), 14, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      if (r.nota && r.nota.trim()) {
        var linee = doc.splitTextToSize(r.nota.trim(), 178);
        doc.text(linee, 14, y); y += linee.length * 4.6 + 2;
      }
      if (r.foto.length) {
        var finestre = r.foto.map(function (f) { return hhmm(f[0]) + '–' + hhmm(f[1]); }).join(', ');
        doc.setTextColor(120); doc.text('Finestre foto: ' + finestre, 14, y); doc.setTextColor(0);
        y += 5;
      }
      y += 3;
    });
    (s.libere || []).forEach(function (l) {
      if (y > 270) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('Rilievo libero' + (l.etichetta ? ': ' + l.etichetta : ''), 14, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(120);
      doc.text('Finestra foto: ' + hhmm(l.foto[0]) + '–' + hhmm(l.foto[1]), 14, y);
      doc.setTextColor(0); y += 8;
    });
    doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text('Le foto restano nella libreria del telefono: qui sono registrate solo le finestre orarie con cui verranno abbinate ai punti durante la lavorazione della campagna.', 14, 289, { maxWidth: 182 });
    return doc.output('arraybuffer');
  }

  async function esportaECondividi() {
    try {
      var s = sessione();               // funzione gia' definita da app_modello.html
      chiudiFoto(false);
      var nomeBase = nomeCartella(s);
      var cartella = 'sopralluoghi/' + nomeBase;
      var htmlTesto = documentoSalvabile();   // gia' definita: HTML con i dati incorporati
      var jsonTesto = testoEsporta();         // gia' definita: JSON per la lavorazione

      var Filesystem = window.Capacitor.Plugins.Filesystem;
      var Share = window.Capacitor.Plugins.Share;
      var Directory = { CACHE: 'CACHE' };

      async function scrivi(nomeFile, dataStr) {
        await Filesystem.writeFile({
          path: cartella + '/' + nomeFile, data: dataStr,
          directory: Directory.CACHE, recursive: true, encoding: 'utf8'
        });
      }
      async function scriviBinario(nomeFile, base64) {
        await Filesystem.writeFile({
          path: cartella + '/' + nomeFile, data: base64,
          directory: Directory.CACHE, recursive: true
        });
      }

      await scrivi(nomeBase + '.html', htmlTesto);
      await scrivi(nomeBase + '.json', jsonTesto);
      var pdfBuf = pdfDaSessione(s);
      await scriviBinario(nomeBase + '.pdf', arrayBufferToBase64(pdfBuf));

      var enc = new TextEncoder();
      var pacchetto = {};
      pacchetto[nomeBase + '.html'] = enc.encode(htmlTesto);
      pacchetto[nomeBase + '.json'] = enc.encode(jsonTesto);
      pacchetto[nomeBase + '.pdf'] = new Uint8Array(pdfBuf);
      var zippato = fflate.zipSync(pacchetto, { level: 6 });
      await scriviBinario(nomeBase + '.zip', uint8ToBase64(zippato));

      var uriZip = (await Filesystem.getUri({ path: cartella + '/' + nomeBase + '.zip', directory: Directory.CACHE })).uri;

      toast('Salvato: ' + nomeBase + '.zip (html, json, pdf)');
      try {
        await Share.share({
          title: 'Sopralluogo ' + (s.negozio || ''),
          text: 'Archivio del sopralluogo ' + (s.negozio || '') + (s.cdc ? ' - CDC ' + s.cdc : ''),
          url: uriZip
        });
      } catch (e) { /* condivisione annullata: i file restano comunque salvati sul telefono */ }
    } catch (e) {
      toast('Esportazione non riuscita: ' + (e && e.message ? e.message : e));
    }
  }

  function aggiungiPulsante(accantoA) {
    var rif = document.getElementById(accantoA);
    if (!rif || !rif.parentNode) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = rif.className;
    b.textContent = 'Esporta e condividi (html + json + pdf)';
    b.style.marginTop = '8px';
    b.addEventListener('click', esportaECondividi);
    rif.parentNode.insertBefore(b, rif.nextSibling);
  }

  window.addEventListener('DOMContentLoaded', function () {
    aggiungiPulsante('bSalva');
    aggiungiPulsante('bSalva2');
  });
})();
