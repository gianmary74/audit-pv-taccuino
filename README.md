# Taccuino Sopralluogo — app Android

Wrapper Capacitor del taccuino di campo della skill `audit-sicurezza-pv`.
La pagina in `www/index.html` è generata da `build_www.py` a partire da
`taccuino-src/` (lo stesso modello che la skill usa per la versione HTML/PWA):
non si modifica a mano, si rigenera.

## Aggiornare il contenuto (punti, rilievi, negozi)

Sostituisci i file in `taccuino-src/` con l'ultima versione prodotta dalla
skill (`assets/taccuino/`), poi:

```
python3 build_www.py
```

e fai commit. Il push su `main` avvia da solo la compilazione dell'APK
(vedi Actions → Build APK → scarica l'artefatto `taccuino-sopralluogo-debug-apk`).

## Cosa fa in più rispetto alla versione HTML

Dentro l'app (non nel browser) compare un pulsante "Esporta e condividi":
scrive nella cartella privata dell'app tre file per il negozio corrente —
l'HTML di lavoro (uguale a quello che il taccuino salva sempre), il JSON
di esportazione (quello che `step5t_fondi_taccuino.py` legge) e un PDF di
sintesi grezza generato sul telefono — li impacchetta in uno `.zip` e apre
il foglio di condivisione nativo di Android, per mandarli dove si vuole
(pCloud, mail, ecc.) senza bisogno di alcuna chiave o token nell'app.

Le foto restano nella libreria del telefono come sempre: il taccuino
registra solo le finestre orarie con cui vengono abbinate ai punti durante
la lavorazione della campagna (passo 5t della skill), non le incorpora.
