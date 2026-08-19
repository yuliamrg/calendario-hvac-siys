# Sistema actual: Calendary / SIYS Sync

Estado de esta página: entregable S-01, descripción del worktree local
observado el 2026-08-19. Describe el sistema que está en el código y la
configuración actuales; no certifica que dist/ sea publicable ni que el
Supabase remoto tenga exactamente las migraciones del repositorio.

## Cómo leer este documento

- **Hecho verificado**: se comprobó leyendo código, configuración, pruebas o
  documentación existente.
- **Decisión vigente**: regla de diseño que el código o el contrato ya aplica.
- **Pendiente**: una brecha, una verificación externa o una decisión que no se
  debe convertir en arquitectura futura por inferencia.

Las rutas enlazadas son relativas a este archivo. El worktree ya tenía cambios
locales en otros archivos al iniciar S-01; esos cambios no se atribuyen a este
documento.

## 1. Propósito y límites

### Hechos verificados

Calendary es una aplicación estática para planificar servicios HVAC de SI&S:
mantiene un documento de cronograma con catálogo, actividades, series,
festivos/excepciones, filtros, auditoría y metadatos del cronograma. La misma
interfaz puede ejecutarse como módulos ES durante desarrollo y como un HTML
autocontenido generado por [scripts/build.mjs](../scripts/build.mjs).

El sistema tiene dos formas de persistencia:

- un modo local, sin autenticación, que guarda en IndexedDB del origen y del
  perfil del navegador;
- un modo cloud para los canales estable y beta cuando el HTML recibe una URL y
  una clave publishable de Supabase, con Auth, PostgREST y PostgreSQL.

El documento operativo sigue siendo JSON. En Supabase se guarda como una única
columna jsonb en public.calendar_documents; no hay una lectura o escritura
directa de órdenes SIYS, Outlook, PILA, compras o facturación. El repositorio
no contiene un cliente para esos sistemas.

La Base Operativa y la programación Excel son entradas suministradas por el
usuario. La aplicación las analiza, muestra una vista previa y copia sólo los
campos admitidos al documento; no guarda ni modifica el libro original. La
lista de exclusiones está en [docs/BASE_OPERATIVA.md](BASE_OPERATIVA.md).

### Decisiones vigentes

- La interfaz estática es el producto; GitHub Pages no ejecuta un backend.
- Local, estable y beta son superficies distintas. Una copia JSON es un
  mecanismo de traslado o recuperación, no una réplica automática.
- El documento y el contrato de calendario se tratan como fronteras de
  compatibilidad para la interfaz, la CLI y los respaldos.

### Pendientes

- No está documentada ni implementada una sincronización en tiempo real del
  documento abierto; el refresco cloud actual sólo actualiza la lista de
  cronogramas.
- La CLI no soporta consultas históricas as-of, escrituras cloud ni
  migraciones de datos; esos límites son intencionales en la fase actual.

## 2. Actores y superficies

