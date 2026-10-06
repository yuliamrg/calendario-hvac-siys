# Arquitectura de Calendary

Platform Architecture V2 está completa: sus tres workstreams materializaron los
tres workspaces privados con npm workspaces (`apps/web`, `apps/cli` y
`packages/platform`), la separación física y las releases independientes. La
raíz es orquestación privada sin versión de producto; Web se identifica por
`apps/web/package.json` + `WEB_VERSION` y CLI por `apps/cli/package.json` +
`CLI_VERSION`. Los tags históricos `v...` siguen vigentes.

## Propósito y restricciones

Este documento describe las capas de SIYS Sync Web y las fronteras compartidas
con Calendary CLI. El mapa canónico de los dos clientes, shared code y backend
está en [ARQUITECTURA_PRODUCTOS.md](ARQUITECTURA_PRODUCTOS.md).

La Web es estática, sin framework, y debe funcionar de
dos maneras sin divergencias:

- como módulos ES durante desarrollo y pruebas;
- como un único HTML autocontenido para descarga y GitHub Pages.

La refactorización conserva el comportamiento, el esquema de datos, el contrato
de operaciones, los identificadores del DOM y el formato de distribución. Las
fachadas `packages/platform/src/core.js`,
`packages/platform/src/calendar-contract.js` y `apps/web/src/importer.js`
conservan sus símbolos para la interfaz y la CLI.

Para orientarse en el sistema completo, empezar por [mapa del sistema](SISTEMA.md),
[modelo de datos y estados](MODELO_ESTADOS.md) y [build, distribución y releases](BUILD_RELEASE.md).

## Capas y dependencias

Las dependencias avanzan de arriba hacia abajo; una capa de dominio no debe
importar código de interfaz, persistencia ni CLI.

Fronteras de workspace: Web y CLI dependen de Platform; Platform no depende de
ninguno; Web y CLI no se importan entre sí.

1. **Dominio compartido (`packages/platform/src/domain/`)**: texto, fechas,
   festivos, filtros, orden, CSV y mezcla de documentos como funciones puras.
2. **Núcleo (`packages/platform/src/core.js`)**: modelo del documento, reglas de
   calendario, validación, migraciones, respaldos y operaciones puras.
3. **Contrato (`packages/platform/src/calendar-contract.js`)**: comandos
   atómicos consumidos por la interfaz y la CLI; traduce entradas a operaciones
   del núcleo.
4. **Aplicación (`apps/web/src/application/`)**: comandos de caso de uso que
   reciben dependencias explícitas, delegan en el contrato y conservan
   invariantes de documento, rollback y undo sin conocer DOM ni infraestructura.
5. **Importación (`apps/web/src/import/`, con fachada
   `apps/web/src/importer.js`)**: lectura tabular, Base Operativa y programación
   separadas de la conciliación.
6. **Persistencia (`apps/web/src/persistence/` y `apps/web/src/cloud.js`)**:
   preferencias, IndexedDB, bloqueo de edición y adaptador REST de Supabase.
7. **Presentación (`apps/web/src/ui/` y `apps/web/src/app.js`)**: formato
   visible, DOM, eventos, diálogos y coordinación del estado de la página.
8. **CLI (`apps/cli/src/`)**: adaptación entre argumentos, `CloudCalendarSource`
   y contrato. Supabase es la única autoridad del calendario: la CLI lee y
   persiste por el RPC atómico compartido; autenticación y transporte PostgREST
   están separados del dominio. Los archivos JSON sólo entran como operando
   (`--backup-file`, `--payload-file`) o salida (`--csv-output`).
9. **Distribución (`scripts/build.mjs`)**: valida el manifiesto y la sintaxis,
   concatena los módulos en orden de dependencia e inserta código, estilos,
   icono, SheetJS, Three.js y sus avisos de licencia en el HTML final.

```text
CLI --------------------> contrato ----> núcleo ----> dominio
interfaz ----> aplicación --------^           ^
    |             |
    +----> importador
    |                         |           |
    +----> persistencia       +-----------+
    +----> presentación -----> dominio

CLI source=cloud ── GET Supabase → documento → contrato → RPC atómico (CAS + metadata)

build: módulos anteriores + plantilla + CSS + SheetJS -> HTML autocontenido
```

