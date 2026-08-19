# Plan maestro de reforzamiento del sistema

Estado: EN EJECUCIÓN LOCAL  
Orquestador: Codex maestro  
Máximo de tareas paralelas: 3  
Alcance actual: documentación, consistencia arquitectónica y mantenibilidad
local. No publicar, no promover canales y no crear PR hasta cerrar las puertas
de verificación.

## Objetivo

Describir Calendary como un sistema mantenible, no sólo como una aplicación web
con muchas funciones. La documentación final debe permitir que otra persona
entienda el contexto, los límites, los datos, los estados, el runtime, la
persistencia, el build, la distribución y la forma segura de modificarlo.

## Reglas de coordinación

- Codex maestro conserva el mapa, revisa cada entrega y decide la integración.
- Se mantienen como máximo tres tareas delegadas simultáneamente.
- Cada tarea tiene una superficie de archivos exclusiva; un agente no edita la
  superficie de otro.
- Los agentes deben trabajar en modo `--yolo`, revisar el estado inicial y no
  hacer `reset`, `clean`, commit, push, PR, tag, build ni despliegue sin una
  instrucción posterior del maestro.
- Cada agente implementa el entregable asignado además de reportar evidencia;
  el maestro decide si la implementación queda integrada.
- Se conservan los cambios locales existentes. No se borra ni se revierte un
  cambio sólo para obtener un worktree limpio.

## Estado inicial conocido

- La documentación existente cubre bien el manual de uso y el contrato de
  operaciones, pero está fragmentada como descripción de sistema.
- `docs/ARQUITECTURA.md` contiene métricas históricas que ya no coinciden con el
  código actual.
- La fuente importa módulos nuevos de presentación/exportación que deben estar
  incluidos explícitamente en el manifiesto del build antes de confiar en
  `dist/`.
- El worktree ya contiene cambios locales mezclados de iteraciones anteriores.

## Estrategia de Git y releases

### Decisión

No conviene acumular todo en un único gran commit. Tampoco conviene hacer PRs
por cada ajuste mínimo. La unidad recomendada es un commit local por rebanada
coherente y un PR por bloque revisable.

### Secuencia recomendada

1. Terminar la clasificación del worktree actual sin hacer reset ni limpiar.
2. Separar conceptualmente los cambios en: documentación del sistema,
   correcciones de build, refactorizaciones de código y cambios visuales.
3. Crear commits locales atómicos usando staging selectivo cuando una rebanada
   comparta archivos con cambios anteriores.
4. Ejecutar pruebas y revisión de diff por commit o por bloque relacionado.
5. Abrir un PR sólo cuando el bloque tenga alcance, evidencia y build
   reproducible. Los PRs deben ser revisables, no diarios ni acumulativos sin
   límite.
6. Mantener `dist/` fuera de commits intermedios de documentación. Regenerarlo
   sólo en el commit que cierre una modificación de fuente que deba distribuirse
   y verificar que ambas salidas coincidan.

### Regla práctica para el worktree actual

Mientras existan cambios anteriores sin clasificar, no se debe hacer un commit
global con mensaje genérico. Primero se documenta el inventario y se usa
`git diff`, staging selectivo y pruebas para no mezclar deuda previa con el
reforzamiento del sistema.

## Frentes de trabajo

| ID | Frente | Resultado | Dependencias | Superficie principal |
| --- | --- | --- | --- | --- |
| S-01 | Mapa del sistema y runtime | `docs/SISTEMA.md` | Ninguna | documentación nueva |
| S-02 | Modelo de datos y estados | `docs/MODELO_ESTADOS.md` | Contrato actual | documentación nueva |
| S-03 | Build, distribución y releases | `docs/BUILD_RELEASE.md` y validación de manifiesto | Estado real de `scripts/` y versiones | `scripts/build.mjs`, tests y documentación |
| S-04 | Persistencia, sincronización y seguridad | Sección verificable en docs del sistema | S-01, S-02 | documentación y pruebas de contrato |
| S-05 | Refuerzo de arquitectura de código | módulos, manifiesto y validaciones | S-01, S-03 | `src/`, `scripts/`, tests |
| S-06 | Cierre documental y Git | checklist de mantenibilidad | S-01 a S-05 | docs, tests y commits locales |

## Ola actual: tres tareas paralelas

### S-01 — Implementar mapa del sistema y runtime

- Identificar actores, superficies, sistemas externos y fronteras de confianza.
- Describir arranque, selección de canal, carga, render, mutación, guardado,
  sincronización, bloqueo y recuperación.
