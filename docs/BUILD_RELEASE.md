# Build, distribución y releases

## Alcance y corte verificado

Este documento describe la transición del Workstream 1 de Platform
Architecture V2 desde el main certificado `40f7e908cbfa87a92da5d00fac2bf9bc451ccc1d`.
Web y CLI conservan `0.18.0-beta.1` con identidades independientes. Stable sigue
en `v0.17.0`; ambas releases certificadas se conservan sin republicación.

## Fuentes autoritativas

| Dato | Fuente autoritativa | Hecho verificado |
| --- | --- | --- |
| Release Web/repositorio | `package.json`, campo `version` | `0.18.0-beta.1`; no versiona CLI |
| Versión de Calendary CLI | `src/cli/version.js`, `CLI_VERSION` | `0.18.0-beta.1`, independiente de Web |
| Versión Web visible y del exportador de respaldos | `src/ui/web-version.js`, `WEB_VERSION` | `0.18.0-beta.1`, igual a `package.json` |
| Espejo de npm | `package-lock.json`, raíz y `packages[""]` | Ambas versiones son `0.18.0-beta.1` |
| Puntero estable | `stable-version.txt` | `v0.17.0`, tag normal promovido |
| Historial de cambios | `CHANGELOG.md` | La entrada actual prepara `0.18.0-beta.1`; conserva la promoción estable como historial |
| Manifiesto y algoritmo de empaquetado | `scripts/build.mjs` | La lista se expresa relativa a `src/` y se valida contra el grafo de `src/app.js` |
| Fuente de ejecución web | `src/app.js` y sus módulos locales | Se concatena en un HTML; los imports locales se eliminan después de incluir los módulos |

`src/core.js` también mantiene `SCHEMA_VERSION = 4`,
`src/calendar-contract.js` mantiene `CONTRACT_VERSION = 1` y el ruleset de
festivos se identifica por `HOLIDAY_RULESET_VERSION`. No son sustitutos de
`WEB_VERSION`.

## Manifiesto de la aplicación

El punto de entrada es `src/app.js`. `scripts/build.mjs` mantiene un orden
dependencia-primero para los 32 módulos del navegador. Las entradas, siempre
relativas a `src/`, son:

- dominio: `domain/text.js`, `domain/responsible-ranking.js`,
  `domain/dates.js`, `domain/calendar-enums.js`, `domain/activity-order.js`,
  `domain/activity-filters.js`, `domain/import-merge.js`,
  `domain/backup-merge.js`, `domain/csv-export.js`, `domain/holidays.js`;
- importación: `import/xlsx-table.js`, `import/workbook-table.js`,
  `import/programming.js`, `import/base-operativa.js`, `importer.js`;
- persistencia y transporte: `supabase/transport.js`,
  `persistence/indexed-document-store.js`,
  `persistence/json-preferences.js`;
- aplicación: `application/calendar-commands.js`,
  `application/import-commands.js`;
- interfaz: `ui/web-version.js`, `ui/three-motion.js`, `ui/calendar-constants.js`,
  `ui/presentation.js`, `ui/activity-presentation.js`,
  `ui/export-layout.js`, `ui/mutation-controller.js`, `ui/view-state.js`;
- fachadas y arranque: `core.js`, `calendar-contract.js`, `cloud.js`,
  `app.js`.

`ui/activity-presentation.js` precede a `ui/export-layout.js` porque el segundo
reutiliza la presentación de actividad. `importer.js` precede a `app.js` y
reexporta las fachadas de `import/`. `ui/three-motion.js` es una entrada
explícita de efectos laterales: instala `globalThis.calendaryThreeMotion` y
`app.js` consume ese global, aunque no exista un import estático entre ambos.

La validación exportada por `scripts/build.mjs` recorre los imports `import` y
`export ... from` locales de `src/app.js` y sus dependencias, resuelve cada
ruta relativa y comprueba que esté en el manifiesto. También rechaza
duplicados y dependencias listadas después de su importador. Que un import
interno se elimine al concatenar no lo convierte en faltante: si su módulo ya
está listado y precede al importador, la relación es válida.

La prueba focalizada es `tests/build-manifest.test.mjs`. Comprueba el grafo
actual, el orden de los módulos nuevos y una omisión simulada de
`ui/export-layout.js`.

## Qué genera el build

El comando `npm run build` ejecuta `scripts/build.mjs` y:

1. lee `src/index.template.html`, los estilos `src/styles.css`,
   `src/styles/responsive.css` y `src/styles/channel-contract.css`;
2. incluye localmente `vendor/xlsx.full.min.js`,
   `node_modules/three/build/three.cjs`, `vendor/LICENSE.txt`,
   `vendor/NOTICE.txt` y `src/assets/siys-sync-icon.svg`;
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
| Beta | Se construye desde `main`, versión Web `0.18.0-beta.1` | `/beta/`; este refactor no cambia versión ni triggers |

`.github/workflows/pages.yml` comprueba `stable-version.txt`, obtiene ese tag
en `stable-src`, verifica stable y beta por separado, y copia
`stable-src/dist/index.html` a la raíz y `dist/index.html` a `/beta/`. Pages
sirve el HTML; Supabase aporta Auth y persistencia cloud cuando el canal
público recibe la configuración.

## Versionamiento y releases

La política operativa está en `docs/VERSIONAMIENTO.md`:

- `package.json > version` y `src/ui/web-version.js > WEB_VERSION` deben coincidir;
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
- Beta `v0.18.0-beta.1` ya está certificada. Workstream 1 conserva ese tag
  y el puntero stable `v0.17.0`; no crea releases ni tags.
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

La CLI corre localmente bajo Node.js >=20 desde `bin/calendary.js`;
`src/cli/*` queda fuera del manifiesto HTML. `package.json` sigue privado y
sin workspaces y sin reorganización física. Las versiones son técnicamente
independientes aunque hoy ambas valen `0.18.0-beta.1`. La distribución CLI
independiente queda para Workstream 3; la estructura física, para Workstream 2.
El modelo antiguo de tags `v...` sigue temporalmente autoritativo.
`document.appVersion` es metadato legado, conservado en mutaciones; la
compatibilidad sigue en `schemaVersion` y `formatVersion = 1`. Web pasa su
versión al envelope de respaldo como `exporterVersion: WEB_VERSION`. Véase
[arquitectura de productos](ARQUITECTURA_PRODUCTOS.md).
