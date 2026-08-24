# Plan maestro de implementaciones frontend de Calendary

Estado: REGISTRO HISTÓRICO DE IMPLEMENTACIÓN; PENDIENTE DE MERGE Y RELEASE
Responsable: agente maestro Codex
Canales incluidos: local únicamente
Canales excluidos hasta autorización posterior: beta, stable, GitHub, publicación y tags.

La ola documentada aquí quedó incorporada al `main` local mediante commits
separados de feature, test, refactor y build. Las tareas que permanecen sin
marcar no forman parte de esta integración y requieren un plan nuevo antes de
retomarse; no deben interpretarse como un estado actual de release.

## Propósito

Este documento organiza la deuda técnica y las mejoras de HTML, CSS y JavaScript
detectadas en la revisión de código. Cada tarea tiene una superficie delimitada,
dependencias y checks verificables.

La base de datos, el esquema persistente y el contrato de operaciones no se
modifican como parte de este plan. Si una tarea necesita tocar core.js o
calendar-contract.js, debe detenerse y reportarlo antes de editar.

## Reglas de coordinación

- Trabajar sólo en local.
- No hacer reset, checkout, clean, borrados masivos ni cambios de canal.
- No hacer commit, push, PR, tag ni despliegue.
- Cada agente debe revisar git status antes de editar y conservar los cambios
  locales existentes.
- Un agente no modifica archivos asignados a otro agente.
- No regenerar dist/ desde un agente de feature salvo indicación del maestro.
- Cada agente entrega resumen, archivos modificados, checks, riesgos y siguiente
  paso.
- El agente maestro revisa el diff y los checks antes de marcar una tarea.
- Una decisión de producto no se inventa: se marca como bloqueada.

## Línea base

- [x] Auditoría estática de HTML, CSS, JavaScript y build realizada.
- [x] No hay IDs duplicados en la plantilla actual: 326 IDs y 326 únicos.
- [x] npm test: 190 pruebas aprobadas en la verificación del corte actual.
- [x] Se conserva el alcance local y no se modifican datos persistentes.
- [x] Registrar git status --short y git diff --check antes de integrar.
- [ ] Ejecutar smoke local de navegador antes de la primera integración visual.
- [ ] Ejecutar npm run verify después de integrar y regenerar dist/ sólo desde
  el agente maestro.

## Criterios comunes de cierre

- [ ] La tarea tiene prueba directa, prueba de contrato o smoke adecuado.
- [ ] No cambia IndexedDB, Supabase, esquema, contrato ni datos.
- [ ] Conserva claro, oscuro, responsive, teclado y reduced-motion cuando aplique.
- [ ] No deja errores de consola ni overflow horizontal inesperado.
- [ ] git diff --check pasa.
- [ ] El maestro revisa el diff y confirma que no hay solapamiento.

## Matriz de implementación

| ID | Implementación | Prioridad | Dependencias | Superficie |
| --- | --- | --- | --- | --- |
| F-01 | Contrato único de presentación: estado, icono, tooltip y técnicos | Alta | Ninguna | src/ui/ y pruebas |
| F-02 | Tokens CSS y sistema visual de tarjetas | Alta | F-01 | styles.css y channel-contract.css |
| F-03 | Responsabilidad única de scroll y responsive | Alta | Ninguna | responsive.css y pruebas |
| F-04 | Unificación de exportadores PNG y layout de texto | Media-alta | F-01 | módulo de exportación y pruebas |
| F-05 | Separación progresiva de app.js por features | Alta | F-01, F-04 | src/ui e integración |
| F-06 | Registro DOM explícito y eventos por feature | Alta | F-05 | src/ui e integración |
| F-07 | Modularización del HTML y diálogos repetidos | Media | F-05, F-06 | plantilla y build |
| F-08 | Build determinista y control de dist/ | Media-alta | F-05, F-07 | scripts y tests |
| F-09 | Ranking de responsables con índice precalculado | Media | Ninguna | domain y pruebas |
| F-10 | Documentación y cobertura final de UI | Media | F-01 a F-08 | docs y tests |

## Tareas y checks

### F-01 — Contrato único de presentación

Objetivo: eliminar la duplicación entre STATUS_ICONS, pseudo-elementos CSS,
tooltips secundarios, nombres de responsables y modelos distintos de tarjeta,
drawer y exportación.

Alcance:

- Crear un módulo puro de presentación de actividad.
- Definir metadatos únicos para estado: etiqueta, icono, texto accesible y
  variante visual.
- Definir una sola regla de tooltip de actividad: observaciones únicamente.
- Reutilizar técnicos completos, iniciales y resumen.
- No modificar todavía app.js ni estilos existentes; la integración queda para
  el maestro o una tarea posterior.

Checks:

