# Arquitectura de productos

Decisión vigente de Platform Architecture V2, Workstream 1: SIYS Sync Web y
Calendary CLI son dos clientes ejecutables distintos en el mismo monorepo.
Ambos reutilizan lógica compartida y se comunican directamente por HTTPS con
el mismo backend Supabase. Este workstream separa las identidades de versión
y conserva las fronteras físicas existentes.

```text
                     Shared calendar code
               domain / core / contract / transport
                         /             \
                        /               \
                SIYS Sync Web      Calendary CLI
                   Browser             Node.js
                        \               /
                         \    HTTPS     /
                          \           /
                            Supabase
                    Auth + PostgREST + RPC
                              |
                          PostgreSQL
```

## SIYS Sync Web

- Runtime: navegador; entrada `src/app.js`.
- Distribución actual: HTML autocontenido generado por `scripts/build.mjs`.
- Hosting público: GitHub Pages. Beta se construye desde `main`; stable
  desde el tag señalado por `stable-version.txt`.
- El archivo abierto localmente conserva IndexedDB. Los canales públicos
  configurados usan Supabase directamente por HTTPS.
- El manifiesto HTML excluye `src/cli/*` y `bin/calendary.js`.

## Calendary CLI

- Runtime: Node.js >=20; entry point `bin/calendary.js`; código `src/cli/*`.
- Se ejecuta localmente desde el repositorio / entorno Node y se comunica
  directamente con Supabase por HTTPS, usando Auth normal, sin service role.
- Supabase es su única autoridad de calendario. Los archivos son operandos
  o salidas, no una fuente de estado alternativa.
- No está embebida en el HTML ni desplegada o servida por GitHub Pages.
- No tiene todavía un canal de distribución independiente formal;
  `package.json` permanece `private: true`.

## Shared Calendar Platform

`src/domain/*`, `src/core.js` y `src/calendar-contract.js` definen reglas,
modelo y operaciones compartidas. `src/supabase/transport.js` aporta el
transporte HTTPS reutilizado por browser y CLI. Las reglas compartidas deben
conservar estas fronteras y no duplicarse entre clientes; DOM e IndexedDB son
adaptadores del navegador, mientras argumentos y sesión Node son de la CLI.

## Supabase Backend

Supabase aporta Auth, PostgREST, RPC y PostgreSQL. Las migraciones viven bajo
`supabase/migrations/`. El RPC `persist_calendar_document` persiste documento
con CAS y sincroniza metadata en una transacción. El backend es común a ambos
clientes; Web stable y beta conservan calendarios lógicos separados.

## Identidades independientes, transición actual

- Web: `src/ui/web-version.js > WEB_VERSION = "0.18.0-beta.1"`.
- CLI: `src/cli/version.js > CLI_VERSION = "0.18.0-beta.1"`.
- `package.json.version` sigue representando la release Web/repositorio y debe
  coincidir con `WEB_VERSION`; `package-lock.json` conserva su espejo.

La igualdad actual Web/CLI es coincidental y transitoria. Las pruebas cambian
la fuente CLI en una copia temporal y comprueban `--version` y los gates Web,
sin exigir igualdad. No se selecciona una primera release CLI independiente.
El núcleo compartido no exporta `APP_VERSION` ni posee una release de producto.
Se mantienen `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1`, backup
`formatVersion = 1` y `stable-version.txt = v0.17.0`.

## Semántica del documento y del respaldo

`document.appVersion` es metadato legado opaco, conservado por compatibilidad
histórica. No determina compatibilidad de documento o backend, productor ni
último escritor. `document.schemaVersion` sigue siendo la autoridad para leer
el documento; `formatVersion` lo es para la envoltura JSON.

Web pasa su versión explícitamente al crear documentos nuevos. Construcción
neutral y sanitización de un valor ausente/inválido usan `""`, sin inventar una
identidad. Las mutaciones normales Web/CLI, importaciones, undo y traslado local
a cloud conservan el valor. Restore conserva el del respaldo; merge conserva
el del documento actual. No hay migración ni nuevo campo.

El `appVersion` superior de un backup describe al ejecutable Web exportador:
Web pasa `exporterVersion: WEB_VERSION` a `createBackupEnvelope`. La utilidad
compartida no obtiene versiones de clientes; sin exportador explícito usa `""`.
Un envelope Web actual puede contener un documento con `appVersion` antiguo.

## Workstreams pendientes

Workstream 2 implementará la estructura física futura. No se crean `apps/`,
`packages/`, workspaces ni otro `package.json` en Workstream 1.

Workstream 3 definirá distribución/releases CLI independientes y los namespaces
`web-v...` / `cli-v...`. Actualmente la CLI se usa desde el repositorio Node,
sin distribución independiente. No se crea ZIP, npm release ni GitHub Release.

## Tags y publicación vigentes

El modelo histórico `v<version>` sigue siendo temporalmente autoritativo para
Web/repositorio. Los tags certificados `v0.17.0` y `v0.18.0-beta.1` permanecen
intactos. Este refactor no modifica ni republica las versiones certificadas.
`release:check` conserva los gates del tag estable y del tag Web actual
sobre HEAD cuando se solicita `--require-current-tag`; una rama de refactor no
es un nuevo tag de release. Pages mantiene sus triggers y stable conserva
el puntero `v0.17.0`. No se modifica Supabase ni la topología CI.
