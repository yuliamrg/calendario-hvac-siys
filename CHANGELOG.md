# Historial de cambios

## [0.19.0] - 2026-10-06

### Publicación estable en GitHub Pages

- Se promueve la beta certificada `0.19.0-beta.2` sin cambios funcionales
  adicionales. Web estable pasa a `0.19.0`.
- La raíz y `/beta/` sirven temporalmente la misma versión hasta que exista una
  nueva capacidad beta; no se abre otra línea beta ni se crea una GitHub Release
  para Web.
- Calendary CLI permanece en `0.18.0-beta.1`, Platform en `0.0.0`, Schema en 4,
  Contract en 1 y backup format en 1. No hay cambios Supabase/RPC.

## [0.19.0-beta.2] - 2026-10-06

### Durabilidad de guardado Web

- Cada guardado confirma únicamente la generación que alcanzó persistencia; una
  escritura anterior deja pendientes los waiters de una edición posterior.
- El respaldo manual captura su snapshot después de registrar `lastBackupAt` y
  `backup_created`. Si la persistencia falla, aun así descarga el JSON de
  recuperación sin declarar el documento guardado ni limpiar la protección de
  salida; el reset destructivo continúa bloqueado por `flushSave()`.
- Un respaldo normal descarga después de confirmar su guardado; `flushSave()`
  conserva la propagación de fallos y no se agregan reintentos.
- La página activa la confirmación estándar del navegador durante una salida
  interactiva si hay cambios sin confirmar; la protección permanece ante fallos
  y desaparece cuando persiste la generación más reciente.
- No se cambian Supabase, RPC, Schema 4, Contract 1, formato de respaldo 1 ni
  Calendary CLI `0.18.0-beta.1`; la beta se promovió a Web estable `0.19.0`.

## [0.19.0-beta.1] - 2026-10-05

### Búsqueda temporal dentro de los filtros

- El diálogo de filtros incorpora un buscador propio para Cliente, Sede y
  Responsable; escribir filtra en vivo las opciones visibles de esa categoría.
- La búsqueda es temporal: no se persiste, no viaja a Supabase, no modifica
  actividades ni `appDocument`, y no reemplaza ni reutiliza la búsqueda global
  (`settings.filters.query`).
- Marcar una opción y luego ocultarla con la búsqueda la conserva seleccionada y
  formando parte del filtro; al limpiar el texto reaparece marcada. Escribir en
  el buscador nunca desmarca opciones.
- Si no hay coincidencias, la categoría muestra "Sin coincidencias". Los conteos
  de cada opción conservan su significado y no se recalculan por la búsqueda.
- Se conservan `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1`, el formato de
  respaldo `formatVersion = 1`, los filtros y el backend Supabase; no hay
  migraciones.
- Calendary CLI permanece independiente en `0.18.0-beta.1` y Platform en
  `0.0.0`. Web estable continúa en `0.18.1`; esta beta queda preparada en la
  feature, pendiente de PR, integración y certificación.

## [0.18.1] - 2026-10-05

### Publicación estable en GitHub Pages

- Se publica SIYS Sync Web `0.18.1` como versión estable, promovida desde la
  línea validada `0.18.1-beta.1`. No se agrega funcionalidad nueva: es la misma
  implementación de la beta, sin cambios de UI, calendario ni comportamiento.
- El selector de responsables reutiliza el índice de cobertura que ya existe en
  Platform: se construye un único snapshot por render y se usa tanto para
  ordenar como para mostrar, en vez de reconstruir los mapas de cobertura en
  cada comparación y en cada fila.
- Las reglas visibles de ranking no cambian: cobertura por grupo, ciudad base,
  cobertura directa, cobertura nacional, favoritos y orden alfabético producen
  exactamente el mismo orden funcional que antes; sólo mejora el rendimiento.
- Se conserva el smoke autenticado de sólo lectura integrado, que confirma el
  selector de responsables sin mutaciones REST durante su uso.
- Se conservan `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1`, el formato de
  respaldo `formatVersion = 1` y el backend Supabase; no hay migraciones.
- Calendary CLI permanece independiente en `0.18.0-beta.1`; Platform continúa
  interno en `0.0.0`. La promoción sólo afecta a Web.
- La raíz privada no tiene versión. El tag certificado `web-v0.18.1` identifica
  el commit de release y el puntero estable `stable-version.txt` apunta a ese
  tag; la raíz GitHub Pages y `/beta/` sirven Web `0.18.1`. El tag se crea
  después de integrar el commit que pasa CI y Pages.

## [0.18.1-beta.1] - 2026-10-05

### Rendimiento de selección de responsables

- La selección de responsables de Web reutiliza el índice de cobertura que ya
  existe en Platform: se construye un único snapshot por render y se usa tanto
  para ordenar como para mostrar, en vez de reconstruir los mapas de cobertura
  en cada comparación y en cada fila.
