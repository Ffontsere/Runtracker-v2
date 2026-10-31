# RunTracker v2

Redisseny de RunTracker: mòduls JavaScript sense compilació, motor de càlculs separat de les pantalles.

## Estat

| Fase | Què | Estat |
|---|---|---|
| 1 | Motor de càlculs portat de la v1 i comparat amb ella | Fet: idèntic a la v47 (la versió en ús) amb dades sintètiques i amb la còpia real de 2.018 sortides |
| 2 | Dades (IndexedDB), migració des de `rt4:*`, Worker de Cloudflare, sincronització amb Strava | Fet, provat i Worker publicat (ff-runtracker.ffontsere.workers.dev) |
| 3 | Força i Cos | Fet a l'app, amb còpia automàtica al Worker |
| 4 | Disseny de les pantalles | Fet: les 6 pestanyes i el Perfil, publicades a ffontsere.github.io/Runtracker-v2 |
| 5 | Prova en paral·lel amb la v1 | Pendent |

## Estructura

```
index.html      l'app (GitHub Pages)
sw.js           service worker: sempre l'última versió amb connexió, i l'app s'obre sense
css/app.css     estil comú, clar i fosc
js/app.js       arrencada i navegació (#/avui … #/perfil)
js/ui/          pantalles (profile.js, today.js, strength.js, body.js, activities.js, progress.js, climate.js), gràfics (chart.js) i ajudes (dom.js)
js/engine/      càlculs purs, sense pantalla ni emmagatzematge
  dates.js        dates en hora local
  load.js         TRIMP, CTL/ATL/TSB, ACWR, monotonia, projecció, recuperació, estat
  physio.js       zones Seiler, VO₂max, eficiència, deriva, temps per zona, condicions
  performance.js  marques, predicció, ratxes, millors esforços, resums, informe de bloc
  weather.js      puntuació del clima per hores
  strength.js     força a casa: escales, isomètrics, progressió, fatiga
  body.js         Marina, cintura/alçada, tendències, proteïna
  activity.js     llista i detall de sortides: resum de la sessió, avaluació, semblants, període
  progress.js     forma i projecció, volum, marques (amb trams), predicció VDOT i Riegel, VO₂ setmanal
  climate.js      millor hora de cada dia, hora a hora, sortides sense el temps del dia
  schedule.js     quina sessió de força toca, setmanes regulars, dia de la llarga
  today.js        resum d'Avui i millor hora per córrer
  wellness.js     senyals de Garmin (HRV, FC en repòs, son) contra la teva base de 28 dies; no toca l'Estat
  easy.js         TRIMP recomanat per a una sessió fàcil: sessió mitjana × fracció segons l'estat, amb límit d'ACWR 1,3
  derive.js       mètriques que surten dels streams (TRIMP exacte, zones, VO₂, deriva)
js/data/        emmagatzematge i sincronització
  db.js           IndexedDB: activitats, streams, força, cos, configuració
  migrate.js      migració des de la v1 (només llegeix rt4:*, mai hi escriu)
  strava.js       sincronització amb Strava i anàlisi dels streams en segon pla
  config.js       Worker, clau de l'app i estat de la sincronització
  strength.js     sessions de força, esborrany i nivells
  body.js         mesures del cos
  notes.js        RPE, sensacions, cursa i temperatura de cada sortida (viatgen a la còpia)
  sync.js         còpia de força, cos i configuració al Worker (combina per id, guanya el més recent)
  weather.js      previsió d'Open-Meteo amb cache d'1 hora
  garmin.js       baixa el benestar de Garmin del Worker i el desa al mòbil
  recalc.js       recàlcul de totes les sortides quan canvia la FC
worker/         Worker de Cloudflare ff-runtracker (token de Strava, còpia i benestar de Garmin)
scripts/        Python de Garmin: garmin_login.py (una vegada), garmin_sync.py (Action) i garmin_extract.py
.github/        Action «Garmin sync» (veure worker/README.md)
tests/          proves del motor i comparació amb la v1
prototype/      prototip de Força i Cos (es construeix a dist/)
BUGS-v1.md      el que s'ha trobat a la v1 en portar-la
```

Cada funció rep `{ acts, settings, now, tempCache, streamCache }` en lloc de llegir variables globals. Així es poden provar amb qualsevol data d'"avui".

## Decisions

- FC màxima 176 i en repòs 45 (24/10/2026). La migració recalcula amb aquests valors el TRIMP, les zones i el VO₂ de totes les sortides.
- El secret i el refresh token de Strava només són al Worker.
- Clima (24/10/2026): el tipus de sortida que es puntua surt dels hàbits. El dia habitual de la llarga és Llarga i la resta Fàcil; a l'Avui es pot canviar per a aquell dia.
- Força, cos i configuració (pes, alçada, dies de força, objectius) es copien soles al Worker en obrir l'app i en desar. La ubicació i la FC es queden a cada mòbil. Un esborrat es desa com a marca perquè arribi a la còpia.

## Proves

```
npm install
npm test
```

`tests/equivalence.test.js` carrega la v1 sencera en un navegador simulat, a l'hora de Barcelona i amb quatre dates d'"avui" diferents. Comprova que cada funció del motor nou dona exactament el mateix que la v1 amb les mateixes dades.

Si poses una còpia de seguretat de la v1 a `tests/private/backup.json`, la comparació també es fa amb les teves dades reals. Aquesta carpeta no es puja mai a GitHub.

El que s'hagi de corregir respecte a la v1 (vegeu `BUGS-v1.md`) es canvia després, amb un test propi, perquè cada número que canviï sigui una decisió.