| Actor o superficie | Qué hace | Lectura/escritura y frontera | Referencias actuales |
| --- | --- | --- | --- |
| Coordinador u operador | Abre el calendario, importa, edita, filtra, exporta y recupera respaldos. | Opera sobre una copia en memoria. Sólo el editor local o el propietario cloud puede guardar. | [src/app.js](../src/app.js), [src/index.template.html](../src/index.template.html) |
| Browser local | Sirve el HTML desde file:, localhost, 127.0.0.1, ::1 o un dominio .localhost. | Usa IndexedDB; localStorage sólo conserva preferencias y, si corresponde, sesión cloud. El origen y el perfil aíslan los datos. | [src/core.js](../src/core.js), [src/persistence/indexed-document-store.js](../src/persistence/indexed-document-store.js) |
| GitHub Pages | Sirve el mismo tipo de HTML estático en la raíz estable y /beta/. | No contiene la base de datos. El workflow inyecta la configuración pública de Supabase durante el build. | [.github/workflows/pages.yml](../.github/workflows/pages.yml), [docs/DISTRIBUCION.md](DISTRIBUCION.md) |
| Supabase Auth | Autentica la cuenta y emite la sesión usada por el navegador o la CLI. | Requiere cuenta autenticada en cloud. El token de acceso no sustituye las políticas RLS. | [src/cloud.js](../src/cloud.js), [src/cli/cloud-auth.js](../src/cli/cloud-auth.js) |
| Supabase/PostgREST/PostgreSQL | Proporciona calendarios lógicos y conserva el documento cloud. | RLS permite lectura a cuentas autenticadas según la migración de lectura compartida; las escrituras del documento quedan restringidas al propietario. | [supabase/migrations/20260803200000_create_calendar_cloud_schema.sql](../supabase/migrations/20260803200000_create_calendar_cloud_schema.sql), [supabase/migrations/20260806120000_shared_calendar_read_access.sql](../supabase/migrations/20260806120000_shared_calendar_read_access.sql) |
| CLI calendary | Inspecciona y consulta respaldos JSON; consulta snapshots cloud; escribe un archivo JSON nuevo en modo file. | No abre IndexedDB. source cloud sólo hace GET; una mutación cloud falla antes de escribir. | [bin/calendary.js](../bin/calendary.js), [src/cli/main.js](../src/cli/main.js), [docs/CLI.md](CLI.md) |
| Excel / Base Operativa | Aporta catálogo y, mediante otra plantilla, filas de programación. | Es una fuente de entrada de importación; el libro no se modifica ni se vuelve una dependencia runtime. | [src/import/base-operativa.js](../src/import/base-operativa.js), [src/import/programming.js](../src/import/programming.js) |
| Mantenedor y CI | Cambia fuentes, migraciones, tests y artefactos; CI verifica el resultado. | Debe distinguir fuentes, artefactos generados, canales y cambios locales. | [package.json](../package.json), [.github/workflows/ci.yml](../.github/workflows/ci.yml) |

## 3. Contexto y componentes

### Diagrama textual de contexto

~~~text
                         repositorio Git
       src + template + CSS + vendor + migraciones + tests
                                |
                         scripts/build.mjs
                                |
                 dist/calendario-hvac-siys.html + dist/index.html
                                |
              +-----------------+------------------+
              |                                    |
      archivo/servidor local                 GitHub Pages
              |                         raíz estable /beta/
              v                                    |
        Browser + app.js                 config pública inyectada
              |                                    |
     +--------+---------+                  +-------v--------+
     |                  |                  | Supabase Auth  |
  IndexedDB          localStorage          +-------+--------+
 current/recovery   prefs/sesión                   |
     |                                               v
     |                                     PostgREST + RLS
     |                                               |
     |                         profiles / calendars / members /
     |                                  calendar_documents
     |
 Excel ------------------> parser + preview ----------+
 JSON <------------------> UI de respaldos <---------> CLI file
                                                  |
                                           CLI cloud (GET)
~~~

### Diagrama textual de componentes