- Las reglas visibles de ranking no cambian: cobertura por grupo, ciudad base,
  cobertura directa, cobertura nacional, favoritos y orden alfabético producen
  exactamente el mismo orden que antes.
- Es una beta de rendimiento y usabilidad de Web. Calendary CLI permanece en
  `0.18.0-beta.1` y Platform en `0.0.0`.
- Se conservan `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1`, el formato de
  respaldo `formatVersion = 1` y el backend Supabase; no hay migraciones.
- Web estable continúa en `0.18.0`; esta beta queda preparada en la feature,
  pendiente de PR, integración y certificación.

## [0.18.0] - 2026-10-05

### Publicación estable en GitHub Pages

- Se publica SIYS Sync Web `0.18.0` como versión estable, promovida desde la
  línea validada `0.18.0-beta.2`. El tag certificado `web-v0.18.0` identifica
  el commit `a9c946e934f7cb9ac3609f22ed6c0d2f373a3651` y
  `stable-version.txt` apunta a ese tag. No se agrega funcionalidad nueva.
- Platform Architecture V2 ya está completa; esta promoción no abre nuevos
  workstreams ni modifica infraestructura.
- Calendary CLI permanece independiente en `0.18.0-beta.1`; no se cambia por
  simetría ni se publica una release CLI nueva. Platform continúa interno en
  `0.0.0`.
- Se conservan `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1` y el formato de
  respaldo `formatVersion = 1`; Supabase no cambia.
- La raíz GitHub Pages sirve Web estable `0.18.0`; `/beta/` también sirve
  actualmente `0.18.0` desde `main`, con calendarios lógicos separados.
- Web se distribuye por GitHub Pages y no tiene GitHub Release. La GitHub
  Release de CLI `0.18.0-beta.1` se conserva sin cambios.

## [0.18.0-beta.2] - 2026-09-29

### Identidades independientes de producto

- El código compartido deja de poseer una versión de producto; Web y Calendary
  CLI declaran identidades independientes.
- Web avanza a `0.18.0-beta.2` porque integrar en `main` vuelve a publicar
  `/beta/`; Calendary CLI conserva `0.18.0-beta.1`.
- `document.appVersion` queda como metadato legado preservado. El exportador
  Web pasa su versión explícitamente al envelope del respaldo.
- Se conservan `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1` y
  `formatVersion = 1`; no hay cambios de backend ni reorganización física del
  monorepo en Workstream 1.
- El tag histórico `v0.18.0-beta.1` permanece inmutable; el tag Web
  `v0.18.0-beta.2` se crea después de integrar el commit que pasa CI y Pages.
  Stable continúa en `v0.17.0`.

## [0.18.0-beta.1] - 2026-09-29

### Nuevas capacidades y arquitectura

- Calendary CLI opera como cliente cloud de Supabase con lectura y mutaciones
  mediante el contrato compartido, incluidos backup restore/merge y
  `calendar.identify` cloud.
- Supabase es la única autoridad de estado de la CLI; los archivos sólo son
  operandos o salidas. Browser y CLI reutilizan el transporte Supabase.
- Web y CLI son clientes distintos del mismo backend: Web corre en navegador
  como HTML estático y CLI en Node local. La CLI no forma parte del HTML ni
  de Pages; empaquetado y versionamiento independientes quedan diferidos.

### Persistencia

- El browser usa el RPC atómico `persist_calendar_document`: CAS por
  `calendar_documents.revision`, documento, schema version y sincronización
  de nombre/coordinador en una sola transacción.
- La migración del RPC ya fue aplicada y certificada en el backend de
  desarrollo durante el workstream previo; esta preparación no modifica Supabase.

### Seguridad y operación

- Auth normal, sin service role; los conflictos no se reaplican automáticamente
  y la selección de calendarios debe ser inequívoca.

### Compatibilidad y preparación

- Se conservan `SCHEMA_VERSION = 4`, `CONTRACT_VERSION = 1` y los respaldos.
- Stable continúa en `v0.17.0`. El delta público y operativo posterior a
  `0.17.0` abre la nueva línea beta `0.18.0`.
- `0.18.0-beta.1` queda preparada en la feature, pendiente de PR e integración;
  todavía no está etiquetada ni se acredita su despliegue.

## [0.17.0] - 2026-09-20

### Promoción a estable

- Se promueve íntegramente `0.17.0-beta.1` a `0.17.0` después de validar el
  contrato, la persistencia, la CLI, Supabase y los canales públicos estable y
  beta.
- Se conserva el esquema 4, el contrato de operaciones 1, los respaldos y la
  separación de calendarios lógicos stable/beta.

### Compatibilidad

- La promoción no migra ni mezcla documentos: el canal estable conserva su
  calendario y el canal beta conserva el suyo.
- Las cuatro migraciones locales están alineadas con la base remota y no se
  requiere una migración adicional para esta release.

## [0.17.0-beta.1] - 2026-08-23

### Nuevas capacidades públicas