## Fronteras que deben permanecer estables

- `core.js` reexporta las utilidades de dominio que ya formaban parte de su API.
- El contrato de `executeCalendarOperation()` es la única ruta compartida de
  mutaciones entre la CLI y la interfaz.
- `apps/web/src/application/` puede depender del contrato, núcleo y dominio; no
  puede depender de UI, persistencia, cloud, CLI ni composición. La UI puede
  usar sus comandos sin conocer cómo se persiste el documento.
- `WEB_VERSION` vive en `apps/web/src/ui/web-version.js` y `CLI_VERSION` en
  `apps/cli/src/version.js`; actualmente valen `0.19.0-beta.2` (beta en main;
  estable publicada `0.18.1`) y
  `0.18.0-beta.1`, independientes
  de `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1` y backup `formatVersion = 1`.
- `scripts/architecture-check.mjs` prohíbe Platform → Web/CLI, Web → CLI,
  CLI → Web, imports `node:` en dominio/núcleo/contrato y constantes de release
  en capas compartidas. `packages/platform` no expone `./*`; sólo las entradas
  consumidas por las apps.
- `document.appVersion` es metadato legado opaco: mutaciones e importaciones
  lo conservan, restore usa el del respaldo y merge conserva el actual.
  `createDefaultDocument(today, now, { appVersion })` acepta un valor explícito;
  sin valor usa `""`. El núcleo no decide la release de ningún cliente.
- Stable y beta comparten autenticación de Supabase, pero usan calendarios
  lógicos separados.
- El build debe seguir sin dependencias de red y producir dos HTML idénticos:
  `dist/calendario-hvac-siys.html` y `dist/index.html`. Son salidas generadas,
  no fuentes de comportamiento ni autoridad de versión.
- Los nombres e identificadores del DOM y las claves de IndexedDB/localStorage
  son contratos de compatibilidad, aunque no sean una API publicada.

## Criterios para organizar módulos

- Un módulo nuevo debe representar una responsabilidad, no sólo reducir líneas.
- Las funciones puras se separan antes que los coordinadores con estado global.
- Las fachadas existentes reexportan símbolos movidos para no romper imports.
- El orden de `applicationModulePaths` en `scripts/build.mjs` sigue el grafo de
  dependencias. Los imports locales se eliminan únicamente en el bundle inline.
- `apps/web/src/styles.css`, `apps/web/src/styles/responsive.css` y
  `apps/web/src/styles/channel-contract.css` se concatenan en ese orden para
  conservar exactamente la cascada del archivo original.
- Una extracción debe conservar las pruebas existentes y, si crea una API pura
  nueva, añadir pruebas directas cuando aporten cobertura distinta.
- Los módulos de aplicación deben recibir sus dependencias por argumentos y
  evitar estado global; los adaptadores de almacenamiento permanecen fuera de
  esa capa.
- `app.js` conserva la coordinación del DOM y su estado efímero; el contrato y
  los importadores conservan las secuencias que deben ser atómicas. El criterio
  de cierre es que sus funciones internas tengan una responsabilidad legible,
  no imponer un límite artificial de líneas al archivo coordinador.

## Corte local actual

Corte local actual: la topología física de tres workspaces está implementada.
La guardia de arquitectura recorre los módulos de `apps/web`, `apps/cli` y
`packages/platform`, y el build produce el HTML certificado. El manifiesto del
bundle incluye únicamente módulos de Web y Platform; `apps/cli/` queda excluido
por completo. La validación de integración está en
[build, distribución y releases](BUILD_RELEASE.md).

## Fases medibles de refactorización

### Fase 0 — Línea base y mapa

- [x] Verificar pruebas, build, versión y auditoría antes de editar.
- [x] Medir tamaño de módulos y localizar concentraciones de responsabilidad.
- [x] Documentar capas, dependencias y contratos que no deben cambiar.

