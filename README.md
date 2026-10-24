# RunTracker v2

Redisseny de RunTracker: mòduls JavaScript sense compilació, motor de càlculs separat de les pantalles.

## Estat

| Fase | Què | Estat |
|---|---|---|
| 1 | Motor de càlculs portat de la v1 i comparat amb ella | Fet: idèntic a la v47 (la versió en ús) amb dades sintètiques i amb la còpia real de 2.018 sortides |
| 2 | Dades (IndexedDB), migració des de `rt4:*`, Worker de Cloudflare, sincronització amb Strava | Fet i provat. Falta publicar el Worker (vegeu `worker/README.md`) |
| 3 | Força i Cos | Motors fets i provats; prototip publicat |
| 4 | Disseny de les pantalles | Pendent |
| 5 | Prova en paral·lel amb la v1 | Pendent |

## Estructura

```
js/engine/      càlculs purs, sense pantalla ni emmagatzematge
  dates.js        dates en hora local
  load.js         TRIMP, CTL/ATL/TSB, ACWR, monotonia, projecció, recuperació, estat
  physio.js       zones Seiler, VO₂max, eficiència, deriva, temps per zona, condicions
  performance.js  marques, predicció, ratxes, millors esforços, resums, informe de bloc
  weather.js      puntuació del clima per hores
  strength.js     força a casa: escales, isomètrics, progressió, fatiga
  body.js         Marina, cintura/alçada, tendències, proteïna
  derive.js       mètriques que surten dels streams (TRIMP exacte, zones, VO₂, deriva)
js/data/        emmagatzematge i sincronització
  db.js           IndexedDB: activitats, streams, força, cos, configuració
  migrate.js      migració des de la v1 (només llegeix rt4:*, mai hi escriu)
  strava.js       sincronització amb Strava i anàlisi dels streams en segon pla
worker/         Worker de Cloudflare ff-runtracker (token de Strava i còpia)
tests/          proves del motor i comparació amb la v1
prototype/      prototip de Força i Cos (es construeix a dist/)
BUGS-v1.md      el que s'ha trobat a la v1 en portar-la
```

Cada funció rep `{ acts, settings, now, tempCache, streamCache }` en lloc de llegir variables globals. Així es poden provar amb qualsevol data d'"avui".

## Decisions

- FC màxima 176 i en repòs 45 (24/10/2026). La migració recalcula amb aquests valors el TRIMP, les zones i el VO₂ de totes les sortides.
- El secret i el refresh token de Strava només són al Worker.

## Proves

```
npm install
npm test
```

`tests/equivalence.test.js` carrega la v1 sencera en un navegador simulat, a l'hora de Barcelona i amb quatre dates d'"avui" diferents. Comprova que cada funció del motor nou dona exactament el mateix que la v1 amb les mateixes dades.

Si poses una còpia de seguretat de la v1 a `tests/private/backup.json`, la comparació també es fa amb les teves dades reals. Aquesta carpeta no es puja mai a GitHub.

El que s'hagi de corregir respecte a la v1 (vegeu `BUGS-v1.md`) es canvia després, amb un test propi, perquè cada número que canviï sigui una decisió.