- Se incorpora una presentación de actividades reutilizable para tarjetas, agenda
  diaria y exportaciones, con layout de exportación y tokens visuales compartidos.
- Se centralizan las mutaciones de calendario y las importaciones en la capa de
  aplicación; el contrato de calendario añade identificación explícita sin cambiar
  `SCHEMA_VERSION = 4` ni `CONTRACT_VERSION = 1`.
- Se refuerza la persistencia local ante `versionchange`, heartbeats inválidos y
  liberación atómica del lock.

### Calidad y distribución

- Se valida automáticamente el manifiesto de módulos, el orden de imports y las
  fronteras de arquitectura; `architecture:check` queda incluido en `verify`.
- Se regeneran los artefactos autocontenidos de `dist/` y se sincroniza la
  documentación del sistema, estados, distribución y operación.
- La versión se inicia como `0.17.0-beta.1` porque el conjunto posterior a
  `0.16.0-beta.2` incorpora capacidades públicas nuevas; no es otra iteración
  del alcance ya anunciado de `0.16.0`.

### Compatibilidad

- Stable permanece apuntando a `v0.15.0`; esta publicación sólo actualiza la
  nueva línea beta `0.17.0`.
- Se conservan el esquema 4, el contrato de operaciones 1, los respaldos y la
  separación de calendarios stable/beta.

## [0.16.0-beta.2] - 2026-08-19

### Correcciones de experiencia

- Se corrige el scroll lento de los formularios al dejar un único contenedor de
  desplazamiento, limitar el encadenamiento y mantener visibles las acciones.
- Se elimina el desenfoque costoso del fondo de los modales y se pausa la animación
  3D mientras hay un modal abierto o la pestaña está oculta.
- Se actualizan las pruebas responsive para confirmar el flujo unificado de ampliación
  por rango.
- Se corrige el workflow de CI para instalar las dependencias antes de construir el
  artefacto autocontenido.

### Compatibilidad

- Stable permanece apuntando a `v0.15.0`; esta publicación sólo actualiza la línea
  beta `0.16.0`.

## [0.16.0-beta.1] - 2026-08-15

### Nuevas implementaciones en beta

- Se bloquean colisiones de una misma actividad ampliada al mover o editar una tarjeta.
- Se puede ampliar o duplicar una actividad a un rango, omitiendo domingos y festivos
  salvo inclusión explícita.
- Los filtros aceptan un día exacto o un rango inclusivo.
- Los responsables se ordenan por cobertura territorial del grupo y la Base Operativa
  admite la columna opcional `Cobertura`.
- Cliente, sede y responsables pueden escribirse con sugerencias; los nombres nuevos
  se crean de forma atómica y manual.
- Se agrega normalización controlada de textos visibles y una capa opcional de movimiento
  visual con Three.js autocontenido, con protección para accesibilidad y WebGL no disponible.

### Compatibilidad

- Stable permanece apuntando a `v0.15.0`; esta rama sólo prepara la línea beta `0.16.0`.
- Se conserva el esquema 4 y las operaciones existentes; las nuevas operaciones se agregan
  de forma compatible.

## [0.15.0] - 2026-08-15

### Promoción a estable

- Se promueve íntegramente la línea `0.15.0-beta.8` a `0.15.0` después de su
  validación en beta.
- Incluye cronogramas por usuario y canal, lectura compartida, agenda diaria,
  reordenamiento persistido, refactorización modular y provisión idempotente
  de calendarios cloud.

### Compatibilidad

- Conserva el esquema, el contrato de operaciones, los respaldos, la CLI y la
  separación de calendarios stable/beta.

## [0.15.0-beta.8] - 2026-08-13

### Cronogramas por usuario

- Se actualiza automáticamente la lista de cronogramas al volver a la pestaña,
  recuperar el foco, pulsar el botón de actualización o cada 30 segundos.
- Las cuentas nuevas reciben un cronograma vacío por canal y se completa de
  forma idempotente la cobertura de cuentas existentes sin calendario.
- Se reparó y verificó el historial remoto de migraciones de Supabase para que
  el esquema de lectura compartida quede alineado con el repositorio.

### Compatibilidad

- No se modifican actividades ni documentos existentes; la provisión sólo crea
  filas de calendario faltantes y conserva la separación stable/beta.

## [0.15.0-beta.7] - 2026-08-07

### Refactorización interna

- Se separan dominio, importación, persistencia, presentación y CLI en módulos
  enfocados, conservando las fachadas públicas existentes.
- Se dividen coordinadores extensos, se centralizan utilidades repetidas y se
  eliminan referencias muertas demostradas.
- Los estilos se organizan por base, responsive y contrato visual sin cambiar
  el orden de la cascada.
- El build valida la sintaxis del bundle autocontenido y se añaden pruebas
  directas para los módulos extraídos.

### Compatibilidad

- No cambia el esquema, el contrato de operaciones, el DOM ni los calendarios
  separados de Supabase para stable y beta.

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