Registro histórico de la línea base de la refactorización: 81 pruebas aprobadas
y `npm run verify` correcto. En ese corte, los módulos con mayor concentración
eran `app.js` (4.330 líneas), `core.js` (1.880) e `importer.js` (1.223). Estas
cifras no describen el inventario actual.

### Fase 1 — Fundamentos compartidos y build

- [x] Extraer texto y fechas puras a `src/domain/` conservando la fachada.
- [x] Extraer presentación reutilizable a `src/ui/presentation.js`.
- [x] Centralizar el orden de módulos del build en una sola lista.
- [x] Añadir pruebas directas de los módulos extraídos.

### Fase 2 — Núcleo y contrato

- [x] Separar reglas de fechas y festivos del núcleo.
- [x] Dividir el saneamiento/migración por catálogos, actividades, ajustes y festivos.
- [x] Separar mezcla de respaldos y conciliación de importaciones del núcleo.
- [x] Dividir el despachador extenso del contrato por grupo de operaciones.
- [x] Simplificar filtros y exportación CSV repetidos sin cambiar resultados.
- [x] Centralizar validaciones repetidas sin cambiar códigos ni mensajes.

### Fase 3 — Importación y CLI

- [x] Separar la lectura tabular genérica de Excel.
- [x] Separar programación y utilidades comunes de libros en módulos enfocados.
- [x] Mantener `importer.js` como fachada y aislar Base Operativa por módulo.
- [x] Reutilizar lectura tabular, presencia de celdas y conciliación de resultados.
- [x] Separar ayuda, parseo de argumentos y construcción del payload de la CLI.
- [x] Separar confirmación y salida de la ejecución de la CLI.

### Fase 4 — Aplicación e interfaz

- [x] Encapsular documentos y bloqueo de edición de IndexedDB.
- [x] Separar preferencias JSON del coordinador de la interfaz.
- [x] Separar mutaciones, rollback y estado de undo en un controlador probado.
- [x] Separar el estado reutilizable y conservar sólo el estado efímero del DOM en el coordinador.
- [x] Dividir el calendario en construcción de día, navegación y drag/drop.
- [x] Dividir renderizadores de catálogo, cajones y formularios en ayudantes enfocados.
- [x] Agrupar el registro de eventos por área de la interfaz.
- [x] Extraer el mapeo puro de clases visuales a `src/ui/view-state.js`.
- [x] Centralizar las mutaciones de contrato en `src/application/calendar-commands.js`.
- [x] Eliminar código muerto demostrado mediante búsqueda de referencias.
- [x] Separar estilos base, responsive y contrato visual preservando la cascada.
- [x] Mantener intactos DOM, accesibilidad, densidad y comportamiento responsive.

### Fase 5 — Cierre verificable (registro histórico)

Las casillas y la evidencia de esta fase pertenecen al cierre histórico de la
refactorización documentada; no sustituyen el corte local actual de la sección
anterior.

- [x] Sincronizar esta guía, README y documentación afectada.
- [x] Ejecutar `npm run goal:check`.
- [x] Ejecutar smokes de navegador y responsive de forma serial y aislada.
- [x] Comparar métricas finales y auditar cada requisito de refactorización.

Evidencia histórica final: 91 pruebas aprobadas. En ese corte, `core.js` quedó
en 1.153 líneas, `importer.js` en 11, `src/cli/main.js` en 54 y los estilos se
distribuyeron en tres archivos ordenados. Se añadieron 20 módulos enfocados en
dominio, importación, persistencia, UI y CLI. Los smokes registrados aprobaron
Chrome y Edge, seis viewports sin desbordamiento del documento y el flujo de
Pendientes. No debe leerse como el resultado de las 190 pruebas actuales ni
como una verificación remota vigente.

## Puertas de verificación

Después de cada fase se ejecuta como mínimo `npm run verify`. Las fases que
alteran la UI o el empaquetado requieren además smokes sobre HTTP local. El
cierre exige `npm run goal:check` y una revisión del diff que confirme que no se
añadieron funciones de producto ni correcciones deliberadas de lógica.
