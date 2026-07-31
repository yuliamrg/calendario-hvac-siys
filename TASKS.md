# Plan de ejecución

Este archivo se actualiza al cerrar cada bloque con pruebas verificables. Las
versiones se construyen de forma acumulativa sobre `v0.1.0`.

## Fase 1 — Operación y persistencia (`v0.2.0`)

- [x] Migrar documentos y respaldos de esquema 1 a esquema 2.
- [x] Añadir nombre del cronograma, coordinador y revisión.
- [x] Mostrar el estado de almacenamiento y solicitar persistencia al navegador.
- [x] Crear respaldos versionados y vista previa segura de restauración.
- [x] Evitar ediciones simultáneas destructivas entre pestañas.
- [x] Eliminar varias tarjetas con confirmación y Deshacer.
- [x] Editar campos operativos de varias tarjetas de forma atómica.
- [x] Ampliar pruebas unitarias y pruebas reales en Chrome y Edge.
- [x] Documentar y etiquetar `v0.2.0`.

## Fase 2 — Productividad, importación y documentación (`v0.3.0`)

- [x] Añadir filtros multiselección combinables.
- [x] Exportar el mes filtrado como imagen PNG.
- [x] Generar y descargar la plantilla Excel de programación.
- [x] Importar programación Excel con vista previa, validación y Deshacer.
- [x] Publicar manual completo, guía de Base Operativa y CHANGELOG.
- [x] Verificar escenarios unitarios y de navegador.
- [x] Documentar y etiquetar `v0.3.0`.

## Fase 3 — Distribución (`v0.4.0`)

- [x] Crear el repositorio público `yuliamrg/calendario-hvac-siys`.
- [x] Publicar el historial y las etiquetas sin datos operativos.
- [x] Incorporar integración continua y auditoría autocontenida.
- [x] Desplegar GitHub Pages desde `main` mediante GitHub Actions.
- [x] Verificar persistencia local, separación de orígenes y portabilidad JSON.
- [x] Ejecutar la auditoría final y etiquetar `v0.4.0`.

## Evidencia de cierre

- Fase 1: commit `43c8e43`, etiqueta `v0.2.0`, PR #1, 26 pruebas,
  respaldo real `v0.1.0` migrado y Chrome/Edge aprobados.
- Fase 2: commit `72ce6d8`, etiqueta `v0.3.0`, PR #2, 34 pruebas,
  XLSX reabierto/importado, PNG validado y Chrome/Edge aprobados.
- Fase 3: PR #3, CI aprobado y despliegue Pages aprobado en
  `https://yuliamrg.github.io/calendario-hvac-siys/`.
- Producción: persistencia tras recarga, segunda pestaña en lectura, separación
  `https://`/`file://`, portabilidad JSON y restauración en contexto limpio.
- Cierre: PR #4 conserva el smoke reproducible; PR #5 prueba y persiste la
  recuperación desde `recovery` cuando `current` está corrupto.

## Goal SIYS Sync — evolución `v0.5.0` a `v0.8.0`

### Versión 0.5.0 — experiencia, marca y operaciones

- [x] Implementar la marca SIYS Sync, logo y favicon autocontenidos.
- [x] Compactar la cabecera y agrupar acciones secundarias.
- [x] Permitir ocultar el banco y darle scroll independiente.
- [x] Abrir una actividad al pulsar el fondo de un día.
- [x] Tratar una caída en la misma fecha como operación nula.
- [x] Preguntar Mover, Duplicar, Ampliar o Cancelar al arrastrar una tarjeta.
- [x] Enlazar días ampliados mediante `seriesId` sin repetir IDs.
- [x] Permitir editar un día o los datos comunes de toda la actividad.
- [x] Descargar respaldo y reiniciar los datos persistentes de forma segura.
- [x] Ejecutar pruebas, actualizar documentación y etiquetar `v0.5.0`.

### Versión 0.6.0 — combinación JSON y canales

- [x] Añadir JSON con vista previa sin reemplazar el cronograma actual.
- [x] Migrar el documento de esquema 2 a esquema 3.
- [x] Resolver equivalencias y conflictos por `updatedAt`.
- [x] Aislar IndexedDB entre estable y beta.
- [x] Publicar simultáneamente estable y `/beta/`.
- [x] Ejecutar pruebas, actualizar documentación y etiquetar `v0.6.0`.

### Versión 0.7.0 — modo oscuro

- [ ] Implementar temas Claro, Oscuro y Sistema.
- [ ] Persistir el tema fuera del documento operativo.
- [ ] Adaptar calendario, tarjetas, formularios, exportación e impresión.
- [ ] Verificar contraste, accesibilidad y regresiones.
- [ ] Etiquetar y promover `v0.7.0`.

### Versión 0.8.0 — responsive

- [ ] Implementar tablero de escritorio, tablet y mes con agenda móvil.
- [ ] Proporcionar alternativas táctiles a arrastrar y soltar.
- [ ] Adaptar banco, cabecera, formularios y diálogos.
- [ ] Verificar tamaños, orientaciones, zoom y exportación.
- [ ] Etiquetar y promover `v0.8.0`.

### Cierre del Goal

- [ ] Auditar requisitos, datos heredados, canales, documentación y Git.
- [ ] Confirmar estable en `v0.8.0`, beta operativa y worktree limpio.

## Evidencia del Goal

- v0.5.0: PR #7, 37 pruebas, CI y Pages aprobados; producción coincide con
  `dist/index.html` por SHA-256
  `229E9E94E8A462D2337D437218CD74F943528A3F2699D5B44C6374874443EDE8`.
  Aceptación interactiva: cabecera de 56 px, banco colapsable con scroll,
  creación por día, menús, favicon y consola sin errores.
- v0.6.0: PR #9, 40 pruebas, CI y despliegue dual aprobados. Estable conservó
  v0.5.0 durante la prueba beta; `/beta/` coincidió con el HTML v0.6.0.
  Smoke aislado: bases estable/beta separadas, combinación JSON aplicada y
  deshecha, respaldo portable, restauración limpia y cero solicitudes de red
  después de cargar.
