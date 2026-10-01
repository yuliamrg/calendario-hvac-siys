# Build, distribución y releases

## Alcance y corte verificado

Este documento describe Workstream 2 de Platform Architecture V2 desde el main
certificado `0fc36da64fb69b5ccb09eb93edeb31473cd4e104`. La reorganización física
introduce `apps/web`, `apps/cli` y `packages/platform` como npm workspaces
privados; el artefacto público generado se conserva byte a byte idéntico al
certificado. Web publica `0.18.0-beta.2`; CLI conserva `0.18.0-beta.1`. Stable
sigue en `v0.17.0` y `v0.18.0-beta.1` conserva su snapshot histórico.

## Fuentes autoritativas

| Dato | Fuente autoritativa | Hecho verificado |
| --- | --- | --- |
| Release Web/repositorio | `package.json`, campo `version` | `0.18.0-beta.2`; no versiona CLI |
| Versión de Calendary CLI | `apps/cli/src/version.js`, `CLI_VERSION` y `apps/cli/package.json` | `0.18.0-beta.1`, independiente de Web |
| Versión Web visible y del exportador de respaldos | `apps/web/src/ui/web-version.js`, `WEB_VERSION` y `apps/web/package.json` | `0.18.0-beta.2`, igual a `package.json` |
| Identidad de workspace Platform | `packages/platform/package.json` | `0.0.0`, privada y sin release |
| Espejo de npm | `package-lock.json`, raíz y `packages[""]` | Ambas versiones son `0.18.0-beta.2` |
| Puntero estable | `stable-version.txt` | `v0.17.0`, tag normal promovido |
| Historial de cambios | `CHANGELOG.md` | La entrada actual prepara `0.18.0-beta.2`; conserva beta.1 y la promoción estable como historial |
| Manifiesto y algoritmo de empaquetado | `scripts/build.mjs` | La lista usa rutas de repositorio (`apps/web/src/...`, `packages/platform/src/...`) y se valida contra el grafo de `apps/web/src/app.js` |
| Fuente de ejecución web | `apps/web/src/app.js` y sus módulos Web/Platform | Se concatena en un HTML; los imports relativos y `@siys-sync/platform/...` se eliminan después de incluir los módulos |

`packages/platform/src/core.js` mantiene `SCHEMA_VERSION = 4`,
`packages/platform/src/calendar-contract.js` mantiene `CONTRACT_VERSION = 1` y
el ruleset de festivos se identifica por `HOLIDAY_RULESET_VERSION`. No son
sustitutos de `WEB_VERSION`.

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

## Canales y distribución

| Canal | Fuente actual | Artefacto o ruta |
| --- | --- | --- |
| Local | `dist/calendario-hvac-siys.html` | Archivo descargable; `file:`, localhost y servidores locales conservan la ruta local |
| Stable | Tag normal indicado por `stable-version.txt` (`v0.17.0`) | Raíz de GitHub Pages |
| Beta | Se construye desde `main`, versión Web `0.18.0-beta.2` | `/beta/`; integrar Workstream 1 activa Pages por push a `main` |

`.github/workflows/pages.yml` comprueba `stable-version.txt`, obtiene ese tag
en `stable-src`, verifica stable y beta por separado, y copia
`stable-src/dist/index.html` a la raíz y `dist/index.html` a `/beta/`. Pages
sirve el HTML; Supabase aporta Auth y persistencia cloud cuando el canal
público recibe la configuración.

## Versionamiento y releases

La política operativa está en `docs/VERSIONAMIENTO.md`:

- `package.json > version` y `apps/web/src/ui/web-version.js > WEB_VERSION` deben coincidir;
- `apps/web/package.json > version` debe coincidir con `WEB_VERSION` y
  `apps/cli/package.json > version` con `CLI_VERSION`;
- `package-lock.json` es un espejo generado, no una decisión independiente;
- los tags usan `v<version>`;
- stable usa una versión normal y beta usa `-beta.N`;
- `stable-version.txt` puede apuntar a stable mientras `main` contiene otra
  prerelease;
- `npm run release:check -- --require-current-tag` exige que el tag actual
  exista y resuelva al mismo commit que `HEAD`, no sólo que tenga el nombre
  correcto.

Los gates definidos por el repositorio son:

```text
node --test tests/build-manifest.test.mjs
node --check scripts/build.mjs
npm test
npm run build
npm run version:check
npm run audit
npm run verify
```

`release:check -- --require-current-tag` corresponde después de integrar y
crear el tag sobre el commit integrado; no es un gate de esta preparación.

`npm run verify` combina pruebas, `architecture:check`, build, comprobación de
versión y auditoría.
`.github/workflows/ci.yml` instala dependencias con `npm ci`, ejecuta pruebas,
build, `version:check`, `audit` y verifica que el build no deje diferencias en
`dist/`. Para una promoción también aplican los smokes de
`tests/pages_smoke.py`, los viewports y las comprobaciones descritas en
`docs/CRITERIOS_DE_DISENO.md`.

## Estado posterior a la promoción

- `v0.17.0` es el tag estable promovido desde `0.17.0-beta.1` y apunta al
  commit integrado que pasó CI.
- `stable-version.txt` apunta a `v0.17.0`; Pages usa ese tag para la raíz
  estable.
- Beta `v0.18.0-beta.1` ya está certificada y permanece inmutable. La
  integración de Workstream 1 publica Web `0.18.0-beta.2`; su tag
  `v0.18.0-beta.2` se crea después de integrar y verificar CI, Pages y la URL
  pública. CLI conserva `0.18.0-beta.1` y stable conserva `v0.17.0`.
- El gate de publicación se verificó con pruebas de navegador, smoke
  autenticado, Pages, Supabase y migraciones.
- Los módulos de aplicación deben recibir sus dependencias por argumentos y
  evitar estado global; los adaptadores de almacenamiento permanecen fuera de
  esa capa.
- `app.js` conserva la coordinación del DOM y su estado efímero; el contrato y
  los importadores conservan las secuencias que deben ser atómicas. El criterio
  de cierre es que sus funciones internas tengan una responsabilidad legible,
  no imponer un límite artificial de líneas al archivo coordinador.

## Frontera CLI e identidades independientes

La CLI corre localmente bajo Node.js >=20 desde `apps/cli/bin/calendary.js`;
`apps/cli/*` queda fuera del manifiesto HTML. La raíz conserva un `bin`
conveniente (`calendary`) y el script `npm run cli` apuntando al workspace.
Cada paquete es `private: true`; `packages/platform` usa `0.0.0` como identidad
interna de workspace, no de release. Web usa `0.18.0-beta.2` y CLI
`0.18.0-beta.1`, como prueba concreta de identidades independientes. La
distribución CLI independiente queda para Workstream 3.
El modelo antiguo de tags `v...` sigue temporalmente autoritativo.
`document.appVersion` es metadato legado, conservado en mutaciones; la
compatibilidad sigue en `schemaVersion` y `formatVersion = 1`. Web pasa su
versión al envelope de respaldo como `exporterVersion: WEB_VERSION`. Véase
[arquitectura de productos](ARQUITECTURA_PRODUCTOS.md).