- [x] Se conservan las claves de todos los estados.
- [x] in_progress tiene una única representación en el contrato puro.
- [x] No aparecen iconos duplicados en tarjeta, drawer ni agenda: tarjeta,
  agenda, drawer y exportadores consumen el contrato compartido.
- [x] La tarjeta no agrega tooltips informativas adicionales en el contrato.
- [x] Hay pruebas para todos los estados y actividades sin responsables.

### F-02 — Tokens y sistema visual de tarjetas

Objetivo: reducir colores, tamaños y variantes repetidos y evitar nombres beta
ambiguos para reglas compartidas por local, beta y stable.

Alcance:

- Convertir colores de tarjetas, controles, bordes y estados a tokens semánticos.
- Consolidar variantes de tarjeta y botones.
- Mantener la altura fija y el truncamiento de texto.
- Ajustar selector, indicador de reprogramación, responsables y play.
- No cambiar la estructura JavaScript de la tarjeta en esta tarea.

Checks:

- [x] Claro y oscuro tienen tokens diferenciados y una prueba de contrato.
- [x] Nómina, contratista, mixto y sin responsable conservan variantes diferenciadas.
- [x] El triángulo de ejecución tiene una sola geometría CSS y una prueba de contrato.
- [x] El selector conserva alineación declarada y la altura fija no se expande.
- [x] Texto largo no aumenta la altura fija.
- [ ] Se prueban 390, 768, 1024 y 1440 px.

### F-03 — Scroll y responsive

Objetivo: establecer un propietario de scroll por contexto y evitar decisiones
contradictorias entre CSS y JavaScript.

Alcance:

- Documentar y ajustar scroll de calendario, agenda, catálogo, drawer y forms.
- Centralizar el breakpoint de 899 px sin cambiar reglas de negocio.
- Verificar overscroll, focus y cierre de diálogos.
- No tocar persistencia ni contrato.

Checks:

- [x] Cada contexto tiene un único scroll principal.
- [x] El formulario conserva scroll y footer sticky.
- [ ] Abrir y cerrar diálogos no mueve el scroll de fondo.
- [ ] Agenda y mes no dejan el DOM en estado inconsistente.
- [x] No hay overflow horizontal en seis viewports del smoke local.
- [x] Se respeta prefers-reduced-motion.

### F-04 — Exportadores PNG

Objetivo: reutilizar el modelo visual y el layout de texto en pendientes, día y
mes.

Checks:

- [x] Día y pendientes muestran nombres completos de técnicos desde el
  exportador integrado.
- [x] La imagen mensual usa el mismo modelo de estado y responsable.
- [x] El módulo base y el exportador integrado envuelven el texto mediante una
  única función.
- [ ] No se cortan inesperadamente cliente, sede o técnico.
- [ ] Claro y oscuro generan PNG legibles.
- [ ] Los archivos descargados son PNG válidos.

### F-05 — Separación progresiva de app.js

Objetivo: convertir app.js en coordinador y no en contenedor de todas las
features.

Módulos objetivo:

- calendar-view.js
- activity-card-view.js
- agenda-view.js
- catalog-view.js
- activity-form.js
- date-actions.js
- filter-dialog.js
- exporters.js
- app-state.js

Checks:

- [ ] Cada módulo tiene una responsabilidad clara.
- [ ] Las mutaciones continúan pasando por el contrato existente.
- [ ] No se duplican listeners al renderizar.
- [ ] app.js conserva coordinación y ciclo de vida.
- [ ] Se preservan IDs y comportamiento público.

### F-06 — DOM y eventos

Objetivo: sustituir gradualmente el registro DOM implícito y reducir listeners
dispersos.

Checks:

- [ ] Los elementos requeridos se validan al iniciar.
- [ ] Las listas dinámicas usan delegación cuando corresponda.
- [ ] Cada módulo puede instalar y limpiar sus eventos.
- [ ] No hay listeners duplicados tras varios renders.
- [ ] Escape, foco, teclado y formularios siguen funcionando.

### F-07 — HTML y diálogos

Objetivo: separar la plantilla por feature sin abandonar el HTML autocontenido.

Checks:

- [ ] Los 25 diálogos conservan IDs y etiquetas accesibles.
- [ ] Encabezados, errores y footers repetidos son consistentes.
- [ ] No se crean IDs duplicados.
- [ ] La plantilla sigue siendo válida y autocontenida.

### F-08 — Build y distribución

Objetivo: reducir la dependencia del orden manual y detectar divergencias entre
fuente y dist/.

Checks:

- [ ] El build valida dependencias y sintaxis.
- [ ] Los dos HTML de dist/ son idénticos.
- [ ] No quedan imports, marcadores ni dependencias de red no permitidas.
- [ ] Los agentes de feature no regeneran dist/ sin autorización.