- Separar hechos comprobados de decisiones aún no documentadas.
- Crear `docs/SISTEMA.md` con diagramas textuales, límites, actores, ciclo de
  vida y fuentes de verdad.
- No modificar código de producción ni otros documentos en esta tarea.

### S-02 — Implementar modelo de datos y estados

- Describir el documento canónico de esquema 4 y sus entidades/relaciones.
- Documentar estados de actividad, bandejas, fechas, series y transiciones.
- Relacionar cada transición con la operación del contrato y sus invariantes.
- Crear `docs/MODELO_ESTADOS.md` con el modelo verificable y las transiciones.
- No modificar código de producción ni otros documentos en esta tarea.

### S-03 — Implementar refuerzo de build, distribución y releases

- Contrastar el manifiesto de build con los imports reales y las salidas `dist/`.
- Documentar fuentes autoritativas, canales, versiones y artefactos generados.
- Corregir el manifiesto para que todos los imports de producción entren al
  bundle autocontenido.
- Añadir una prueba o validación automatizada que detecte imports no incluidos.
- Crear `docs/BUILD_RELEASE.md` con fuentes, canales, versiones y gates.
- No regenerar `dist/`, no cambiar versiones y no publicar en esta ola; el
  maestro hará esa verificación después de revisar el diff.

## Ola 2 — guardas y persistencia

Esta ola también quedó implementada localmente, con tres superficies separadas:

- **Guardia de arquitectura:** `scripts/architecture-check.mjs`,
  `tests/architecture.test.mjs` y el comando `npm run architecture:check`.
  Recorre los 37 módulos de `src/`, valida 74 imports locales, detecta la CLI
  completa y rechaza cruces de capas; `app.js` es el único composition root.
- **Sincronización documental:** `docs/ARQUITECTURA.md`,
  `docs/VERSIONAMIENTO.md`, `docs/DISTRIBUCION.md` y
  `docs/OPERACION_RESPALDOS_JSON.md` ahora enlazan el mapa, el modelo y el
  build, y separan el estado actual de los registros históricos.
- **Persistencia local:** `src/persistence/indexed-document-store.js` y
  `tests/persistence.test.mjs` cierran conexiones ante `versionchange`,
  clasifican heartbeats inválidos como stale y liberan locks con revalidación
  atómica del propietario.

La ola no publica ni promueve canales. La regeneración de `dist/` y el gate
completo siguen siendo responsabilidad del maestro, porque el worktree ya
contenía artefactos modificados antes de esta intervención.

## Puertas de verificación

### Puerta A — Comprensión

- [x] Una persona nueva puede dibujar el sistema y explicar quién escribe qué.
- [x] El documento canónico, sus estados y sus migraciones están definidos.
- [x] El flujo local/cloud y sus conflictos tienen una secuencia verificable.

### Puerta B — Consistencia

- [x] La arquitectura coincide con el tamaño y módulos reales.
- [x] Todos los imports de producción entran al build autocontenido.
- [x] Versiones, `stable-version.txt`, changelog y documentación no se
  contradicen.

### Puerta C — Mantenibilidad

- [x] Cada módulo nuevo tiene dueño, frontera y prueba.
- [x] El registro de módulos del build se valida automáticamente.
- [x] Los cambios de contrato, esquema y distribución tienen checklist.
- [ ] El worktree se puede agrupar en commits comprensibles.

### Puerta D — Cierre

- [x] `npm test` pasa (157 pruebas).
- [x] `npm run verify` pasa después de corregir el manifiesto y regenerar
  `dist/` desde el maestro (157 pruebas, build, versionamiento y auditoría).
- [x] `git diff --check` pasa.
- [x] Se han revisado los artefactos locales y no se publicó nada sin autorización.

## Protocolo de integración del maestro

1. Leer el reporte y el diff de cada agente.
2. Comprobar que sólo tocó la superficie asignada.
3. Contrastar cada afirmación contra código, pruebas y artefactos actuales.
4. Integrar primero las implementaciones que no dependan de decisiones
   pendientes.
5. Convertir los bloqueos de build, versión o contrato en tareas explícitas.
6. Ejecutar regresión antes de abrir la siguiente ola.
7. Sólo al cerrar las puertas decidir la secuencia de commits y PRs.

## Criterio de finalización

El trabajo termina cuando la documentación describe el sistema actual, las
contradicciones fueron resueltas o marcadas como pendientes, el build representa
la misma arquitectura que la fuente, y los cambios pueden dividirse en commits
locales revisables sin perder trazabilidad.
