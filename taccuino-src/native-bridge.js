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
      Ogni volta che si riapre la scheda di un punto gia' visto, il campo
      nota si presenta vuoto: quello che si scrive o si detta si aggiunge
      (su una riga nuova) a quanto gia' raccolto per quel punto nelle
      aperture precedenti, invece di sovrascriverlo. La nota finale, quella
      che finisce nel JSON/HTML/PDF, resta la somma di tutte le aperture.
   3. Pulsante "Esporta e condividi": scrive nella cartella privata dell'app
      tre file per il negozio corrente (HTML di lavoro, JSON di esportazione,
      PDF di sintesi grezza con le miniature delle foto scattate), li
      impacchetta in uno .zip e apre il foglio di condivisione nativo di
      Android, cosi' l'utente sceglie con un tocco dove mandarlo (pCloud,
      mail, ecc.) senza che l'app debba conoscere alcuna chiave o token. Il
      JSON dentro lo zip e' lo stesso contenuto che il vecchio pulsante
      "Esporta per Claude" mostrava da copiare: quel pulsante (originale del
      taccuino) e' quindi nascosto qui, perche' ridondante.
   4. Scatto senza schermata di conferma. La fotocamera nativa di Android
      (quella richiamata da Camera.getPhoto) mostra sempre, dopo lo scatto,
      una propria schermata di revisione con OK/Riscatta: e' una schermata
      dell'app fotocamera del telefono, non del taccuino, e non si puo'
      disattivare da qui. Per evitarla, lo scatto usa una fotocamera "in
      pagina" (flusso video via getUserMedia dentro la webview, con un solo
      pulsante di scatto): il tocco sul pulsante e' l'unico gesto, la foto
      viene salvata subito e non c'e' nessuna schermata successiva da
      confermare. Se il dispositivo non supporta getUserMedia si ripiega
      sulla fotocamera nativa di sistema (con la sua conferma), cosi' lo
      scatto non si rompe mai del tutto.
   5. Negozio prima di tutto. La scheda "Negozio" (la vecchia scheda "Giro",
      spostata qui in prima posizione solo a video via CSS "order", senza
      toccare l'ordine dei tab nell'HTML originale) e' l'unica raggiungibile
      finche' la sessione aperta non ha un negozio: le altre due schede
      restano disabilitate e, se qualcosa tenta comunque di aprire una
      finestra foto o la scheda di un punto, l'azione viene bloccata con un
      avviso invece di essere eseguita.
   6. Pulsante "Svuota memoria": cancella dalla memoria del telefono (e dalle
      foto private dell'app) tutti i sopralluoghi gia' in elenco tranne
      quello aperto in questo momento, per non lasciare accumulare negozi
      gia' esportati e lavorati. Chiede sempre conferma prima, perche' non e'
      reversibile. */
(function () {
  function nativo() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  if (!nativo()) return;

  // Corregge due problemi di layout che si vedono solo dentro l'app (non nel
  // browser): 1) la barra di stato del telefono si sovrappone alla testata e
  // al banner, che nel browser non esistono; 2) il pulsante "+ Foto" aggiunto
  // qui sotto al banner, se il banner non va a capo, spinge tutta la pagina
  // piu' larga dello schermo e taglia il bordo destro di tutto (banner,
  // scheda del punto, pulsanti). Si inietta un foglio di stile dedicato
  // invece di toccare le regole del taccuino originale.
  var stile = document.createElement('style');
  stile.textContent =
    'html,body{overflow-x:hidden;max-width:100vw}' +
    'header.top{padding-top:env(safe-area-inset-top)}' +
    '.banner{padding-top:env(safe-area-inset-top)}' +
    '.banner .wrap{flex-wrap:wrap;row-gap:6px}' +
    '.banner .grow{flex:1 1 100%;min-width:0}' +
    '.banner button{flex:0 0 auto;padding:7px 10px;font-size:12.5px}' +
    // "Esporta per Claude" (pulsante originale del taccuino) e' ridondante
    // col nuovo "Esporta e condividi": il suo JSON e' lo stesso contenuto.
    '#bEsporta{display:none}' +
    // La scheda "Negozio" (id storico #tabGiro) va per prima: solo ordine
    // visivo (flex order), l'HTML e la logica del taccuino restano quelli
    // di sempre.
    '#tabGiro{order:-1}' +
    'nav.tab button:disabled{opacity:.4}' +
    '#avvisoNegozio{color:var(--accent,#B4530A);font-weight:600}';
  document.head.appendChild(stile);

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

  // Il permesso fotocamera serve comunque (lo richiede la webview prima di
  // concedere getUserMedia): si continua a chiederlo tramite il plugin
  // Camera, anche se poi lo scatto vero non passa piu' da li'.
  async function assicuraPermessoFotocamera() {
    if (!Camera || !Camera.checkPermissions) return true;
    try {
      var stato = await Camera.checkPermissions();
      if (stato && stato.camera === 'granted') return true;
      stato = await Camera.requestPermissions({ permissions: ['camera'] });
      return !!(stato && stato.camera === 'granted');
    } catch (e) { return true; /* non blocca: si tenta comunque getUserMedia */ }
  }

  // Fotocamera "in pagina": un solo pulsante di scatto, nessuna schermata di
  // conferma dopo. Risolve con {base64, formato} oppure null se annullata.
  function catturaConGetUserMedia() {
    return new Promise(function (resolve) {
      var overlay, video, stream, chiuso = false;
      function chiudi(risultato) {
        if (chiuso) return; chiuso = true;
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(risultato);
      }
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } },
        audio: false
      }).then(function (s) {
        stream = s;
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;' +
          'display:flex;align-items:center;justify-content:center;overflow:hidden';
        video = document.createElement('video');
        video.autoplay = true; video.playsInline = true; video.muted = true;
        video.style.cssText = 'width:100%;height:100%;object-fit:cover';
        video.srcObject = stream;

        var barra = document.createElement('div');
        barra.style.cssText = 'position:absolute;left:0;right:0;bottom:0;display:flex;' +
          'align-items:center;justify-content:space-between;padding:18px 24px calc(18px + env(safe-area-inset-bottom));' +
          'background:linear-gradient(transparent,rgba(0,0,0,.65))';

        var bAnnulla = document.createElement('button');
        bAnnulla.type = 'button'; bAnnulla.textContent = 'Annulla';
        bAnnulla.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7);' +
          'border-radius:8px;padding:10px 16px;font-size:14px';

        var bScatta = document.createElement('button');
        bScatta.type = 'button'; bScatta.setAttribute('aria-label', 'Scatta');
        bScatta.style.cssText = 'width:68px;height:68px;border-radius:50%;background:#fff;' +
          'border:4px solid rgba(255,255,255,.45)';

        var spazio = document.createElement('div'); spazio.style.cssText = 'width:64px';

        barra.appendChild(bAnnulla); barra.appendChild(bScatta); barra.appendChild(spazio);
        overlay.appendChild(video); overlay.appendChild(barra);
        document.body.appendChild(overlay);

        bAnnulla.addEventListener('click', function () { chiudi(null); });
        bScatta.addEventListener('click', function () {
          // Il tocco sul pulsante E' lo scatto: nessuna schermata dopo.
          var canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 960;
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.72);
          chiudi({ base64: dataUrl.split(',')[1], formato: 'jpeg' });
        });
      }).catch(function () { chiudi(undefined); /* undefined = non disponibile: si ripiega */ });
    });
  }

  async function catturaConCameraNativa() {
    try {
      var foto = await Camera.getPhoto({
        quality: 70, allowEditing: false, resultType: 'base64',
        source: 'CAMERA', saveToGallery: true
      });
      if (!foto || !foto.base64String) return null;
      return { base64: foto.base64String, formato: (foto.format || 'jpeg').replace('jpg', 'jpeg') };
    } catch (e) { return null; /* scatto annullato dall'utente */ }
  }

  async function scatta(n, et) {
    await assicuraPermessoFotocamera();
    var risultato;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      risultato = await catturaConGetUserMedia();
    }
    if (risultato === undefined) risultato = await catturaConCameraNativa();   // ripiego
    if (!risultato) return;   // annullato dall'utente
    var nomeFile = (n ? String(n) : 'libero') + '__' + Date.now() + '.' + risultato.formato;
    try {
      await Filesystem.writeFile({
        path: cartellaFotoSessione() + '/' + nomeFile,
        data: risultato.base64,
        directory: DIR_DATA,
        recursive: true
      });
      toast('Foto acquisita' + (n ? ' · punto ' + n : ' · rilievo libero'));
    } catch (e) {
      toast('Salvataggio foto non riuscito: ' + (e && e.message ? e.message : e));
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

  /* --------- nota "a somma": ogni apertura della scheda parte vuota, --------- */
  /* --------- quello che si scrive si aggiunge a quanto gia' raccolto -------- */
  // riga(n) e' la funzione originale che crea/restituisce {r, nota, foto} per
  // il punto n. Qui, alla prima volta che si incontra un dato punto, si
  // trasforma la sua proprieta' "nota" in un accumulatore: leggerla restituisce
  // sempre il testo completo (quello che finisce nel JSON/PDF/HTML, invariato
  // per lo script di fusione), ma scriverci (cosa che il taccuino originale fa
  // ogni volta che si chiude la scheda) aggiunge il nuovo testo invece di
  // sostituire quello vecchio.
  var _riga = window.riga;
  window.riga = function (n) {
    var r = _riga(n);
    if (!r.__notaSomma) {
      var interna = { v: r.nota || '' };
      r.__ultimoTesto = null;   // evita doppie aggiunte se il taccuino scrive
                                 // due volte lo stesso testo alla chiusura
      Object.defineProperty(r, 'nota', {
        enumerable: true, configurable: true,
        get: function () { return interna.v; },
        set: function (nuovo) {
          nuovo = (nuovo || '').trim();
          if (!nuovo || nuovo === r.__ultimoTesto) return;   // niente di nuovo, o gia' registrato in questa apertura
          r.__ultimoTesto = nuovo;
          if (nuovo === interna.v) return;
          // se il nuovo testo contiene gia' per intero quello vecchio (capita
          // quando qualcosa nel taccuino riscrive il valore letto dal campo
          // senza passare dall'apertura vuota) non lo si duplica.
          if (interna.v && nuovo.indexOf(interna.v) === 0) { interna.v = nuovo; return; }
          interna.v = interna.v ? (interna.v + '\n' + nuovo) : nuovo;
        }
      });
      Object.defineProperty(r, '__notaSomma', { value: true, enumerable: false });
    }
    return r;
  };

  // apriPunto(n) e' la funzione originale che apre la scheda e vi carica la
  // nota corrente nel campo di testo. Qui, subito dopo, si svuota il campo e
  // si azzera il guardiano anti-doppione: il testo raccolto finora resta al
  // sicuro nell'accumulatore sopra, pronto a ricevere in aggiunta quello che
  // si scrive in questa nuova apertura.
  var _apriPunto = window.apriPunto;
  window.apriPunto = function (n) {
    _apriPunto(n);
    var r = window.riga(n);
    r.__ultimoTesto = null;
    var ta = document.getElementById('dNota');
    if (ta) ta.value = '';
  };

  /* ------------------ negozio prima di tutto ------------------ */
  // Finche' la sessione aperta non ha un negozio (campo "Insegna e citta'",
  // riempito a mano o scegliendo un negozio in programma) non ha senso
  // segnare rilievi o scattare foto: finirebbero attribuiti al sopralluogo
  // sbagliato. sessione() e' gia' definita dal taccuino originale.
  function negozioSelezionato() {
    try {
      var s = window.sessione && window.sessione();
      return !!(s && s.negozio && String(s.negozio).trim());
    } catch (e) { return true; }   // in dubbio non si blocca nulla
  }

  function aggiornaBloccoNegozio() {
    var ok = negozioSelezionato();
    var tR = document.getElementById('tabRilievi');
    var tE = document.getElementById('tabElenco');
    if (tR) { tR.disabled = !ok; tR.setAttribute('aria-disabled', String(!ok)); }
    if (tE) { tE.disabled = !ok; tE.setAttribute('aria-disabled', String(!ok)); }
    var pannello = document.getElementById('vGiro');
    var avviso = document.getElementById('avvisoNegozio');
    if (pannello) {
      if (!ok) {
        if (!avviso) {
          avviso = document.createElement('p');
          avviso.id = 'avvisoNegozio'; avviso.className = 'nota-uso';
          avviso.textContent = 'Seleziona prima il negozio (o scrivi insegna e citta\''
            + '): senza negozio le altre due schede restano bloccate, per non attribuire rilievi e foto al negozio sbagliato.';
          pannello.insertBefore(avviso, pannello.firstChild);
        }
      } else if (avviso) { avviso.remove(); }
    }
  }

  // mostra(nome) e' la funzione originale che cambia scheda visibile. Qui si
  // impedisce di raggiungere "Rilievi" o "Tutti i punti" finche' manca il
  // negozio, riportando sempre a "Giro" (la scheda "Negozio").
  var _mostra = window.mostra;
  window.mostra = function (nome) {
    if (nome !== 'Giro' && !negozioSelezionato()) {
      toast('Seleziona prima il negozio');
      nome = 'Giro';
    }
    _mostra(nome);
    aggiornaBloccoNegozio();
  };

  // Doppia sicurezza: anche se qualcosa aprisse comunque una finestra foto o
  // la scheda di un punto senza passare dai tab (es. una chiamata diretta),
  // l'azione viene bloccata qui.
  var _apriFotoConNegozio = window.apriFoto;
  window.apriFoto = function (n, et) {
    if (!negozioSelezionato()) { toast('Seleziona prima il negozio'); window.mostra('Giro'); return; }
    _apriFotoConNegozio(n, et);
  };
  var _apriPuntoConNegozio = window.apriPunto;
  window.apriPunto = function (n) {
    if (!negozioSelezionato()) { toast('Seleziona prima il negozio'); window.mostra('Giro'); return; }
    _apriPuntoConNegozio(n);
  };

  // rendiTesta() e' la funzione originale che aggiorna testata, campi del
  // negozio e conteggi: viene chiamata sia da rendiTutto() sia da ogni
  // singolo campo del negozio (insegna, cdc, data, negozio in programma,
  // cambio sessione). E' quindi il punto giusto per tenere aggiornato anche
  // il blocco delle schede, senza dover agganciare ogni singolo handler.
  var _rendiTesta = window.rendiTesta;
  window.rendiTesta = function () {
    _rendiTesta();
    aggiornaBloccoNegozio();
  };

  // Etichetta del tab: resta lo stesso tab "Giro" del taccuino originale
  // (id, logica e dati invariati), ma il testo visibile si chiarisce dato
  // che ora e' il primo passo obbligato.
  (function rinominaTabGiro() {
    var t = document.getElementById('tabGiro');
    if (t) t.textContent = 'Negozio';
  })();

  // Stato iniziale: se la pagina si apre gia' su una sessione senza negozio
  // (primo avvio, o sessione senza dati scelta dal menu), si riporta subito
  // alla scheda "Negozio" invece di lasciare visibile "Rilievi".
  aggiornaBloccoNegozio();
  if (!negozioSelezionato()) { try { window.mostra('Giro'); } catch (e) {} }

  /* -------------------------- svuota memoria -------------------------- */
  // Cancella dalla memoria del telefono (localStorage + foto private
  // dell'app) tutti i sopralluoghi gia' in elenco tranne quello aperto ora,
  // cosi' non restano ad occupare spazio negozi gia' esportati e lavorati.
  async function svuotaMemoria() {
    var altri = (stato.sessioni || []).filter(function (s) { return s.id !== stato.corrente; });
    if (!altri.length) { toast('Nessun altro sopralluogo in memoria da cancellare'); return; }
    var elenco = altri.map(function (s) { return (s.negozio || 'senza nome') + (s.cdc ? ' (' + s.cdc + ')' : ''); }).join('\n· ');
    var ok = window.confirm('Cancellare dalla memoria del telefono ' + altri.length +
      ' sopralluogo/i, oltre a quello aperto ora?\n\n· ' + elenco +
      '\n\nAssicurati di averli gia\' esportati: l\'operazione non si puo\' annullare.');
    if (!ok) return;
    for (var i = 0; i < altri.length; i++) {
      try {
        await Filesystem.rmdir({ path: 'foto_catturate/' + altri[i].id, directory: DIR_DATA, recursive: true });
      } catch (e) { /* nessuna foto per questa sessione: cartella assente */ }
    }
    stato.sessioni = (stato.sessioni || []).filter(function (s) { return s.id === stato.corrente; });
    salva();
    rendiTutto();
    toast('Cancellati ' + altri.length + ' sopralluogo/i dalla memoria del telefono');
  }
  function aggiungiPulsanteSvuota() {
    var rif = document.getElementById('bNuova');
    if (!rif || !rif.parentNode || document.getElementById('bSvuotaMemoria')) return;
    var b = document.createElement('button');
    b.id = 'bSvuotaMemoria'; b.type = 'button';
    b.textContent = 'Svuota memoria (negozi gia\' esportati)';
    b.addEventListener('click', svuotaMemoria);
    rif.parentNode.insertBefore(b, rif.nextSibling);
  }

  // Nel banner (visibile mentre una finestra foto e' aperta) si aggiunge un
  // pulsante per scattare altre foto sullo stesso punto senza doverlo
  // riaprire.
  function aggiungiPulsanteBanner() {
    var banner = document.getElementById('banner');
    var rifBottone = document.getElementById('bNota');
    if (!banner || !rifBottone || document.getElementById('bScattaAncora')) return;
    var b = document.createElement('button');
    b.id = 'bScattaAncora'; b.type = 'button'; b.textContent = '+ Foto';
    b.addEventListener('click', function () {
      if (attivo) scatta(attivo.n, attivo.etichetta);   // "attivo" e' la variabile globale del taccuino (non window.attivo: e' dichiarata con let)
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
      // testoPunto(n) e' gia' definita da app_modello.html: e' il testo del
      // punto di verifica cosi' come compare nella check list (colonna C).
      var voce = (typeof testoPunto === 'function') ? testoPunto(r.n) : '';
      if (voce) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(90);
        var lineeVoce = doc.splitTextToSize(voce.split('\n')[0], 178);
        doc.text(lineeVoce, 14, y); y += lineeVoce.length * 3.8 + 2;
        doc.setTextColor(0);
      }
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
    aggiungiPulsanteSvuota();
    aggiornaBloccoNegozio();
  });
})();
