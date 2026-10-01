# Arquitectura de productos

Decisión vigente de Platform Architecture V2, Workstream 2: SIYS Sync Web y
Calendary CLI son dos clientes ejecutables distintos en el mismo monorepo.
Ambos reutilizan lógica compartida y se comunican directamente por HTTPS con
el mismo backend Supabase. Este workstream materializa las tres fronteras
físicas con npm workspaces privados (`apps/web`, `apps/cli`, `packages/platform`)
conservando el mismo comportamiento observable y el mismo artefacto HTML.

```text
apps/
  web/        @siys-sync/web      (navegador)
  cli/        @siys-sync/cli      (Node.js)
packages/
  platform/   @siys-sync/platform (dominio + contrato + transporte)
supabase/     migraciones y backend
```

Dirección de dependencias: Web → Platform y CLI → Platform. Platform no depende
de Web ni de CLI, y Web y CLI no se importan entre sí.

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

- Workspace `apps/web`, paquete privado `@siys-sync/web`; entrada
  `apps/web/src/app.js`.
- Distribución actual: HTML autocontenido generado por `scripts/build.mjs`.
- Hosting público: GitHub Pages. Beta se construye desde `main`; stable
  desde el tag señalado por `stable-version.txt`.
- El archivo abierto localmente conserva IndexedDB. Los canales públicos
  configurados usan Supabase directamente por HTTPS.
- El manifiesto HTML sólo incluye Web + Platform; excluye por completo
  `apps/cli/src/*` y `apps/cli/bin/calendary.js`.

## Calendary CLI

- Workspace `apps/cli`, paquete privado `@siys-sync/cli`; entry point
  `apps/cli/bin/calendary.js`; código `apps/cli/src/*`.
- Se ejecuta localmente desde el repositorio / entorno Node y se comunica
  directamente con Supabase por HTTPS, usando Auth normal, sin service role.
- Supabase es su única autoridad de calendario. Los archivos son operandos
  o salidas, no una fuente de estado alternativa.
- No está embebida en el HTML ni desplegada o servida por GitHub Pages.
- No tiene todavía un canal de distribución independiente formal;
  `package.json` permanece `private: true`.

## Shared Calendar Platform

Workspace `packages/platform`, paquete privado `@siys-sync/platform` con
identidad interna `0.0.0` sin ciclo de release. Expone únicamente las entradas
consumidas por las apps (`./core.js`, `./calendar-contract.js`,
`./domain/text.js`, `./domain/dates.js`, `./domain/calendar-enums.js`,
`./domain/responsible-ranking.js`, `./supabase/transport.js`).
`packages/platform/src/domain/*`, `core.js` y `calendar-contract.js` definen
reglas, modelo y operaciones compartidas. `packages/platform/src/supabase/transport.js`
aporta el transporte HTTPS reutilizado por browser y CLI. Las reglas
compartidas deben conservar estas fronteras y no duplicarse entre clientes; DOM
e IndexedDB son adaptadores del navegador, mientras argumentos y sesión Node son
de la CLI. Platform permanece ejecutable en navegador y Node y no puede importar
DOM, IndexedDB, `localStorage`, sistema de archivos Node, parseo de CLI, UI ni
identidad de producto.

## Supabase Backend

Supabase aporta Auth, PostgREST, RPC y PostgreSQL. Las migraciones viven bajo
`supabase/migrations/`. El RPC `persist_calendar_document` persiste documento
con CAS y sincroniza metadata en una transacción. El backend es común a ambos
clientes; Web stable y beta conservan calendarios lógicos separados.

## Identidades independientes, transición actual

- Web: `apps/web/src/ui/web-version.js > WEB_VERSION = "0.18.0-beta.2"`.
- CLI: `apps/cli/src/version.js > CLI_VERSION = "0.18.0-beta.1"`.
- Manifiestos: `apps/web/package.json` = `0.18.0-beta.2` y
  `apps/cli/package.json` = `0.18.0-beta.1`, ambos `private: true`.
- `package.json.version` sigue representando la release Web/repositorio y debe
  coincidir con `WEB_VERSION`; `package-lock.json` conserva su espejo.
- `packages/platform/package.json` usa `0.0.0` como identidad de mecánica de
  workspace; no es una versión de release.

Web y CLI ya tienen valores distintos: esta es la primera prueba real de
identidades independientes. Las pruebas también conservan un caso temporal
hipotético para comprobar `--version` y los gates Web. No se selecciona una
primera release CLI independiente.
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

## Workstreams

Workstream 2 (este) materializó la estructura física `apps/web`, `apps/cli` y
`packages/platform` con npm workspaces privados, límites verificados por
`scripts/architecture-check.mjs` y el mismo artefacto HTML certificado. No hay
framework de monorepo ni bundler.

Workstream 3 definirá distribución/releases CLI independientes y los namespaces
`web-v...` / `cli-v...`. Actualmente la CLI se usa desde el repositorio Node,
sin distribución independiente ni publicación npm. No se crea ZIP, npm release
ni GitHub Release. La topología CI y Pages siguen siendo las de Workstream 1.

## Tags y publicación vigentes

El modelo histórico `v<version>` sigue siendo temporalmente autoritativo para
Web/repositorio. `v0.18.0-beta.1` permanece como snapshot histórico inmutable;
la integración de Workstream 1 publica Web `0.18.0-beta.2` porque Pages se
despliega con cada push a `main`. El tag `v0.18.0-beta.2` se crea después de
integrar, sobre el commit integrado. Calendary CLI permanece en
`0.18.0-beta.1`.
`release:check` conserva los gates del tag estable y del tag Web actual
sobre HEAD cuando se solicita `--require-current-tag`; una rama de refactor no
es un nuevo tag de release. Pages mantiene sus triggers y stable conserva
el puntero `v0.17.0`. No se modifica Supabase ni la topología CI. Workstream 3
sigue pendiente.
