# Build, distribución y releases

## Alcance y corte verificado

Este documento describe el estado comprobable de la rama local de release,
derivada del `main`, después de la ola de refactorización, documentación y
preparación de publicación (corte auditado el 2026-08-23). El trabajo aún está
pendiente de integración en el remoto. Documenta el flujo que existe hoy; no
prueba por sí solo que las URLs remotas estén actualizadas.

## Fuentes autoritativas

| Dato | Fuente autoritativa | Hecho verificado |
| --- | --- | --- |
| Versión de la aplicación y de la CLI | `package.json`, campo `version` | `0.17.0-beta.1` |
| Versión visible y de respaldos nuevos | `src/core.js`, `APP_VERSION` | `0.17.0-beta.1`, igual a `package.json` |
| Espejo de npm | `package-lock.json`, raíz y `packages[""]` | Ambas versiones son `0.17.0-beta.1` |
| Puntero estable | `stable-version.txt` | `v0.15.0`; es un puntero de distribución, no la versión de `main` |
| Historial de cambios | `CHANGELOG.md` | La entrada actual es `0.17.0-beta.1` y conserva stable en `v0.15.0` |
| Manifiesto y algoritmo de empaquetado | `scripts/build.mjs` | La lista se expresa relativa a `src/` y se valida contra el grafo de `src/app.js` |
| Fuente de ejecución web | `src/app.js` y sus módulos locales | Se concatena en un HTML; los imports locales se eliminan después de incluir los módulos |

`src/core.js` también mantiene `SCHEMA_VERSION = 4`,
`src/calendar-contract.js` mantiene `CONTRACT_VERSION = 1` y el ruleset de
festivos se identifica por `HOLIDAY_RULESET_VERSION`. No son sustitutos de
`APP_VERSION`.

## Manifiesto de la aplicación

El punto de entrada es `src/app.js`. `scripts/build.mjs` mantiene un orden
dependencia-primero para los 30 módulos de producción. Las entradas, siempre
relativas a `src/`, son:

- dominio: `domain/text.js`, `domain/responsible-ranking.js`,
  `domain/dates.js`, `domain/calendar-enums.js`, `domain/activity-order.js`,
  `domain/activity-filters.js`, `domain/import-merge.js`,
  `domain/backup-merge.js`, `domain/csv-export.js`, `domain/holidays.js`;
- importación: `import/xlsx-table.js`, `import/workbook-table.js`,
  `import/programming.js`, `import/base-operativa.js`, `importer.js`;
- persistencia: `persistence/indexed-document-store.js`,
  `persistence/json-preferences.js`;
- aplicación: `application/calendar-commands.js`,
  `application/import-commands.js`;
- interfaz: `ui/three-motion.js`, `ui/calendar-constants.js`,
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
| Stable | Tag normal indicado por `stable-version.txt` (`v0.15.0`) | Raíz de GitHub Pages |
| Beta | `main` y su versión prerelease (`0.17.0-beta.1`) | `/beta/` de GitHub Pages |

`.github/workflows/pages.yml` comprueba `stable-version.txt`, obtiene ese tag
en `stable-src`, verifica stable y beta por separado, y copia
`stable-src/dist/index.html` a la raíz y `dist/index.html` a `/beta/`. Pages
sirve el HTML; Supabase aporta Auth y persistencia cloud cuando el canal
público recibe la configuración.

## Versionamiento y releases

La política operativa está en `docs/VERSIONAMIENTO.md`:

- `package.json > version` y `src/core.js > APP_VERSION` deben coincidir;
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
npm run release:check -- --require-current-tag
```

`npm run verify` combina pruebas, `architecture:check`, build, comprobación de
versión y auditoría.
`.github/workflows/ci.yml` instala dependencias con `npm ci`, ejecuta pruebas,
build, `version:check`, `audit` y verifica que el build no deje diferencias en
`dist/`. Para una promoción también aplican los smokes de
`tests/pages_smoke.py`, los viewports y las comprobaciones descritas en
`docs/CRITERIOS_DE_DISENO.md`.

## Pendientes de integración y release

- La rama de release contiene los commits locales pendientes de integración y
  el commit de publicación `0.17.0-beta.1`; `main` remoto conserva el último
  corte integrado hasta que el PR sea aceptado.
- Debe ejecutarse `npm run goal:check` sobre la rama antes de abrir el PR y
  repetir CI después de integrarla. El gate de publicación incluye además los
  smokes de navegador, el smoke autenticado y la verificación autorizada de
  Pages, Supabase y migraciones.
- `stable-version.txt` continúa en `v0.15.0`; no se modifica al publicar una
  beta.
- Los módulos de aplicación deben recibir sus dependencias por argumentos y
  evitar estado global; los adaptadores de almacenamiento permanecen fuera de
  esa capa.
- `app.js` conserva la coordinación del DOM y su estado efímero; el contrato y
  los importadores conservan las secuencias que deben ser atómicas. El criterio
  de cierre es que sus funciones internas tengan una responsabilidad legible,
  no imponer un límite artificial de líneas al archivo coordinador.
