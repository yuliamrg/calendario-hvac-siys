# Historial de cambios

## [0.15.0-beta.6] - 2026-08-06

### Agenda diaria y días congestionados

- Se alinea la experiencia de planificación local con el flujo de agenda
  diaria y sus acciones de organización.
- Los días con muchas tarjetas muestran un apilado visual y permiten abrir el
  detalle completo del día sin perder el contexto del mes.
- La agenda diaria permite reordenar tarjetas con acciones accesibles, dejando
  el orden persistido y registrado en el historial.

### Compatibilidad

- No cambia el esquema, el contrato de operaciones ni los datos de Supabase.

## [0.15.0-beta.5] - 2026-08-06

### Corrección visual en cronogramas compartidos

- Las tarjetas abiertas en modo solo lectura recuperan el ancho completo del
  contenido después de ocultar los controles de edición.
- Se agrega una prueba de regresión para conservar la retícula correcta en
  beta y estable.

### Compatibilidad

- No cambia el esquema, el contrato de operaciones ni los datos de Supabase.

## [0.15.0-beta.4] - 2026-08-06

### Corrección de cronogramas compartidos

- Cada cuenta crea y abre su propio cronograma por canal, aunque ya exista el
  cronograma de otra cuenta.
- Las cuentas autenticadas pueden consultar, filtrar y descargar los demás
  cronogramas del canal en modo solo lectura; sólo el propietario puede editar.
- Se incorpora la migración cloud y las pruebas del selector y las políticas de
  escritura por propietario.

## [0.15.0-beta.3] - 2026-08-05

### Nueva iteración beta

- Continúa la siguiente línea de desarrollo después del parche stable
  `0.14.1`; conserva la migración segura y la separación de calendarios.

## [0.14.1] - 2026-08-05

### Corrección de continuidad stable

- La stable conserva los datos locales que existían antes de activar Supabase:
  los migra una sola vez cuando el calendario cloud está vacío.
- No se sobrescribe un calendario cloud con datos, no se mezcla beta y la base
  IndexedDB original permanece disponible como respaldo local.
- Se corrige la migración de sesiones heredadas a la clave Auth compartida.

### Compatibilidad

- Mantiene esquema 4, respaldos, CLI, RLS y el calendario cloud estable
  `calendario-hvac-siys`.

## [0.15.0-beta.2] - 2026-08-05

### Continuidad de datos

- La stable detecta una base IndexedDB heredada y la migra a su calendario
  Supabase sólo cuando el documento cloud está vacío.
- La migración conserva la copia local, no sobrescribe un documento cloud con
  datos y no se repite después de un reinicio cloud intencional.
- Las sesiones heredadas por canal se trasladan correctamente a la sesión Auth
  compartida.

## [0.15.0-beta.1] - 2026-08-05

### Nueva línea de desarrollo

- Se inicia la siguiente línea beta después de promover `0.14.0-beta.3` a la
  estable `0.14.0`.
- La raíz estable permanece fijada en `v0.14.0`; los cambios nuevos se prueban
  en `/beta/` antes de otra promoción.

## [0.14.0] - 2026-08-05

### Promovido a estable

- La beta validada `0.14.0-beta.3` pasa a ser la estable `0.14.0` sin
  retaggear el commit beta.
- La raíz de GitHub Pages usa Supabase Auth y PostgREST, igual que `/beta/`.
- La sesión Auth se reutiliza entre canales del mismo origen, mientras los
  calendarios lógicos y sus revisiones permanecen separados.

### Compatibilidad

- Se conserva el esquema 4, el formato de respaldos, la CLI, RLS y la
  migración cloud existente.
- El archivo local continúa funcionando con IndexedDB sin autenticación.

## [0.14.0-beta.3] - 2026-08-05

### Autenticación compartida

- La sesión de Supabase se comparte entre stable y beta en el mismo origen,
  con migración de las claves por canal usadas por las primeras betas.
- Cerrar sesión elimina la sesión compartida y las claves heredadas sin tocar
  los calendarios cloud.

### Compatibilidad

- Esta iteración conserva calendarios lógicos separados y no modifica datos
  operativos; sólo evita autenticaciones duplicadas entre canales.

## [0.14.0-beta.2] - 2026-08-05

### Persistencia cloud

- Stable y beta activan Supabase Auth y PostgREST cuando Pages inyecta la
  configuración pública del proyecto.
- Cada canal conserva su calendario lógico (`calendario-hvac-siys` para stable
  y `calendario-hvac-siys-beta` para beta), sin mezclar ni reemplazar datos.
- Se agrega un smoke autenticado de lectura para verificar Auth, la base cloud,
  el canal del respaldo y el esquema publicado sin escribir datos de operación.

### Compatibilidad

- Este cambio conserva el esquema 4, los respaldos, la CLI y la separación de
  calendarios entre canales. La promoción estable de esta línea activará la
  misma persistencia cloud en la raíz de GitHub Pages.

## [0.14.0-beta.1] - 2026-08-05

### Línea de desarrollo

- Se abre la siguiente línea beta después de promover `0.13.0-beta.2` a
  `0.13.0`; las nuevas implementaciones se incorporarán aquí.

### Compatibilidad

- Este baseline conserva el esquema 4, los respaldos, la CLI y la separación
  de persistencia entre estable local y beta cloud.

## [0.13.0] - 2026-08-05

### Promovido

- La beta probada `0.13.0-beta.2` pasa a ser la versión estable `0.13.0`.
- La versión estable incorpora los códigos cortos de servicio y el contrato
  de esquema 4, respaldos y CLI que fueron validados en la beta.

### Compatibilidad

- La estable conserva el almacenamiento local IndexedDB y su base separada;
  Supabase continúa restringido al canal beta hasta una decisión explícita.

## [0.13.0-beta.2] - 2026-08-05

### Mejorado

- Las tarjetas muestran un código corto para el tipo de servicio: `MP`, `MC`,
  `EM`, `DG`, `GA` o `AD`.
- El nombre completo del servicio permanece disponible en el detalle y en la
  etiqueta accesible de la tarjeta.

### Compatibilidad

- Sin cambios en el esquema 4, la persistencia cloud, los respaldos ni el
  canal estable.

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
