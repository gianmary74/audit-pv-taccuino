/* Integrazione nativa del taccuino, attiva solo dentro l'app Android.
   Non tocca la logica del taccuino originale (le variabili e le funzioni di
   app_modello.html restano quelle di sempre, valide anche per la versione
   HTML/PWA che la skill continua a generare): qui si aggiunge solo, sopra.

   Due cose in piu' rispetto al taccuino da browser:

   1. Scatto reale con la fotocamera del telefono. Nella versione HTML "Foto
      da qui" apre solo una finestra temporale (l'abbinamento con le foto,
      scattate con l'app fotocamera normale, avviene dopo, durante la
      lavorazione della campagna). Qui, siccome l'app ha accesso diretto alla
      fotocamera, lo stesso tocco apre davvero la fotocamera: la finestra
      temporale resta comunque registrata come prima (niente si toglie alla
      compatibilita' con lo script di fusione), ma in piu' la foto scattata
      viene salvata nello spazio privato dell'app, cosi' da poterla includere
      subito nel pacchetto di fine sopralluogo. Ogni foto viene anche
      salvata nella libreria normale del telefono (saveToGallery), quindi
      resta comunque disponibile per l'abbinamento GPS/orario della skill
      come con qualunque altra foto.
   2. Tasto microfono ("Detta nota") accanto al campo nota della scheda
      punto: avvia la dettatura vocale nativa (non quella della tastiera,
      che restava comunque disponibile) e aggiunge il testo riconosciuto
      alla nota, utile quando le mani sono sporche o si indossano i guanti.
   3. Pulsante "Esporta e condividi": scrive nella cartella privata dell'app
      tre file per il negozio corrente (HTML di lavoro, JSON di esportazione,
      PDF di sintesi grezza con le miniature delle foto scattate), li
      impacchetta in uno .zip e apre il foglio di condivisione nativo di
      Android, cosi' l'utente sceglie con un tocco dove mandarlo (pCloud,
      mail, ecc.) senza che l'app debba conoscere alcuna chiave o token. */