~~~text
UI y eventos: src/app.js
        |
        +--> presentación: src/ui/*
        +--> contrato: src/calendar-contract.js
        |        |
        |        +--> núcleo: src/core.js
        |                 |
        |                 +--> dominio puro: src/domain/*
        |
        +--> importación: src/importer.js -> src/import/*
        +--> persistencia local: src/persistence/*
        +--> persistencia cloud: src/cloud.js

CLI: src/cli/* -> calendar-contract.js -> core.js/domain/*
     file source -> JSON nuevo
     cloud source -> Auth + GET PostgREST -> snapshot actual

Build: applicationModulePaths + styles + template + SheetJS + Three.js
       -> dos HTML autocontenidos
~~~

El gráfico representa el código actual. No implica que la CLI y la interfaz
compartan todos los flujos: el contrato es común para operaciones de calendario,
pero Excel, IndexedDB, DOM, exportación PNG y bloqueo de pestañas permanecen en
la interfaz.

## 4. Selección de canal y superficies de ejecución

runtimeChannelForLocation() en [src/core.js](../src/core.js) aplica estas
reglas en este orden:

| Condición de ubicación | Canal calculado | Persistencia cloud |
| --- | --- | --- |
| pathname contiene /beta/ | beta | Se activa sólo con configuración Supabase completa. |
| Protocolo file: o host local (localhost, 127.0.0.1, ::1, *.localhost) | local | Nunca se activa por shouldUseSupabaseCloud(). |
| Cualquier otra ubicación | stable | Se activa sólo con configuración Supabase completa. |

En src/app.js, el canal beta usa la base IndexedDB
calendario-hvac-siys-beta; los demás canales locales usan
calendario-hvac-siys. El aislamiento del navegador depende además del origen.
En cloud, src/cloud.js asigna los identificadores lógicos
calendario-hvac-siys para estable y calendario-hvac-siys-beta para beta.

Las superficies públicas configuradas en el repositorio son la raíz estable
https://yuliamrg.github.io/calendario-hvac-siys/ y el canal beta
https://yuliamrg.github.io/calendario-hvac-siys/beta/. La existencia y el
contenido actualmente servidos por esas URLs no se verificaron en S-01.

La configuración llega al HTML como
globalThis.__SIYS_SUPABASE_CONFIG__. [scripts/build.mjs](../scripts/build.mjs)
la construye desde SIYS_SUPABASE_URL y
SIYS_SUPABASE_PUBLISHABLE_KEY; la clave administrativa service_role y la
contraseña de PostgreSQL no forman parte del contrato del frontend.

## 5. Ciclo de vida: bootstrap, render, mutación y persistencia

### 5.1 Bootstrap y carga inicial

1. [src/index.template.html](../src/index.template.html) carga el DOM, la
   configuración cloud y, al final, el script de aplicación como módulo ES.
2. initialize() en [src/app.js](../src/app.js) llena opciones estáticas,
   aplica el contrato visual, registra eventos y carga preferencias de tema,
   movimiento y panel.
3. loadInitialDocument() selecciona la rama local o cloud.
   - **Local**: abre IndexedDB (documents, versión 1), lee current y ejecuta
     sanitizeDocument(). Si current es inválido, intenta recovery.
   - **Cloud**: crea createSupabasePersistence(), restaura la sesión o abre el
     diálogo Auth, lista/crea el calendario del usuario, lee el documento y lo
     sanea. La stable puede leer una vez el documento local heredado y
     transferirlo únicamente si el cloud está vacío; conserva la copia local.
4. sanitizeDocument() normaliza documentos antiguos al esquema 4 y rechaza
   documentos de una versión de esquema superior.
5. Se determina el acceso de edición: bloqueo local en IndexedDB o rol de
   propietario cloud. Si el almacenamiento local no está disponible, la UI
   queda en memoria y muestra que no hay guardado.

### 5.2 Render

renderAll() toma appDocument como estado de trabajo y actualiza identidad,
filtros, banco de catálogo, calendario, selección, recordatorio de respaldo,
modo de acceso, selector de cronograma cloud y cajones abiertos. El render no
escribe por sí mismo el documento, salvo que un evento de UI posterior cambie
un ajuste y programe un guardado.

### 5.3 Mutación

La UI usa [src/ui/mutation-controller.js](../src/ui/mutation-controller.js):

- mutateWithContract() llama a executeCalendarOperation(), reemplaza el
  documento sólo si el resultado cambió, conserva un snapshot para Deshacer,
  renderiza y programa el guardado;
- mutate() conserva el mismo rollback para acciones UI específicas, ejecuta un
  callback, actualiza appVersion, schemaVersion, calendarMeta.revision,
  updatedAt, reglas de festivos y auditoría, y luego guarda;
- un error restaura el snapshot anterior.

Las operaciones públicas están declaradas en
[src/calendar-contract.js](../src/calendar-contract.js). El contrato clona y
sanea la entrada, rechaza payloads desconocidos, valida referencias y fechas,
y devuelve changed: false para un no-op. Una mutación real aumenta una vez la
revisión del documento y añade auditoría. La importación de Base Operativa,
la importación de programación y algunos cambios de identificación siguen
siendo callbacks UI de mutate() y no operaciones del contrato compartido.

### 5.4 Guardado local

scheduleSave() espera 250 ms salvo que se solicite guardado inmediato y
encadena las escrituras en saveChain para no invertir su orden. En IndexedDB,
writeWithRecovery() guarda el current anterior como recovery y escribe el nuevo
current en una transacción readwrite. La navegación y los filtros no son por sí
mismos una mutación operativa, aunque settings.currentDate sí se persiste cuando
cambia.

### 5.5 Guardado cloud y conflicto

createSupabasePersistence().write() mantiene la revisión de la fila remota:

1. sin revisión conocida hace POST de un documento nuevo;
2. con revisión conocida hace PATCH condicionado a calendar_id y revision
   esperada;
3. si el PATCH no devuelve filas, lanza SupabaseCloudConflictError;
4. tras escribir el documento, actualiza calendars.name y
   calendars.coordinator.

La revisión de la fila calendar_documents y
document.calendarMeta.revision son contadores distintos. Un conflicto no
mezcla automáticamente cambios: la UI lee el documento remoto más reciente,
lo renderiza y pide revisar antes de continuar. El cambio local que no llegó a
persistirse no se reconcilia automáticamente.

### 5.6 Sincronización y cambio de cronograma

En cloud, la lista de calendarios se refresca al recuperar foco, al volver a
la pestaña, al pulsar el botón de actualización y cada 30 segundos mientras la
pestaña está visible. El cambio de calendario hace flushSave(), selecciona el
registro remoto, lee su documento, limpia selección/Deshacer y recalcula el modo
propietario o solo lectura.

No hay una suscripción Realtime ni un polling del documento actual. Un cambio
externo se detecta de forma determinista cuando el guardado optimista entra en
conflicto, o cuando el usuario cambia de cronograma/recarga.

### 5.7 Bloqueo local y recuperación de control

Sólo el modo local usa el registro edit-lock de IndexedDB. El propietario
actual renueva el heartbeat cada 5 segundos; un registro con más de 15
segundos se considera obsoleto. Las otras pestañas quedan en solo lectura.
BroadcastChannel comunica control-taken y data-reset dentro del canal.
**Tomar control** fuerza la reserva y vuelve a cargar current. En beforeunload
se intenta vaciar el guardado pendiente, detener timers, liberar el lock y
cerrar el canal. Cloud no usa este lock: la autoridad de concurrencia es la
escritura condicionada por revisión y la RLS del propietario.

## 6. Matriz de fuente de verdad

| Dato | Estado de trabajo | Fuente durable/autoridad actual | Copias o límites |
| --- | --- | --- | --- |
| Actividades y fechas | appDocument.activities | Local: registro IndexedDB current. Cloud: calendar_documents.document.activities. CLI file: archivo de entrada o salida explícita. | JSON de respaldo es copia; no se fusiona al guardar automáticamente. |
| Series y vínculos multifecha | appDocument.series y activity.seriesId | El mismo documento canónico del canal. | No existe tabla cloud normalizada equivalente. |
| Clientes, sedes, ciudades y responsables | appDocument.catalog | Documento persistido del canal; una importación aceptada actualiza la copia del documento. | La Base Operativa es fuente externa de entrada, no un store runtime. Los registros manuales llevan source: manual. |
| Festivos y excepciones | appDocument.holidayOverrides más reglas de [src/domain/holidays.js](../src/domain/holidays.js) | Documento para excepciones; código/regla HOLIDAY_RULESET_VERSION para la tabla de festivos. | Una migración de reglas queda anotada en audit. |
| Ajustes operativos | appDocument.settings | Documento del canal, incluido currentDate, filtros y recordatorios. | Tema, movimiento y colapso del catálogo viven aparte en localStorage. |
| Auditoría | appDocument.audit | Documento; se conservan como máximo 500 entradas. | No hay un historial cloud separado ni una bitácora as-of. |
| Identidad/nombre/coordinador cloud | calendarMeta en el JSON y columnas calendars.name/coordinator | El documento es la fuente del contenido operativo; la tabla calendars es la fuente de selección/listado y se actualiza después de guardar. | Son dos representaciones que pueden quedar desalineadas si falla la segunda petición REST. |
| Propietario, membresías y roles | cloudPersistence.getCalendar() y estado Auth | Tablas profiles, calendars, calendar_members y auth.users, con RLS/migraciones. | El frontend etiqueta como solo lectura a quien no sea propietario. |
| Revisión operativa | document.calendarMeta.revision | Documento canónico. | Es distinta de calendar_documents.revision, que controla el conflicto cloud. |
| Revisión cloud y timestamps remotos | remoteRevision y respuesta REST | Fila public.calendar_documents (revision, updated_at, updated_by). | La CLI expone ambos contadores y advierte si difieren. |
| Sesión cloud del browser | Memoria de createSupabasePersistence() | Auth; copia local en localStorage bajo siys-sync-supabase-session. | No es parte del JSON ni del respaldo. |
| Preferencias visuales | uiPreferences | localStorage bajo siys-sync-ui-(canal). | No aumenta la revisión ni entra en respaldos. |
| Respaldo JSON | Archivo descargado | El archivo sólo se vuelve autoridad cuando el usuario confirma backup.restore, o fuente de backup.merge. | Se sanea, se valida tamaño y se muestra previsualización antes de mutar. |
| Base Operativa | Libro seleccionado por el operador | El libro original sigue fuera del sistema; el catálogo del documento es la copia aceptada. | Lectura solamente; no se importan cédulas, NIT, teléfonos, correos ni fotografías. |
| Versión de aplicación | Código fuente package.json y APP_VERSION | Deben coincidir; package-lock.json es espejo. | stable-version.txt apunta al tag estable; dist/ es generado y no autoridad de fuente. |

## 7. Seguridad y privacidad

### Fronteras aplicadas

- **Frontend estático**: sólo la URL y la clave publishable pueden llegar al
  HTML. El build y la auditoría buscan dependencias de red no autorizadas y
  credenciales administrativas. La configuración no habilita cloud en el canal
  local.
- **Browser local**: los datos quedan en el origen y perfil del navegador;
  limpiar datos, cambiar de perfil, usar otro navegador o copiar el HTML no
  mueve la programación. La protección de navigator.storage.persist() reduce
  liberaciones automáticas, pero no sustituye respaldos.
- **Auth**: las operaciones cloud requieren sesión. La CLI guarda su sesión en
  CALENDARY_SESSION_FILE o en el archivo de configuración local de Calendary
  con permisos restringidos; la contraseña no se acepta por argv.
- **RLS cloud**: las migraciones habilitan RLS. La migración de lectura
  compartida permite a cualquier usuario authenticated seleccionar perfiles,
  calendarios y documentos; las inserciones/actualizaciones del documento y de
  metadatos quedan para el propietario. Por tanto, la frontera de privacidad
  actual es “cuenta autenticada del proyecto”, no aislamiento de lectura por
  propietario.
- **Importación**: la guía de Base Operativa limita explícitamente los campos
  personales y el código vuelve a sanear documentos al guardar/exportar.
- **CLI**: la fuente cloud sólo ejecuta GET, no tiene fallback silencioso a un
  JSON local y no permite sobreescribir el archivo de entrada ni un destino ya
  existente.

### Riesgos que el sistema no elimina

- Un usuario autenticado del proyecto puede leer los documentos que la política
  RLS actual expone; el modo solo lectura de la UI no es una frontera de
  confidencialidad.
- Un respaldo JSON descargado contiene datos operativos y queda bajo control de
  la carpeta donde el usuario lo guarde.
- La escritura cloud del documento y la actualización de nombre/coordinador son
  dos peticiones REST separadas; no se ve una transacción que cubra ambas.

## 8. Responsabilidades de módulos

| Área | Responsabilidad actual | Frontera que debe respetar |
| --- | --- | --- |
| src/domain/ | Funciones puras de texto, fechas, festivos, enums, orden, filtros, CSV, mezcla de respaldos/importaciones y ranking de responsables. | No importa UI, persistencia ni CLI. |
| src/core.js | Fachada de dominio, documento por defecto, esquema 4, saneamiento/migración, validaciones y envoltura de respaldos. | No lee archivos, IndexedDB, red ni DOM. |
| src/calendar-contract.js | Operaciones de lectura/mutación, payload estricto, invariantes, clon atómico, revisión y auditoría. | Recibe sólo documento/request/options; no conoce adaptadores. |
| src/import/ y src/importer.js | Lectura tabular, conciliación de Base Operativa y programación Excel; la fachada conserva imports existentes. | Excel es entrada; no modifica el libro fuente. |
| src/persistence/indexed-document-store.js | IndexedDB, registros current/recovery, reserva y liberación del lock. | Sólo adapta el almacenamiento local; no contiene reglas de calendario. |
| src/persistence/json-preferences.js | Lectura, mezcla y limpieza de preferencias JSON. | No guarda el documento operativo. |
| src/cloud.js | Auth browser, selección de calendario, lectura/escritura REST, revisión optimista y errores cloud. | Sólo usa configuración pública; la autorización final la aplica RLS. |
| src/ui/ | Presentación del DOM, constantes, exportación visual, cálculo de filas de exportación, movimiento 3D y controlador de mutaciones. | No convertir presentación en fuente de verdad; el documento sigue en appDocument. |
| src/app.js | Coordinador: runtime, bootstrap, eventos, diálogos, render, importación, persistencia, lock y recuperación. | Es el único lugar que conoce el DOM, el origen y la selección de canal juntos. |
| src/cli/ y bin/calendary.js | Parseo de argumentos, Auth de Node, fuente file/cloud, contrato, salida y escritura atómica de JSON. | La fuente cloud es lectura; la fuente file no abre IndexedDB. |
| scripts/ | Build autocontenido, comprobación de versión y auditoría de artefactos/red/secretos. | dist/ debe ser salida reproducible, no fuente manual. |
| supabase/migrations/ | Tablas, triggers, funciones de bootstrap/provisión y políticas RLS. | Cambios remotos deben tener migración y verificación de despliegue. |

## 9. Fallos y recuperación

| Fallo o condición | Comportamiento actual | Recuperación prevista por el sistema |
| --- | --- | --- |
| current local inválido | Se intenta leer recovery; si tampoco es válido, el arranque cae al modo sin guardado y muestra error. | Revisar/recuperar un respaldo JSON; no se borra silenciosamente el archivo inválido. |
| IndexedDB no disponible o bloqueado | Se crea documento en memoria, storageAvailable queda falso y se advierte que no hay guardado. | Descargar respaldo mientras la pestaña siga abierta; corregir permisos/origen/navegador. |
| Escritura local fallida | Indicador de error, se marca el almacenamiento como no disponible y no se confirma el guardado. | Descargar copia y reabrir el origen; no asumir durabilidad por ver la UI. |
| Sesión cloud ausente | Se abre Auth; una falla de autenticación impide completar el bootstrap cloud. | Iniciar sesión o crear cuenta; el sistema no cambia silenciosamente al documento local. |
| Red/Auth cloud expirada | El adaptador intenta renovar sesión ante 401; si falla, devuelve error. | Reautenticar y volver a abrir el canal; revisar el indicador de persistencia. |
| Conflicto de revisión cloud | El PATCH condicionado devuelve cero filas; se lee el documento remoto más reciente y se pide revisar. | Comparar con un respaldo local y editar después de confirmar; no existe merge automático de cambios concurrentes. |
| Cronograma cloud ajeno | La UI y la CLI lo cargan en solo lectura; una escritura es rechazada por rol/RLS. | Seleccionar el cronograma propio o solicitar una membresía según la administración disponible. |
| Pestaña local editora cerrada | El heartbeat deja de actualizarse. | Otra pestaña puede adquirir el lock después de aproximadamente 15 segundos o usar Tomar control. |
| Restauración JSON | Se valida tamaño, formato, esquema y vista previa; backup.restore reemplaza el documento y guarda de inmediato. | En local queda recovery por la escritura normal; mantener el archivo original por fuera. |
| Reinicio solicitado | Primero se crea el respaldo; luego se limpian current/recovery locales o se escribe un documento vacío cloud y se notifica a otras pestañas. | El respaldo descargado es el único camino para recuperar el contenido reiniciado. |
| Cambio de calendario durante un guardado | Se hace flushSave() antes de cambiar; si falla, se intenta restaurar el calendario y el documento anterior. | Revisar el error antes de repetir la operación. |

## 10. Reglas para cambiar el sistema

Estas reglas describen las fronteras existentes; no proponen componentes nuevos.

1. **Antes de editar**, revisar git status, el canal afectado, la fuente de
   versión y si el cambio involucra src/, dist/, migraciones o sólo docs. No
   usar dist/ como fuente de comportamiento.
2. **Cambiar el documento** sólo mediante una migración compatible en
   sanitizeDocument(), una actualización explícita de SCHEMA_VERSION, pruebas
   del contrato, respaldos y CLI. Un documento de esquema superior debe seguir
   bloqueándose, no reinterpretarse silenciosamente.
3. **Cambiar operaciones** a través de executeCalendarOperation() cuando la
   operación sea compartida con la CLI. Conservar atomicidad, no-op,
   calendarMeta.revision, auditoría, validación de no laborables y códigos de
   error. Los callbacks mutate() deben permanecer limitados a flujos UI que no
   forman parte del contrato compartido.
4. **Cambiar persistencia local** preservando los nombres de base, el object
   store documents, las claves current, recovery y edit-lock, la transacción de
   recuperación y el heartbeat entre pestañas.
5. **Cambiar persistencia cloud** conservando la separación de keys estable/beta,
   Auth, RLS, la condición de revisión y la diferencia entre revisión de fila y
   revisión del documento. Toda modificación de tablas/policies/functions debe
   tener migración ordenada y comprobación remota autorizada.
6. **Cambiar importación o privacidad** manteniendo la vista previa, el límite
   de respaldo de 25 MB, el no-sobrescrito de archivos y las exclusiones de
   Base Operativa. No agregar datos personales sólo porque existan en un libro.
7. **Cambiar distribución** actualizando el manifiesto de módulos y sus pruebas
   junto con la fuente. Regenerar dist/ sólo después de que el build represente
   todos los imports; verificar que los dos HTML sean autocontenidos e idénticos.
8. **Cambiar versiones** manteniendo iguales package.json, los dos valores raíz
   de package-lock.json y APP_VERSION; tratar stable-version.txt como puntero
   de distribución y registrar la decisión en CHANGELOG.md.
9. **Verificar por capas**: tests del dominio/contrato, persistencia y cloud
   simulados, CLI, npm run version:check, build/auditoría y, cuando cambie la
   distribución o la UI, smoke HTTP aislado para local, stable y beta.
10. **No mezclar canales ni trabajo ajeno**: un cambio local de documentación no
    autoriza publicar, promover, regenerar artefactos, aplicar migraciones,
    hacer commit o hacer push.

## 11. Inconsistencias conocidas y pendientes de verificación

| Estado | Evidencia actual | Impacto y siguiente dueño |
| --- | --- | --- |
| **Hecho verificado** | S-03 añadió a [scripts/build.mjs](../scripts/build.mjs) `activity-presentation.js`, `export-layout.js`, `importer.js` y validación automática del manifiesto. | El manifiesto fuente representa esos imports, pero `dist/` aún no se regeneró y sus salidas todavía no contienen los símbolos nuevos. El maestro debe ejecutar el build antes del cierre. |
| **Hecho verificado** | El worktree inicial tenía cambios en README, dist/, docs, src/, estilos y tests, además de nuevos módulos y planes. | La evidencia de esta página es local y mezclada; no debe presentarse como una release limpia. El maestro debe clasificar antes de integrar. |
| **Hecho verificado** | package.json, package-lock.json, src/core.js y el APP_VERSION embebido en dist/ declaran 0.16.0-beta.2; stable-version.txt contiene v0.15.0. | La separación main-beta/stable-puntero es coherente con el workflow, pero sólo se comprobó el repositorio local, no el despliegue vivo. |
| **Hecho verificado** | [docs/DISTRIBUCION.md](DISTRIBUCION.md), [docs/OPERACION_RESPALDOS_JSON.md](OPERACION_RESPALDOS_JSON.md) y [docs/VERSIONAMIENTO.md](VERSIONAMIENTO.md) fueron sincronizados: las versiones antiguas quedaron marcadas como historia y el estado actual remite a las fuentes autoritativas. | Sigue pendiente validar el contenido remoto de GitHub Pages y Supabase; la documentación local ya no presenta esos ejemplos históricos como estado actual. |
| **Hecho verificado** | [docs/ARQUITECTURA.md](ARQUITECTURA.md) ahora registra el corte local: `app.js` 4.784 líneas, `core.js` 1.315, `importer.js` 11 y 149 pruebas antes de la segunda ola. | Las métricas son descriptivas del corte, no límites de diseño; el total actual de regresión es 157 tras añadir guardas y persistencia. |
| **Hecho verificado** | calendar_documents.document y calendarMeta duplican el nombre/coordinador de calendars; cloud.js actualiza primero el documento y después la tabla de calendario mediante otra petición. | Puede existir una divergencia parcial si la segunda petición falla. No hay transacción REST visible que la evite. |
| **Hecho verificado** | La lista cloud se refresca cada 30 s, al foco, al volver a la pestaña y manualmente; no existe Realtime ni lectura periódica del documento abierto. | La interfaz no ofrece sincronización inmediata de cambios externos; sólo el conflicto de revisión fuerza una recarga del documento. |
| **Hecho verificado** | README identifica el proyecto remoto como calendario-hvac-siys-dev, mientras supabase/config.toml usa project_id = calendario-hvac-siys. | Puede ser nombre local frente a referencia remota, pero debe verificarse antes de aplicar migraciones para evitar enlazar el proyecto equivocado. |
| **Pendiente** | En esta tarea no se ejecutó migration list --linked, db push --linked --dry-run, un smoke autenticado ni una consulta al Supabase remoto. | Falta probar que el esquema/policies desplegados coincidan con supabase/migrations/. |
| **Hecho verificado / pendiente** | `npm test` pasa con 157 pruebas, `npm run architecture:check` pasa y `git diff --check` no reporta errores. | Todavía falta ejecutar `npm run verify` con regeneración de `dist/`; no se ha certificado el despliegue remoto ni se ha publicado nada. |

## 12. Evidencia y documentos relacionados

La implementación principal está en [src/app.js](../src/app.js), [src/core.js](../src/core.js),
[src/calendar-contract.js](../src/calendar-contract.js), [src/cloud.js](../src/cloud.js),
la carpeta [src/persistence](../src/persistence), la carpeta [src/cli](../src/cli)
y las migraciones de [supabase/migrations](../supabase/migrations). Para ampliar un
tema sin duplicar reglas:

- operación de respaldo: [docs/OPERACION_RESPALDOS_JSON.md](OPERACION_RESPALDOS_JSON.md);
- contrato de operaciones: [docs/CONTRATO_CALENDARIO.md](CONTRATO_CALENDARIO.md);
- CLI: [docs/CLI.md](CLI.md);
- Base Operativa: [docs/BASE_OPERATIVA.md](BASE_OPERATIVA.md);
- distribución: [docs/DISTRIBUCION.md](DISTRIBUCION.md);
- versionamiento: [docs/VERSIONAMIENTO.md](VERSIONAMIENTO.md);
- plan que origina S-01: [docs/PLAN_REFORZAMIENTO_SISTEMA.md](PLAN_REFORZAMIENTO_SISTEMA.md).

Cuando una de esas páginas contradiga al código actual, debe marcarse como
inconsistencia y verificarse antes de usarla como procedimiento operativo.
