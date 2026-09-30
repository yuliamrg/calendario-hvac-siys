# Arquitectura de productos

Decisión vigente para la preparación de `0.18.0-beta.1`: SIYS Sync Web y
Calendary CLI son dos clientes ejecutables distintos en el mismo monorepo.
Ambos reutilizan lógica compartida y se comunican directamente por HTTPS con
el mismo backend Supabase. Esta fase documenta las fronteras existentes y no
reorganiza archivos ni cambia comportamiento.

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

## Versión conjunta actual

`package.json > version` y `src/core.js > APP_VERSION` versionan conjuntamente
el producto/release del repositorio y, por extensión, la CLI incluida. Esta
asociación es una limitación actual deliberadamente conservada para
`0.18.0-beta.1`. Se mantienen `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1`
y los respaldos. Stable sigue apuntando a `v0.17.0`.

## Dirección futura diferida

Mantener el monorepo es correcto. Una posible evolución, aún no implementada
ni obligatoria de inmediato, es:

```text
apps/web
apps/cli
packages/calendar
packages/supabase
supabase/
```

Se evaluarán versiones Web y CLI independientes, y distribución CLI mediante
npm privado/público, GitHub Releases, instalador u otro mecanismo que se decida
posteriormente. No se elige un canal ahora. La compatibilidad se expresará
principalmente mediante `SCHEMA_VERSION`, `CONTRACT_VERSION` y el contrato
backend. El desacoplamiento de versiones, packages y workspaces queda diferido.

## Preparación y publicación

La feature `feat/cli-cloud-client` prepara `0.18.0-beta.1` antes del PR.
Su integración en `main` permitirá a Pages construir `/beta/` desde esa
versión. Esta preparación no acredita despliegue ni crea el tag beta; el tag
se crea después de integrar el PR. La raíz stable continúa desde
`stable-version.txt = v0.17.0`.
