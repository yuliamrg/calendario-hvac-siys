# Plan de Refuerzo Arquitectónico

## Resumen

Este plan refuerza las fronteras de importación entre las capas del sistema Calendary,
convierte las recomendaciones de la auditoría en guardas automatizadas y documenta
un camino de verificación incremental sin reescribir el código existente ni cambiar
la base de datos.

Los cambios se basan en tres pilares:
1. **Guardas automatizadas** en `scripts/architecture-check.mjs` con una nueva capa `application`.
2. **Tests de arquitectura** en `tests/architecture.test.mjs` que validan fronteras sintéticas y reales.
3. **Documentación de fases** P0/P1/P2 con criterios de aceptación verificables.

---

## Fases del Plan

### P0 — Refuerzo de fronteras automatizadas

**Objetivo:** Tener guards que fallen al detectar cruces de capa no permitidos.

| Tarea | Hecho | Comando de verificación |
|------|-------|------------------------|
| Añadir capa `application` a `ARCHITECTURE_RULES` | ✅ | `npm run architecture:check` |
| Añadir clasificación `classifyModule` para `application/` | ✅ | — |
| Test de dependencia sintética prohibida | ✅ | `node --test tests/architecture.test.mjs` |
| Grafo real pasa sin violaciones | ✅ | `npm run architecture:check` |

**Criterios de aceptación:**
- `npm run architecture:check` reporta `Guardia de arquitectura OK` o lista únicamente violaciones esperadas.
- Una importación `application/... -> ui/...|persistence/...|cli/...|cloud/...|composition/...` se marca como `forbidden-import`.
- Una importación `application/... -> core.js|calendar-contract.js|domain/...` está permitida.

**Riesgos controlados:**
- Si algún módulo existente bajo `src/application/` ya cruza una frontera, el check fallará y deberá reubicarse. No se tocará el código ajeno; el reporte guía la corrección.

---

### P1 — Aplicación de límites de imports

**Objetivo:** Consolidar la regla de que la capa `application` no depende de UI, persistence, cloud, cli ni composition.

**Responsabilidad por capa (resumen):**

| Capa | Puede importar | No puede importar |
|------|----------------|-------------------|
| `application` | `core`, `contract`, `domain` | `ui`, `persistence`, `cli`, `cloud`, `composition` |
| `core` | `ui`, `persistence`, `cli`, `cloud`, `composition` (misma que antes) | — |
| `domain` | — (funciones puras) | `ui`, `persistence`, `cli`, `cloud`, `composition` |
| `ui` | `persistence`, `cli`, `cloud`, `composition` | — |
| `cli` | `ui`, `persistence`, `cloud`, `composition` | — |
| `composition` (app.js) | — | — |

**Estrategia de integración incremental:**
1. Ejecutar `npm run architecture:check` sobre el código actual: debe pasar (grafo existente no tiene módulos `application/`).
2. Si se crea un módulo nuevo bajo `src/application/`, asegurar que sus imports sean solo a `core`, `contract` o `domain`.
3. Después de cada módulo añadido, ejecutar `npm run architecture:check` como gate de CI.
4. Documentar en `docs/ARQUITECTURA.md` la nueva capa si es necesario, enlazando desde el mapa de capas.

**Criterios de aceptación:**
- Zero `forbidden-import` violations for the `application` layer in the real graph.
- `npm run architecture:check` no introduce regressions en capas existentes.
- Cada módulo nuevo bajo `application/` incluye prueba directa que valida su frontera.

**Riesgos:**
- Introducción accidental de una dependencia de UI o persistence en un módulo application. El check de arquitectura fallará al instante, facilitando la corrección.
- Confusión con la capa `import` existente. La regla es: `import` ya está documentado en `ARCHITECTURE_RULES`; `application` es una capa nueva y distinta para código de aplicación específico.

---

### P2 — Cierre verificable

**Objetivo:** Garantizar que el grafo de dependencias sea estable y el plan sea viviente.

**Estrategia de integración:**
1. `npm run architecture:check` se ejecuta en cada PR como gate automático.
2. `npm test` debe seguir pasando (149 pruebas).
3. `npm run verify` ( = `npm run test && npm run architecture:check && npm run build && npm run version:check && npm run audit`) debe completarse sin errores.
4. El diff de cualquier PR que añada código bajo `src/application/` debe ser revisado para confirmar que no hay imports prohibidos.

**Criterios de aceptación:**
- `npm run architecture:check` → `Guardia de arquitectura OK`.
- `npm test` → 149 pruebas aprobadas.
- `npm run verify` → éxito total.
- No se ha reescrito `src/app.js`, `src/core.js`, `src/calendar-contract.js`, `src/cloud.js`, `src/ui/`, `src/persistence/`, `src/import/` ni `package.json`.

**Riesgos documentados:**
- Si en el futuro se decide una reescritura importante, las guardas automatizadas preservarán la invariante de que ninguna capa depende de una por debajo suya, salvo las excepciones documentadas (core ↔ ui/persistence/cli/cloud composición, aplicación ↔ core/contract/dominio).

---

## Compromisos y límites

- **No se realizará reescritura del código fuente existente:** El plan añade guarda y documentación sobre el código actual. Módulos como `src/app.js`, `src/core.js`, `src/calendar-contract.js`, `src/cloud.js`, `src/ui/`, `src/persistence/`, `src/import/` y `package.json` no serán tocados.
- **No se cambiará la base de datos:** El plan respeta el contrato de persistencia y cloud existente. No hay migraciones ni cambios de esquema.
- **Guards basadas en rutas de importación:** La detección usa el parser de imports locales del grafo (`staticImportPattern`/`dynamicImportPattern`), no strings ni comentarios. Esto lo hace robusto y no frágil.
- **Una nueva capa, no un nuevo validador:** Se reutiliza la función `classifyModule` y la tabla `ARCHITECTURE_RULES` existentes; no se duplica el parser del grafo.

---

## Integración con la documentación existente

El archivo `docs/ARQUITECTURA.md` permanece inalterado salvo la posible adición de un apunte que enlace a este plan desde la sección de capas o fronteras. Cualquier actualización al `ARQUITECTURA.md` será mínima y orientada a enlaces, no a reescribir el mapa de dependencias.

## Comandos de verificación

```bash
npm run architecture:check    # guarda de fronteras
npm test                      # 149 tests
npm run verify                # tests + architecture + build + version + audit
```