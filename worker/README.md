# ff-runtracker — posar en marxa el Worker

Uns 10 minuts. Cal tenir `npx wrangler` amb sessió iniciada al teu compte de Cloudflare.

1. **Id del KV `FF_DATA`.** Executa `npx wrangler kv namespace list`, copia l'`id` de `FF_DATA` i posa'l a `wrangler.toml`, al lloc de `POSA_AQUI_L_ID_DE_FF_DATA`. Les claus d'aquest Worker comencen per `runtracker:` i no es barregen amb les altres.

2. **Clau de l'app.** Genera'n una de llarga i guarda-la al gestor de contrasenyes, perquè l'hauràs d'escriure un cop al Perfil de la v2:
   ```
   openssl rand -hex 32
   npx wrangler secret put APP_KEY
   ```

3. **Secret de Strava.** És el *Client Secret* de https://www.strava.com/settings/api:
   ```
   npx wrangler secret put STRAVA_CLIENT_SECRET
   ```

4. **Publica:** `npx wrangler deploy`. L'adreça serà `https://ff-runtracker.<el-teu-subdomini>.workers.dev`. Si obres l'arrel, ha de respondre `{"ok":true,"app":"ff-runtracker"}`.

5. **Domini de retorn a Strava.** A https://www.strava.com/settings/api, canvia *Authorization Callback Domain* per `ff-runtracker.<el-teu-subdomini>.workers.dev`.
   Strava només admet un domini. La v1 seguirà funcionant mentre no la desconnectis, perquè per renovar el token no necessita el domini; el que deixarà de funcionar és *tornar a connectar* la v1.

## Què guarda

| Clau a `FF_DATA` | Contingut |
|---|---|
| `runtracker:strava:tokens` | token d'accés, refresh token, caducitat i nom de l'atleta |
| `runtracker:strava:state:*` | estat de 10 minuts mentre connectes |
| `runtracker:sync:strength`, `…:body`, `…:strengthState`, `…:settings` | còpia de la força, el cos i la configuració, amb número de versió |

## Rutes

| Ruta | Qui la crida | Què fa |
|---|---|---|
| `GET /strava/connect?key=…` | el navegador, des del Perfil | envia a Strava per donar permís |
| `GET /strava/callback` | Strava | desa els tokens i torna a l'app amb `#strava=ok` |
| `POST /strava/token` | l'app | dona un token d'accés vàlid (el renova si cal) |
| `POST /strava/disconnect` | l'app | esborra els tokens |
| `GET/PUT /sync/<col>` | l'app | llegeix o desa una col·lecció; respon 409 si un altre mòbil l'ha canviada |

Totes les rutes de l'app demanen `Authorization: Bearer <APP_KEY>` i només accepten l'origen de `APP_URL`.