(function () {
  function nativo() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  if (!nativo()) return;

  var Filesystem = window.Capacitor.Plugins.Filesystem;
  var Share = window.Capacitor.Plugins.Share;
  var Camera = window.Capacitor.Plugins.Camera;
  var SpeechRecognition = window.Capacitor.Plugins.SpeechRecognition;
  var DIR_DATA = 'DATA';
  var DIR_CACHE = 'CACHE';

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
  function base64ToUint8(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* --------------------------- scatto con la fotocamera -------------------------- */
  function cartellaFotoSessione() {
    return 'foto_catturate/' + sessione().id;   // sessione() e' gia' definita dal taccuino
  }
  async function scatta(n, et) {
    try {
      var foto = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: 'base64',
        source: 'CAMERA',
        saveToGallery: true
      });
      if (!foto || !foto.base64String) return;
      var ext = (foto.format || 'jpeg').replace('jpg', 'jpeg');
      var nomeFile = (n ? String(n) : 'libero') + '__' + Date.now() + '.' + ext;
      await Filesystem.writeFile({
        path: cartellaFotoSessione() + '/' + nomeFile,
        data: foto.base64String,
        directory: DIR_DATA,
        recursive: true
      });
      toast('Foto acquisita' + (n ? ' · punto ' + n : ' · rilievo libero'));
    } catch (e) {
      /* scatto annullato dall'utente: non e' un errore da segnalare */
    }
  }

  // Ogni apertura di finestra foto nel taccuino passa da apriFoto(n, et):
  // tocco su una piastrella, "Foto da qui" nella scheda, "Rilievo libero".
  // Si aggancia li', senza toccare la funzione originale.
  var _apriFoto = window.apriFoto;
  window.apriFoto = function (n, et) {
    _apriFoto(n, et);
    scatta(n, et);
  };

  // Nel banner (visibile mentre una finestra foto e' aperta) si aggiunge un
  // pulsante per scattare altre foto sullo stesso punto senza doverlo
  // riaprire.
  function aggiungiPulsanteBanner() {
    var banner = document.getElementById('banner');
    var rifBottone = document.getElementById('bNota');
    if (!banner || !rifBottone || document.getElementById('bScattaAncora')) return;
    var b = document.createElement('button');
    b.id = 'bScattaAncora'; b.type = 'button'; b.textContent = 'Scatta ancora';
    b.addEventListener('click', function () {
      if (window.attivo) scatta(window.attivo.n, window.attivo.etichetta);
    });
    rifBottone.parentNode.insertBefore(b, rifBottone);
  }

  /* ----------------------------- nota vocale (microfono) -------------------------- */
  var inAscolto = false;
  async function dettaNota(textarea, bottone) {
    if (inAscolto || !SpeechRecognition) return;
    try {
      var perm = await SpeechRecognition.checkPermissions();
      if (perm.speechRecognition !== 'granted') {
        perm = await SpeechRecognition.requestPermissions();
        if (perm.speechRecognition !== 'granted') {
          toast('Permesso microfono negato'); return;
        }
      }
      inAscolto = true;
      var testoOrig = bottone.textContent;
      bottone.textContent = '● In ascolto…';
      var r = await SpeechRecognition.start({
        language: 'it-IT', maxResults: 1, partialResults: false, popup: false
      });
      bottone.textContent = testoOrig;
      inAscolto = false;
      var detto = (r && r.matches && r.matches[0]) ? r.matches[0].trim() : '';
      if (!detto) { toast('Nessun testo riconosciuto'); return; }
      var attuale = textarea.value.trim();
      textarea.value = attuale ? (attuale + ' ' + detto) : detto;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      toast('Nota aggiunta');
    } catch (e) {
      inAscolto = false;
      if (bottone) bottone.textContent = '🎤 Detta nota';
      toast('Dettatura non riuscita: ' + (e && e.message ? e.message : e));
    }
  }
  function aggiungiMicrofono(idTextarea) {
    var ta = document.getElementById(idTextarea);
    if (!ta || !ta.parentNode || !SpeechRecognition) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'bMic' + idTextarea;
    b.textContent = '🎤 Detta nota';
    b.style.marginTop = '8px'; b.style.width = '100%';
    b.addEventListener('click', function () { dettaNota(ta, b); });
    ta.parentNode.insertBefore(b, ta.nextSibling);
  }

  /* ------------------------------- generazione PDF -------------------------------- */
  async function fotoDellaSessione() {
    var cartella = cartellaFotoSessione();
    var out = {};   // { puntoOLibero: [ {nomeFile, base64, formato} ] }
    try {
      var lista = await Filesystem.readdir({ path: cartella, directory: DIR_DATA });
      for (var i = 0; i < lista.files.length; i++) {
        var nomeFile = lista.files[i].name || lista.files[i];
        var m = /^(.+?)__(\d+)\.(\w+)$/.exec(nomeFile);
        if (!m) continue;
        var chiave = m[1], formato = m[3];
        var letto = await Filesystem.readFile({ path: cartella + '/' + nomeFile, directory: DIR_DATA });
        if (!out[chiave]) out[chiave] = [];
        out[chiave].push({ nomeFile: nomeFile, base64: letto.data, formato: formato });
      }
    } catch (e) { /* nessuna foto scattata in questa sessione: cartella assente */ }
    return out;
  }

  function pdfDaSessione(s, foto) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var y = 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Taccuino di sopralluogo — sintesi grezza', 14, y); y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Negozio: ' + (s.negozio || '—') + '    CDC: ' + (s.cdc || '—') +
      '    Data: ' + (s.data || '—'), 14, y); y += 8;
    doc.setDrawColor(180); doc.line(14, y, 196, y); y += 6;

    function nuovaPaginaSeServe(altezzaExtra) {
      if (y + (altezzaExtra || 0) > 275) { doc.addPage(); y = 18; }
    }
    function immaginiPer(chiave) {
      var elenco = foto[chiave] || [];
      if (!elenco.length) return;
      var LATO = 45, MARG = 4, perRiga = 3, i = 0;
      nuovaPaginaSeServe(LATO + 4);
      var x0 = 14;
      elenco.forEach(function (f) {
        if (i > 0 && i % perRiga === 0) { y += LATO + MARG; nuovaPaginaSeServe(LATO + 4); }
        var x = x0 + (i % perRiga) * (LATO + MARG);
        try {
          doc.addImage('data:image/' + f.formato + ';base64,' + f.base64, f.formato.toUpperCase(), x, y, LATO, LATO);
        } catch (e) { /* formato non riconosciuto da jsPDF: si salta la miniatura */ }
        i++;
      });
      y += LATO + 6;
    }

    var righe = Object.keys(s.righe || {}).map(function (n) {
      var r = s.righe[n]; return { n: Number(n), r: r.r, nota: r.nota, foto: r.foto || [] };
    }).filter(function (r) { return r.r || (r.nota && r.nota.trim()) || r.foto.length || foto[String(r.n)]; })
      .sort(function (a, b) { return a.n - b.n; });

    righe.forEach(function (r) {
      nuovaPaginaSeServe(14);
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
      y += 2;
      immaginiPer(String(r.n));
      y += 3;
    });
    (s.libere || []).forEach(function (l, idx) {
      nuovaPaginaSeServe(14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('Rilievo libero' + (l.etichetta ? ': ' + l.etichetta : ''), 14, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(120);
      doc.text('Finestra foto: ' + hhmm(l.foto[0]) + '–' + hhmm(l.foto[1]), 14, y);
      doc.setTextColor(0); y += 6;
    });
    if (foto['libero'] && foto['libero'].length) immaginiPer('libero');

    doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text('Sintesi grezza generata sul telefono. Le foto scattate dall\'app sono incluse qui in miniatura e nello .zip; una copia a piena risoluzione resta anche nella libreria foto del telefono per l\'abbinamento nella lavorazione della campagna.', 14, 289, { maxWidth: 182 });
    return doc.output('arraybuffer');
  }

  /* --------------------------- esporta e condividi -------------------------------- */
  async function esportaECondividi() {
    try {
      var s = sessione();               // funzione gia' definita da app_modello.html
      chiudiFoto(false);
      var nomeBase = nomeCartella(s);
      var cartella = 'sopralluoghi/' + nomeBase;
      var htmlTesto = documentoSalvabile();   // gia' definita: HTML con i dati incorporati
      var jsonTesto = testoEsporta();         // gia' definita: JSON per la lavorazione
      var foto = await fotoDellaSessione();

      async function scrivi(nomeFile, dataStr) {
        await Filesystem.writeFile({
          path: cartella + '/' + nomeFile, data: dataStr,
          directory: DIR_CACHE, recursive: true, encoding: 'utf8'
        });
      }
      async function scriviBinario(nomeFile, base64) {
        await Filesystem.writeFile({
          path: cartella + '/' + nomeFile, data: base64,
          directory: DIR_CACHE, recursive: true
        });
      }

      await scrivi(nomeBase + '.html', htmlTesto);
      await scrivi(nomeBase + '.json', jsonTesto);
      var pdfBuf = pdfDaSessione(s, foto);
      await scriviBinario(nomeBase + '.pdf', arrayBufferToBase64(pdfBuf));

      var enc = new TextEncoder();
      var pacchetto = {};
      pacchetto[nomeBase + '.html'] = enc.encode(htmlTesto);
      pacchetto[nomeBase + '.json'] = enc.encode(jsonTesto);
      pacchetto[nomeBase + '.pdf'] = new Uint8Array(pdfBuf);
      Object.keys(foto).forEach(function (chiave) {
        foto[chiave].forEach(function (f) {
          pacchetto['foto/' + f.nomeFile] = base64ToUint8(f.base64);
        });
      });
      var zippato = fflate.zipSync(pacchetto, { level: 6 });
      await scriviBinario(nomeBase + '.zip', uint8ToBase64(zippato));

      var uriZip = (await Filesystem.getUri({ path: cartella + '/' + nomeBase + '.zip', directory: DIR_CACHE })).uri;

      var nFoto = Object.keys(foto).reduce(function (a, k) { return a + foto[k].length; }, 0);
      toast('Salvato: ' + nomeBase + '.zip (html, json, pdf' + (nFoto ? ', ' + nFoto + ' foto' : '') + ')');
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
    b.textContent = 'Esporta e condividi (html + json + pdf + foto)';
    b.style.marginTop = '8px';
    b.addEventListener('click', esportaECondividi);
    rif.parentNode.insertBefore(b, rif.nextSibling);
  }

  window.addEventListener('DOMContentLoaded', function () {
    aggiungiPulsante('bSalva');
    aggiungiPulsante('bSalva2');
    aggiungiPulsanteBanner();
    aggiungiMicrofono('dNota');
  });
})();
