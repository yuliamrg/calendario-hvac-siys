# Build y release

Platform Architecture V2 está completa. La raíz privada no tiene versión:
orquesta scripts, npm workspaces, bin y Node >=20. Las autoridades son
`apps/web/package.json` + `WEB_VERSION` (candidato Web `0.18.1`; estable
`0.18.0`) y `apps/cli/package.json` + `CLI_VERSION` (`0.18.0-beta.1`). Platform es `0.0.0`
interno. Schema 4, Contract 1, backup formatVersion 1 y Supabase no cambian.

## Manifiesto de la aplicación

El punto de entrada es `apps/web/src/app.js`. `scripts/build.mjs` mantiene un
orden dependencia-primero para los 32 módulos del navegador, tomados de
`apps/web/src` y `packages/platform/src`. Las entradas usan rutas de repositorio:

- Platform dominio: `packages/platform/src/domain/text.js`,
  `domain/responsible-ranking.js`, `domain/dates.js`, `domain/calendar-enums.js`,
  `domain/activity-order.js`, `domain/activity-filters.js`,
  `domain/import-merge.js`, `domain/backup-merge.js`, `domain/csv-export.js`,
  `domain/holidays.js`;
- Platform fachadas y transporte: `packages/platform/src/core.js`,
  `packages/platform/src/calendar-contract.js`,
  `packages/platform/src/supabase/transport.js`;
- Web importación: `apps/web/src/import/xlsx-table.js`,
  `import/workbook-table.js`, `import/programming.js`, `import/base-operativa.js`,
  `importer.js`;
- Web persistencia: `apps/web/src/persistence/indexed-document-store.js`,
  `persistence/json-preferences.js`;
- Web aplicación: `apps/web/src/application/calendar-commands.js`,
  `application/import-commands.js`;
- Web interfaz: `apps/web/src/ui/web-version.js`, `ui/three-motion.js`,
  `ui/calendar-constants.js`, `ui/presentation.js`,
  `ui/activity-presentation.js`, `ui/export-layout.js`,
  `ui/mutation-controller.js`, `ui/view-state.js`;
- Web arranque y adaptador cloud: `apps/web/src/cloud.js`, `apps/web/src/app.js`.

`ui/activity-presentation.js` precede a `ui/export-layout.js` porque el segundo
reutiliza la presentación de actividad. `importer.js` precede a `app.js` y
reexporta las fachadas de `import/`. `ui/three-motion.js` es una entrada
explícita de efectos laterales: instala `globalThis.calendaryThreeMotion` y
`app.js` consume ese global, aunque no exista un import estático entre ambos.

La validación exportada por `scripts/build.mjs` recorre los imports `import` y
`export ... from` de `apps/web/src/app.js` y sus dependencias, resuelve rutas
relativas dentro del workspace y los especificadores
`@siys-sync/platform/...`, y comprueba que cada módulo esté en el manifiesto.
Cualquier otro especificador sin resolver falla cerrado. También rechaza
duplicados y dependencias listadas después de su importador. Que un import
interno se elimine al concatenar no lo convierte en faltante: si su módulo ya
está listado y precede al importador, la relación es válida. Como las líneas de
import se eliminan en el bundle, el artefacto generado no cambia.

La prueba focalizada es `tests/build-manifest.test.mjs`. Comprueba el grafo
actual, el orden de los módulos, la exclusión de `apps/cli/` y una omisión
simulada de `apps/web/src/ui/export-layout.js`.

## Qué genera el build

El comando `npm run build` ejecuta `scripts/build.mjs` y:

1. lee `apps/web/src/index.template.html`, los estilos
   `apps/web/src/styles.css`, `apps/web/src/styles/responsive.css` y
   `apps/web/src/styles/channel-contract.css`;
2. incluye localmente `apps/web/vendor/xlsx.full.min.js`,
   `node_modules/three/build/three.cjs`, `apps/web/vendor/LICENSE.txt`,
   `apps/web/vendor/NOTICE.txt` y `apps/web/src/assets/siys-sync-icon.svg`;
3. valida los marcadores de la plantilla, la ausencia de dependencias remotas,
   la sintaxis del bundle JavaScript y la ausencia de marcadores sin resolver;
4. escribe dos HTML autocontenidos e idénticos:
   `dist/calendario-hvac-siys.html` y `dist/index.html`.

Sin `SIYS_SUPABASE_URL` y
`SIYS_SUPABASE_PUBLISHABLE_KEY`, la configuración embebida deja Supabase
desactivado. El workflow de Pages suministra esas variables para sus builds;
sólo se admite la clave publishable en el frontend, nunca una `service_role` ni
una contraseña de Postgres.

Los archivos de `dist/` son salidas generadas y no se editan manualmente. La
rama de release regenera ambos HTML desde las fuentes después de actualizar la
versión; el resultado local debe quedar sin diferencias después del build.
Esto no certifica el despliegue remoto, por lo que CI y los smokes autorizados
deben repetirse después de integrar.

## Web: GitHub Pages

