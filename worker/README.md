# ff-runtracker — posar en marxa el Worker

Uns 5 minuts i tres passos. L'script fa tota la configuració; tu només has d'iniciar sessió a Cloudflare i enganxar el secret de Strava.

## Abans de començar

Cal tenir **Node.js** a l'ordinador. Per saber-ho, obre una terminal (a Windows, *PowerShell*) i escriu `node -v`. Si surt un número, ja el tens. Si no, instal·la la versió LTS de https://nodejs.org i torna a obrir la terminal.

## 1. Baixa el projecte

```
git clone https://github.com/Ffontsere/Runtracker-v2.git
cd Runtracker-v2
```

Si no tens git: a la pàgina del repositori, botó **Code → Download ZIP**. Descomprimeix-lo i obre la terminal dins de la carpeta.

## 2. Executa l'script

```
node worker/setup.mjs
```

L'script fa això, en ordre:

1. Si no tens sessió a Cloudflare, obre el navegador perquè hi entris. Accepta el permís i torna a la terminal.
2. Busca el teu KV `FF_DATA` i el posa a `wrangler.toml`. Si no existeix, el crea.
3. Publica el Worker `ff-runtracker`.
4. Genera la clau de l'app i la desa com a secret.
5. Et demana el **Client Secret** de Strava. És a https://www.strava.com/settings/api: prem *Show*, copia'l i enganxa'l a la terminal. No es veurà mentre l'enganxes.
6. Comprova que el Worker respon.

Al final et mostra dues dades: l'**adreça del Worker** i la **clau de l'app**. Les necessitaràs al Perfil de la v2. La clau també es queda a `worker/.app-key`, que no es puja a GitHub.

Si alguna cosa falla, l'script s'atura i et diu què passa. El pots tornar a executar tantes vegades com vulguis: el que ja estigui fet, no ho repeteix.

## 3. Canvia el domini a Strava

A https://www.strava.com/settings/api, canvia *Authorization Callback Domain* pel domini que t'ha mostrat l'script, que serà semblant a `ff-runtracker.xxxx.workers.dev`.

Aquest pas el pot fer Claude per tu des del teu Chrome: només cal que li ho demanis.

La v1 continuarà sincronitzant amb Strava, perquè per renovar el token no necessita aquest domini. L'únic que no podràs fer és tornar a connectar la v1 si la desconnectes.

## Si cal canviar la clau de l'app

```
node worker/setup.mjs --clau-nova
```

Genera una clau nova i deixa d'acceptar l'anterior. Després l'has d'actualitzar al Perfil de l'app.

---

## Referència

### Què guarda

| Clau a `FF_DATA` | Contingut |
|---|---|
| `runtracker:strava:tokens` | token d'accés, refresh token, caducitat i nom de l'atleta |
| `runtracker:strava:state:*` | estat de 10 minuts mentre connectes |
| `runtracker:sync:strength`, `…:body`, `…:strengthState`, `…:settings` | còpia de la força, el cos i la configuració, amb número de versió |

### Rutes

| Ruta | Qui la crida | Què fa |
|---|---|---|
| `GET /strava/connect?key=…` | el navegador, des del Perfil | envia a Strava per donar permís |
| `GET /strava/callback` | Strava | desa els tokens i torna a l'app amb `#strava=ok` |
| `POST /strava/token` | l'app | dona un token d'accés vàlid (el renova si cal) |
| `POST /strava/disconnect` | l'app | esborra els tokens |
| `GET/PUT /sync/<col>` | l'app | llegeix o desa una col·lecció; respon 409 si un altre mòbil l'ha canviada |

Totes les rutes de l'app demanen `Authorization: Bearer <clau de l'app>` i només accepten l'origen de `APP_URL`.

### Fer-ho a mà, sense l'script

1. `npx wrangler kv namespace list` i posa l'id de `FF_DATA` a `wrangler.toml`.
2. `npx wrangler deploy` (des de la carpeta `worker`).
3. `npx wrangler secret put APP_KEY` amb una clau llarga (per exemple, la sortida de `openssl rand -hex 32`).
4. `npx wrangler secret put STRAVA_CLIENT_SECRET`.
