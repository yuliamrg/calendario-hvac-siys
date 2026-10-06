# Arquitectura de productos

Decisión vigente de Platform Architecture V2 (completa): SIYS Sync Web y
Calendary CLI son dos clientes ejecutables distintos en el mismo monorepo.
Ambos reutilizan lógica compartida y se comunican directamente por HTTPS con
el mismo backend Supabase. Los workstreams previos materializaron las tres fronteras
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
- `package.json` permanece `private: true`. La distribución es un ZIP
  autónomo mediante GitHub Release y tags `cli-v<version>`.

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

## Identidades independientes

- Web: `apps/web/src/ui/web-version.js > WEB_VERSION = "0.18.1"` (estable
  publicada).
- CLI: `apps/cli/src/version.js > CLI_VERSION = "0.18.0-beta.1"`.
- Manifiestos: `apps/web/package.json` = `0.18.1` y
  `apps/cli/package.json` = `0.18.0-beta.1`, ambos `private: true`.
- La raíz privada no posee versión; `package-lock.json` sólo refleja versiones
  de workspaces, sin identidad de producto raíz.
- Platform usa `0.0.0` interno y privado, sin tags ni releases propios.

Web y CLI tienen versiones independientes. El checker valida cada pareja de
manifiesto/constante sin exigir igualdad entre productos.
El núcleo compartido no exporta `APP_VERSION` ni posee una release de producto.
Se mantienen `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1`, backup
`formatVersion = 1` y `stable-version.txt = web-v0.18.1`.

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

## Workstreams y releases

1. Workstream 1 separó identidades de producto.
2. Workstream 2 separó Web, CLI y Platform físicamente.
3. Workstream 3 completó Architecture V2 con versionado, tags y distribución
   independientes. No se introduce otro workstream ni framework de releases.

Web usa `web-v<version>` y GitHub Pages. Beta se construye desde `main`
(Web `0.18.1`); stable desde `stable-version.txt = web-v0.18.1`. Los
tags históricos `web-v0.17.0`, `web-v0.18.0-beta.2` y `web-v0.18.0` conservan
exactamente los commits de `v0.17.0`, `v0.18.0-beta.2` y `v0.18.0`; los tags
históricos `v...` no se reescriben. El tag certificado `web-v0.18.1` identifica
la release Web estable actual.

CLI usa `cli-v<version>` y GitHub Release. `scripts/build-cli-release.mjs`
copia runtime CLI y Platform desde sus fuentes, sin segunda copia mantenida.
El ZIP incluye la resolución Node del paquete compartido, funciona sin npm
install y no incluye Web, vendor XLSX, migraciones ni configuración cloud.

La CI de PR valida el repositorio completo porque Platform afecta ambos
clientes. No se usan filtros de paths. El checker incluye `apps/cli/bin/` en
la frontera CLI: permite internals CLI y prohíbe Web, persistencia browser y
versión Web. Platform sigue interno y Supabase no cambia.

La primera release CLI `cli-v0.18.0-beta.1` ya está publicada y se conserva sin
cambios en la promoción de Web `0.18.1`; su tag no se mueve.