### F-09 — Ranking de responsables

Objetivo: precalcular cobertura por grupo y ciudad una sola vez por render.

Checks:

- [x] Se conserva prioridad por zona atendida.
- [x] Se conservan favoritos, ciudad base y cobertura nacional.
- [x] Hay pruebas para Pereira, Armenia, Manizales y sin cobertura.
- [ ] El índice no se reconstruye en cada comparación.

Estado de la primera entrega: el índice puro ya existe y admite reutilización;
queda pendiente conectarlo al renderizador del formulario para que el snapshot
se cree una sola vez por render.

### F-10 — Cierre documental y cobertura

Checks:

- [ ] Se actualizan las métricas de ARQUITECTURA.md.
- [ ] El plan contiene evidencia de todos los checks.
- [ ] npm test pasa.
- [ ] npm run verify pasa después de regenerar dist/ desde el maestro.
- [ ] Smoke local desktop y móvil pasa sin errores de consola.
- [ ] No hay cambios de beta, stable, GitHub, ramas ni tags.

## Distribución inicial de agentes

### Ola 1 — paralela y sin solapamiento

| Agente | Tarea | Puede modificar | No debe modificar |
| --- | --- | --- | --- |
| ui-presentation | F-01 | Nuevo módulo en src/ui/ y prueba nueva | app.js, styles, responsive, HTML, dist, core, contrato |
| ui-css | F-02 | styles.css, channel-contract.css y pruebas CSS | app.js, responsive.css, HTML, dist |
| ui-responsive | F-03 | responsive.css y pruebas responsive | app.js, styles.css, HTML, dist |

### Ola 2 — después de revisar la Ola 1

- ui-export: F-04, con módulo nuevo y pruebas; no integra app.js sin liberación
  explícita del maestro.
- ui-modules: F-05 y F-06, con integración controlada de app.js.
- ui-template-build: F-07 y F-08, después de congelar IDs y módulos.

## Protocolo del agente maestro

1. Confirmar local, archivos permitidos y estado inicial.
2. Esperar la finalización del agente.
3. Leer diff y detectar archivos fuera de alcance.
4. Ejecutar los checks de la tarea.
5. Marcar aquí la tarea sólo con evidencia.
6. Si hay conflicto, detener la integración y no forzar merges.
7. Ejecutar regresión antes de iniciar la siguiente ola.

## Estado de la ola documentada

- [x] Plan creado por el agente maestro.
- [x] Ola 1 ejecutada con agentes en paralelo y superficies separadas.
- [x] F-01 completada como contrato puro y pruebas focalizadas.
- [x] F-02 completada como contrato CSS y pruebas focalizadas.
- [x] F-03 completada como ajuste CSS y contrato de scroll.
- [x] Revisión maestra de F-01 y F-03 aprobada.
- [x] F-01 integrada en tarjetas, agenda, drawer y exportadores.
- [x] F-04 completada como módulo puro de filas/layout y pruebas focalizadas.
- [x] F-04 integrada en pendientes, día y modelo del exportador mensual.
- [x] F-09 tiene índice puro reutilizable y pruebas de prioridades.
- [ ] Cablear el índice F-09 al render del selector de responsables.
- [ ] Iniciar F-05 y F-06 cuando se congele la base de presentación/exportación.
- [ ] F-07 a F-10 completadas.
- [ ] Verificación local final aprobada.
- [ ] Usuario autoriza cualquier preparación posterior para beta.

## Evidencia de la primera ronda

- [x] ui-presentation trabajó con --yolo y sólo añadió
  src/ui/activity-presentation.js y tests/activity-presentation.test.mjs.
- [x] F-01 tiene 5 pruebas focalizadas aprobadas y sintaxis válida.
- [x] ui-responsive trabajó con --yolo y limitó sus cambios de feature a
  src/styles/responsive.css y tests/responsive_scroll_contract.test.mjs.
- [x] F-03 validó fuente CSS en seis viewports y smoke local existente.
- [x] F-02 añadió tokens semánticos, geometría única de play y prueba CSS focalizada.
- [x] F-04 añadió src/ui/export-layout.js y tests/export-layout.test.mjs.
- [x] F-01/F-04 se integraron en src/app.js; no se regeneró dist/.
- [x] F-09 añadió src/domain/responsible-ranking.js y tests/responsible-ranking.test.mjs.
- [x] npm test del maestro: 190 pruebas aprobadas en el corte actual.
- [x] git diff --check aprobado.
- [x] La integración modificó únicamente src/app.js dentro de la superficie
  autorizada; no se modificaron HTML, core.js, calendar-contract.js ni dist/.
- [ ] La verificación final de release, incluidos smokes de navegador y
  promoción de canales, sigue pendiente de merge y autorización.