`web-v<version>` identifica el commit productor de la release Web.
`npm run release:web:check` valida el tag, sus fuentes y los dos HTML
etiquetados. Compara el hash del HTML actual con el etiquetado cuando no se
usa `--skip-dist`; no exige que el tag apunte a HEAD, porque infraestructura
posterior puede conservar la misma release. `--tag web-v<version>` permite
indicar explícitamente el tag y `--require-stable-tag` comprueba el puntero.
Los aliases históricos anteriores a workspaces se leen en sus rutas originales.

Pages se ejecuta con push a `main`: la raíz se construye desde el tag
`web-v0.18.0` señalado por `stable-version.txt` y `/beta/` desde `main`. Las
copias del HTML estable a Pages se comparan byte a byte. Los tags no disparan
builds ni GitHub Releases; no hay Web GitHub Release.

## CLI: GitHub Release

`npm run build:cli-release` produce staging limpio en
`releases/calendary-cli-0.18.0-beta.1/` (ignorado por Git). Para un destino
temporal nuevo: `npm run build:cli-release -- --out <directorio>`.
El builder valida versión y dependencias, copia únicamente runtime JS de
CLI y Platform, rechaza archivos inesperados/symlinks y normaliza EOL a LF.
Genera metadata privada y README.txt; no usa dependencias nuevas.

```text
calendary-cli-0.18.0-beta.1/
  package.json
  README.txt
  bin/calendary.js
  src/...
  node_modules/@siys-sync/platform/
    package.json
    src/...
```

El usuario descarga y extrae el ZIP, instala Node.js >=20 y ejecuta
`node bin/calendary.js --version` / `node bin/calendary.js --help`.
No requiere workspace install ni clonar. No contiene Web, vendor XLSX,
migraciones, fixtures, secretos o URL/key Supabase; recibe configuración por
el modelo existente de entorno/CLI.

`.github/workflows/cli-release.yml` sólo responde a push de `cli-v*`.
Hace checkout exacto del tag, npm ci, `release:cli:check`, arquitectura,
pruebas completas y CLI/shared, staging y smoke. Comprime con ZIP del runner,
normaliza timestamps y calcula SHA-256. Publica ZIP + checksum con
`gh release create --verify-tag`; beta se marca prerelease y no latest.
Título: `Calendary CLI 0.18.0-beta.1`. `contents: write` sólo está en el job
que publica; no hay auth npm. npm publish queda diferido porque el canal
requerido es ZIP autónomo y no necesita un registro adicional.

`npm run release:cli:check -- --tag cli-v<version>` exige manifiesto/constante
y commit HEAD exactos. En Actions también comprueba GITHUB_REF/GITHUB_SHA.
Una release CLI no depende de dist Web ni de tags Web.

## Validación y CI

```powershell
npm ci
npm test
npm run architecture:check
npm run build
npm run build:cli-release
npm run version:check
npm run audit
npm run test:cli
npm run goal:check
git diff --check
```

`test:cli-release` construye dos paquetes temporales fuera del workspace,
compara inventario/bytes, resuelve todos los imports dentro del paquete,
ejecuta versión/ayuda y solicitud inválida con fetch bloqueado.
La CI de PR conserva validación completa, sin filtros de paths.
Actions: checkout v7, setup-node v7, configure-pages v6,
upload-pages-artifact v5 y deploy-pages v5. El runtime de producto sigue Node 20.

## Reproducibilidad Windows

El builder Web normaliza CRLF a LF al escribir la composición y antes de
codificar el SVG en base64. Esto incluye los literales del propio builder.
Con core.autocrlf=true y la misma configuración pública de CI, el mismo
contenido produce los mismos bytes tanto con LF como con CRLF. El SHA-256
también depende de la configuración pública embebida: el artefacto
`0.18.0-beta.2` fue
`ED6F3202AAFB15B8BA175E93F137F78698D867CD5FD3E20B90F3A80CB3FA90A1`; Web estable
`0.18.0` tiene el SHA-256
`001CFA87502818311B18EB68AF5E3259D556644FD68A29666F2E3A14620DE468`; la beta
`0.18.1-beta.1` fue
`51770F50DCABFC16517AF12A00B5600498979251992054D5DEDC5C4EA9AA3A8B` y el
candidato estable `0.18.1` tiene
`FA62BC0FE53557223C71345DA559023A6EEB46F1D70FC227D10DF8D1D327B063` bajo la
misma configuración pública de build. La verificación definitiva del hash
corresponde a CI con esa configuración.
Sin configuración Supabase se produce intencionalmente otro HTML local.

## Migración y Human Merge Gate

Tags `v...`: historial inmutable. Los tags históricos `web-v0.17.0` y
`web-v0.18.0-beta.2` conservan sus commits, resueltos mediante
`git rev-parse <tag>^{commit}`. `web-v0.18.0` ya identifica la release Web
certificada en el merge commit `a9c946e934f7cb9ac3609f22ed6c0d2f373a3651`.
La release CLI `cli-v0.18.0-beta.1` ya está publicada y no se mueve. El
candidato Web `0.18.1` todavía no se etiqueta como `web-v0.18.1`: la promoción
de stable queda supeditada al Human Gate y no forma parte de esta preparación.
Web no
crea GitHub Release; el PR de promoción actualiza el puntero y esta documentación,
y su merge dispara el despliegue automático de Pages.
