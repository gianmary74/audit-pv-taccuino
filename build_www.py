import json, os

SRC = 'taccuino-src'
OUT = 'www'

modello = open(os.path.join(SRC, 'app_modello.html'), encoding='utf-8').read()
punti = open(os.path.join(SRC, 'punti.json'), encoding='utf-8').read().strip()
rilievi = json.load(open(os.path.join(SRC, 'rilievi.json'), encoding='utf-8'))
negozi = json.load(open(os.path.join(SRC, 'negozi.json'), encoding='utf-8'))

def j(x):
    return json.dumps(x, ensure_ascii=False, separators=(',', ':'))

pagina = (modello.replace('__PUNTI__', punti)
                 .replace('__TILES__', j(rilievi))
                 .replace('__NEGOZI__', j(negozi)))

k = pagina.index('</style>') + len('</style>')
extra_head = (
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="theme-color" content="#B4530A">\n'
    '<style>html{color-scheme:light dark}body{margin:0}img{max-width:100%}'
    '[hidden]{display:none!important}</style>\n'
)
extra_scripts_before_body_end = (
    '\n<script src="vendor/jspdf.umd.min.js"></script>\n'
    '<script src="vendor/fflate.umd.js"></script>\n'
    '<script src="native-bridge.js"></script>\n'
)

completo = ('<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,'
            'viewport-fit=cover">\n'
            + extra_head
            + pagina[:k] + '\n</head>\n<body>\n' + pagina[k:]
            + extra_scripts_before_body_end
            + '\n</body>\n</html>\n')

os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(completo)
print('scritto www/index.html (%d punti, %d piastrelle, %d negozi)'
      % (len(json.loads(punti)), len(rilievi), len(negozi)))
