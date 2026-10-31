# Coses trobades a la v1 (v47) en portar el motor

El motor de la v2 reprodueix la v1 exactament, errors inclosos, perquè la comparació demostri que el port és fidel.
Cada punt d'aquesta llista es corregeix després, un per un, amb el seu test, perquè cada canvi de número sigui deliberat.

| # | Gravetat | Què passa | On | Proposta per a la v2 |
|---|---|---|---|---|
| 1 | Alta | En arrencar, la migració `rt4:vo2fix` s'executa abans de `load()` i desa una llista d'activitats buida. En un mòbil nou o amb les dades del navegador esborrades, obrir l'app esborra totes les activitats guardades. Les sortides es recuperen de Strava, però l'RPE, les sensacions i les temperatures manuals es perden. Al mòbil actual no passa perquè la migració ja es va fer. | `index.html`, bloc INIT | La v2 no reutilitza aquest arrencada. La migració des de `rt4:*` només llegeix i no escriu mai a les claus de la v1. |
| 2 | Mitjana | Les "marques" (1 km, 5 km, 10 km…) són el ritme mitjà de la sortida més ràpida que supera la distància, multiplicat per la distància. Un 10 km fet dins d'una tirada de 15 km no compta com a 10 km; un 1 km és el ritme mitjà d'una sortida sencera. | `calcPRs` | Fer servir els millors esforços dels streams (`be`), que ja es calculen. |
| 3 | Baixa | La predicció anomenada "VDOT" és Riegel amb exponent 1,07, no Daniels. La mitjana "Riegel + VDOT" és la mitjana de dos Riegel. | `vdotPredict`, `calcMultiPredict` | Canviar-ne el nom o fer servir el VDOT de debò (`vdotFromEffort` invers). |
| 4 | Baixa | Hi ha dos estats d'entrenament amb llindars diferents: `getStatus` (tendència del CTL) i `trainingStatus` (TSB i ACWR). | Resum, Fitness | Quedar-se'n un. |
| 5 | Baixa | L'"Easy TRIMP recomanat" només existeix com a text d'ajuda: no hi ha cap càlcul al darrere. A l'inventari està marcat *Es queda*. | glossari `easytr` | Decidir si es crea o es treu de l'inventari. |
| 6 | Baixa | La monotonia fa servir 28 dies, però si hi ha una sortida just fa 28 dies afegeix un dia 29 a la mitjana. | `calcMonotony` | Filtrar `< 28`. |
| 7 | Baixa | Una activitat sense `hrZone` (no nul·la, sinó absent) fa que la distribució per zones doni NaN. Només afecta activitats molt antigues. | `getZoneDist` | Tractar absent com a nul. |
| 8 | Baixa | Els dies es compten a partir de la mitjanit UTC: entre les 00:00 i les 02:00 (01:00 a l'hivern), una sortida d'avui compta com si fos de demà i queda fora de l'ACWR fins que passa aquesta hora. | `dS` | Comptar dies en hora local. |
| 9 | Documentació | L'inventari diu que l'ACWR és "setmana actual sobre la mitjana de 4 setmanes", però la v1 fa servir mitjanes exponencials (Williams), que és millor. | inventari | Corregir el text. |

Els punts 1 i 2 són els que canvien més el que veus. Els altres són detalls.

## Minuts en Z4–Z5 al resum de la sessió

`sessionSummary` divideix `tiz[3] + tiz[4]` per 60, però `tiz` ja és en minuts. Una sessió amb 12 min a Z4–Z5 dona `Math.round(0,2) = 0` i la frase «Uns X min en Z4-Z5» no surt mai. La v2 fa servir els minuts directament (`js/engine/activity.js`).

## Corregits a la v2 (pestanya Progrés, 24/10/2026)

- **#2 Marques:** `personalBests` (`js/engine/progress.js`) també fa servir els millors esforços dels streams. Per a cada distància es queda el temps més ràpid entre la sortida sencera (com la v1) i el millor tram, marcat com a «tram» i ajustat al pendent. Mai surt pitjor que a la v1 (hi ha un test que ho comprova).
- **#3 Predicció:** `predictions` fa servir el VDOT de Daniels de debò (invertit per bisecció) i, al costat, Riegel amb l'exponent personal. La referència és la marca de 5 km a la mitja amb més VDOT dels últims 12 mesos.
- **#7 Zones:** la distribució per zones de Progrés deixa fora les sortides sense zona i ja no dona NaN.

## Corregit a la v2 (pestanya Clima, 24/10/2026)

- **Hora de la temperatura de cada sortida:** `fetchActTemp` feia `new Date(a.startTime).getHours()`, però Strava dona l'hora local amb una «Z» al final. El navegador la llegia com a UTC i a Barcelona agafava la temperatura de 2 hores més tard a l'estiu (1 a l'hivern). La v2 llegeix l'hora directament de la cadena (`js/data/weather.js`, `fetchActivityWx`). Les temperatures ja desades a la v1 no es tornen a demanar.

## Corregits a la v2 (càrrega, 31/10/2026)

Cada punt té el seu test a `tests/bugs-v1.test.js`.

- **#4 Dos estats d'entrenament:** s'ha tret `getStatus` (tendència del CTL), que cap pantalla de la v2 feia servir. Només queda `trainingStatus` (TSB i ACWR). La comparació amb la v1 a `equivalence.test.js` ja no inclou `getStatus`.
- **#6 Monotonia de 28 dies:** `calcMonotony` filtra `< 28`, així el dia 28 ja no hi entra com a 29è dia. La comparació amb la v1 es fa contra la v1 sense les sortides d'aquell dia.
- **#8 Dies en hora local:** `daysAgo` compta dies de calendari en hora local. Abans, entre les 00:00 i les 02:00 (01:00 a l'hivern) una sortida d'avui sortia amb -1 dies i quedava fora de l'ACWR i del CTL fins que passava aquesta hora. Només canvia el resultat dins d'aquesta franja.

- **#5 Easy TRIMP recomanat:** creat a `js/engine/easy.js` i mostrat a Avui (targeta «Sessió fàcil d'avui»). Rang = sessió mitjana de les últimes 4 setmanes (CTL × 7 entre els dies que has sortit) × una fracció que depèn de l'estat (`EASY_FRACTION`: fresc 70–100 %, assimilant 60–90 %, carregat 50–75 %, sobrecarregat 30–50 %), limitat perquè l'ACWR de després no passi d'1,3. Si ja hi passa, diu «Millor descansar». Els minuts surten del TRIMP per minut a la meitat de la teva Z2. Els percentatges són una heurística, per calibrar amb l'historial.

Nota sobre el #8: hi ha altres comptes de dies amb `Date.parse(a.date)` (finestres de 365 dies a `migrate.js` i `strava.js`, i la finestra de `climate.js`). Només es desvien unes hores a la vora del límit, així que no s'han tocat.
