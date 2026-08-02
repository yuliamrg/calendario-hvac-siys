# Historial de cambios

## [0.10.0-beta.4] - 2026-08-02

### Mejorado

- El estado de la actividad vuelve a una señal compacta en la tarjeta beta:
  icono con contorno y nombre accesible completo en tooltip y lector de pantalla.
- Se elimina la palabra visible completa para conservar espacio para sede y
  responsable.

### Compatibilidad

- Sin cambios en esquema, respaldos, exportaciones, persistencia ni canal estable.

## [0.10.0-beta.3] - 2026-08-02

### Mejorado

- Las tarjetas de actividad muestran el estado en texto dentro del canal beta.
- La etiqueta textual es exclusiva de beta para comparar el flujo con estable.

### Compatibilidad

- Sin cambios en esquema, respaldos, exportaciones, persistencia ni canal estable.

## [0.10.0] - 2026-08-01

### Promovido

- La beta visual `0.10.0-beta.2` pasa a ser el contrato público estable.
- El canal estable y `/beta/` comparten la misma interfaz, tipografía,
  densidad, tema, tarjetas y controles; mantienen bases locales separadas.

### Compatibilidad

- Sin cambios en el esquema 3, respaldos, exportaciones ni persistencia.

## [0.10.0-beta.2] - 2026-08-01

### Mejorado

- Cambio directo entre tema del sistema, claro y oscuro desde Configuración.
- Encabezado de días persistente y más compacto al desplazar el calendario.
- Detalle de actividad reorganizado en dos columnas, con bloques extensos a
  todo el ancho y menor separación vertical.
- Búsqueda y filtrado por nombre, ciudad o grupo en responsables, con render
  diferido para evitar reconstrucciones innecesarias durante la escritura.
- Contraste explícito del buscador oscuro y de los botones de selección múltiple
  en modo claro.

### Compatibilidad

- Sin cambios en el esquema 3, IndexedDB, respaldos, exportaciones ni canal
  estable.

## [0.9.0] - 2026-07-30

### Añadido

- Agenda diaria como vista móvil principal, con navegación por día y selector
  mensual superpuesto.
- Cabecera móvil reducida a **Nueva actividad**, **Ver mes** y **Más**.
- Detalle de actividad centrado en escritorio y casi a pantalla completa en
  móvil.

### Mejorado

- Menús con vocabulario operativo y explicaciones breves en lugar de nombres
  técnicos de formatos.
- Nombres de descarga reconocibles, con fecha, hora, periodo y cronograma.
- Tema claro inicial; Claro, Oscuro y Sistema siguen disponibles y se
  recuerdan por canal.
- Contraste oscuro de acciones, chips, avisos y estados.
- Un solo menú superior abierto; cierre por acción, clic externo o Escape.
- Botón semántico de panel para mostrar u ocultar el banco.

### Compatibilidad

- Sin cambios en el esquema 3, IndexedDB, series, respaldos ni separación de
  canales local, estable y beta.

## [0.8.0] - 2026-07-30

### Añadido

- Mes compacto con agenda seleccionada para teléfonos y tabletas verticales.
- Panel lateral táctil para el banco de tarjetas.
- Acción por fecha **Mover · Duplicar · Ampliar** desde el detalle, sin
  depender de arrastrar y soltar.
- Adaptación de cabecera, filtros, formularios, diálogos, selección múltiple y
  avisos para pantallas estrechas.

### Compatibilidad

- Tablero completo en tablet horizontal y escritorio.
- Exportaciones, impresión, persistencia y separación de canales sin cambios.

## [0.7.0] - 2026-07-30

### Añadido

- Temas Claro, Oscuro y Sistema con respuesta en vivo a la preferencia del
  navegador.
- Preferencia visual separada por canal y excluida del documento operativo.
- Exportación PNG acorde con el tema activo.

### Accesibilidad

- Colores oscuros específicos para calendario, tarjetas, formularios,
  diálogos y estados de interacción.
- Impresión forzada a presentación clara.

## [0.6.0] - 2026-07-30

### Añadido

- Operación **Añadir desde JSON** con vista previa, resolución por fecha y
  aplicación atómica deshacible.
- Esquema 3 con `updatedAt` por registro maestro, serie y excepción.
- Canal beta en `/beta/`, aislado de la versión estable mediante IndexedDB.
- Publicación dual: estable desde una etiqueta fijada y beta desde `main`.

### Compatibilidad

- Los documentos de esquema 1 y 2 se migran automáticamente.
- Restaurar JSON continúa reemplazando el cronograma; añadir JSON nunca elimina
  registros por ausencia.

## [0.5.0] - 2026-07-30

### Añadido

- Marca SIYS Sync, logo y favicon autocontenidos.
- Cabecera compacta con acciones agrupadas y banco ocultable.
- Diálogo Mover, Duplicar o Ampliar al arrastrar una tarjeta.
- Actividades ampliadas con ocurrencias diarias enlazadas mediante `seriesId`.
- Reinicio seguro con respaldo previo y confirmación escrita.

### Corregido

- Soltar una tarjeta en su misma fecha ya no registra una reprogramación.
- El banco utiliza desplazamiento propio y el fondo de un día abre la fecha
  correspondiente en el formulario.

## [0.4.0] - 2026-07-30

### Añadido

- Distribución idéntica para archivo local y GitHub Pages.
- Integración continua, auditoría autocontenida y despliegue desde `main`.
- Indicador visible del modo local o Pages y recordatorio de persistencia
  exclusiva del navegador.

## [0.3.0] - 2026-07-30

### Añadido

- Filtros multiselección por ciudad, cliente, sede, responsable, servicio y
  estado.
- Exportación PNG de la vista filtrada mediante Canvas nativo.
- Plantilla Excel e importación validada de programación.
- Manual de uso y guía de Base Operativa.

## [0.2.0] - 2026-07-30

### Añadido

- Identificación del cronograma, coordinador y revisión.
- Respaldo JSON versionado y migración desde `v0.1.0`.
- Estado de persistencia del navegador y bloqueo seguro entre pestañas.
- Edición y eliminación múltiple con validación atómica y Deshacer.

## [0.1.0] - 2026-07-30

### Añadido

- Primer calendario autocontenido con IndexedDB, Base Operativa, festivos
  colombianos, tarjetas multidía, responsables y exportación CSV.
