# Arquitectura de Calendary

## Propósito y restricciones

Calendary es una aplicación web estática, sin framework, que debe funcionar de
dos maneras sin divergencias:

- como módulos ES durante desarrollo y pruebas;
- como un único HTML autocontenido para descarga y GitHub Pages.

La refactorización conserva el comportamiento, el esquema de datos, el contrato
de operaciones, los identificadores del DOM y el formato de distribución. Las
fachadas públicas `src/core.js`, `src/calendar-contract.js` y `src/importer.js`
se mantienen estables para la interfaz, la CLI y consumidores externos.

Para orientarse en el sistema completo, empezar por [mapa del sistema](SISTEMA.md),
[modelo de datos y estados](MODELO_ESTADOS.md) y [build, distribución y releases](BUILD_RELEASE.md).

## Capas y dependencias

Las dependencias avanzan de arriba hacia abajo; una capa de dominio no debe
importar código de interfaz, persistencia ni CLI.

1. **Dominio compartido (`src/domain/`)**: texto, fechas, festivos, filtros,
   orden, CSV y mezcla de documentos como funciones puras.
2. **Núcleo (`src/core.js`)**: modelo del documento, reglas de calendario,
   validación, migraciones, respaldos y operaciones puras.
3. **Contrato (`src/calendar-contract.js`)**: comandos atómicos consumidos por
   la interfaz y la CLI; traduce entradas a operaciones del núcleo.
4. **Aplicación (`src/application/`)**: comandos de caso de uso que reciben
   dependencias explícitas, delegan en el contrato y conservan invariantes de
   documento, rollback y undo sin conocer DOM ni infraestructura.
5. **Importación (`src/import/`, con fachada `src/importer.js`)**: lectura
   tabular, Base Operativa y programación separadas de la conciliación.
6. **Persistencia (`src/persistence/` y `src/cloud.js`)**: preferencias,
   IndexedDB, bloqueo de edición y adaptador REST de Supabase.
7. **Presentación (`src/ui/` y `src/app.js`)**: formato visible, DOM, eventos,
   diálogos y coordinación del estado de la página.
8. **CLI (`src/cli/`)**: adaptación entre argumentos, fuentes `FileCalendarSource`/
   `CloudCalendarSource` y contrato. La fuente cloud es solo lectura; autenticación
   y lectura PostgREST están separadas del dominio.
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

CLI source=file  ────────────┘
CLI source=cloud ── GET Supabase → documento → contrato

build: módulos anteriores + plantilla + CSS + SheetJS -> HTML autocontenido
```

## Fronteras que deben permanecer estables

- `core.js` reexporta las utilidades de dominio que ya formaban parte de su API.
- El contrato de `executeCalendarOperation()` es la única ruta compartida de
  mutaciones entre la CLI y la interfaz.
- `src/application/` puede depender del contrato, núcleo y dominio; no puede
  depender de UI, persistencia, cloud, CLI ni composición. La UI puede usar
  sus comandos sin conocer cómo se persiste el documento.
- `APP_VERSION`, `SCHEMA_VERSION` y `CONTRACT_VERSION` tienen significados
  distintos y no se actualizan por una refactorización interna.
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
- `src/styles.css`, `src/styles/responsive.css` y
  `src/styles/channel-contract.css` se concatenan en ese orden para conservar
  exactamente la cascada del archivo original.
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

El siguiente inventario fue comprobado en el worktree local el 2026-08-23; no
es una certificación de despliegue remoto ni de una release publicada:

- `npm test` terminó con 189 pruebas aprobadas en el corte documentado; el
  número de pruebas no es un límite de diseño.
- El conteo de líneas es: `src/app.js` 4.823, `src/core.js` 1.315 y
  `src/importer.js` 11. Son métricas descriptivas del corte, no límites de
  diseño.
- El manifiesto de la aplicación contiene 30 módulos JavaScript del navegador;
  `src/` también contiene módulos de CLI que no se incluyen en ese HTML.
- El `HEAD` local contiene `d27383a`, que regeneró `dist/` después de la última
  frontera de imports. La presencia de esos artefactos no certifica el
  despliegue remoto; la validación de integración está en
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
Pendientes. No debe leerse como el resultado de las 189 pruebas actuales ni
como una verificación remota vigente.

## Puertas de verificación

Después de cada fase se ejecuta como mínimo `npm run verify`. Las fases que
alteran la UI o el empaquetado requieren además smokes sobre HTTP local. El
cierre exige `npm run goal:check` y una revisión del diff que confirme que no se
añadieron funciones de producto ni correcciones deliberadas de lógica.
