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
