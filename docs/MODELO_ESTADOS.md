# Modelo de datos y estados — esquema 4

Estado: documento de S-02, construido sobre el código local actual.

Este documento describe el documento canónico que produce sanitizeDocument cuando
SCHEMA_VERSION es 4 y las mutaciones que atraviesan
executeCalendarOperation. La fuente de verdad para los nombres de campos y las
reglas es el código, no esta documentación: src/core.js,
src/calendar-contract.js y src/domain/calendar-enums.js. Las pruebas
relacionadas son tests/core.test.mjs, tests/contract.test.mjs,
tests/quarantine.test.mjs y tests/importer.test.mjs. La frontera operacional
y el transporte por JSON están descritos en docs/CONTRATO_CALENDARIO.md y
docs/OPERACION_RESPALDOS_JSON.md.

Las afirmaciones marcadas como **comprobado** se observan en esas fuentes o en
las pruebas. Las de **pendiente** no son reglas que el documento deba inventar:
son límites, decisiones no representadas o validaciones que el código actual no
resuelve.

## 1. Frontera del documento canónico

El documento canónico es el objeto document saneado. Una envoltura de respaldo
JSON (format, formatVersion, exportedAt, appVersion, origin, channel,
revision, document) es un artefacto externo y no forma parte del documento
interno. Una vista resuelta de activity.list o activity.get tampoco es otra
entidad persistida: agrega nombres y etiquetas a partir del catálogo.

La forma raíz comprobada es:

~~~text
document
├── schemaVersion
├── appVersion
├── calendarMeta
├── catalog
│   ├── cities
│   ├── clients
│   ├── sites
│   └── responsibles
├── activities
├── series
├── settings
├── holidayOverrides
├── importMetadata
└── audit
~~~

sanitizeDocument aplica listas blancas, normaliza varias colecciones y elimina
campos no autorizados. Por ejemplo, phone, color, datos de contacto,
candidateSiteSourceKeys y otros campos arbitrarios que aparezcan en una fuente
no son parte del esquema canónico saneado. La ausencia de una propiedad opcional
en un registro heredado se conserva como ausencia; no se debe completar con un
campo nuevo sólo porque parezca útil.

## 2. Esquema 4 por entidad

### 2.1 Metadatos del calendario

calendarMeta contiene únicamente:

| Campo | Uso comprobado |
| --- | --- |
| id | Identificador del calendario; el documento nuevo usa calendario_principal. |
| name | Nombre visible del cronograma. |
| coordinator | Texto del coordinador. |
| revision | Contador entero no negativo del documento; las mutaciones reales del contrato lo incrementan una vez. |
| createdAt | Marca de creación conservada como texto. |
| updatedAt | Marca de última actualización del calendario; el contrato la actualiza en una mutación real salvo restauración con política preserve. |

El valor inicial de revision es 0. El valor de appVersion inicial lo aporta
APP_VERSION; en el código leído es 0.17.0-beta.1. El valor de
settings.holidayRuleSetVersion se fuerza al HOLIDAY_RULESET_VERSION vigente
del código, que actualmente es CO-NATIONAL-2026-06-02.

### 2.2 Catálogo

catalog es un objeto con cuatro colecciones. Las siguientes son las listas de
campos que sanitizeDocument conserva; updatedAt se completa con la fecha
heredada de calendarMeta.updatedAt si el registro no la trae.

| Colección | Campos canónicos conservados |
| --- | --- |
| cities | id, sourceKey, name, zone, active, source, updatedAt |
| clients | id, sourceKey, name, active, source, updatedAt, aliases |
| sites | id, sourceKey, clientId, name, city, zone, shoppingCenter, address, entryConditions, requiresApp, active, source, updatedAt, aliases, coverageHints |
| responsibles | id, sourceKey, name, initials, company, responsibleType, baseCity, group, heights, courses, active, source, favorite, updatedAt, coverage, aliases |

Los arrays aliases y coverage se limpian a textos únicos. Cada entrada de
sites.coverageHints sólo puede conservar source, sourceKey,
subsidiaryId, subsidiaryName, equipmentCount, responsibleGroups,
frequencies y scheduledMonths. Una pista de cobertura no es una entidad de
equipo ni una relación persistida con una actividad.

El contrato permite catalog.list para client, site y responsible, y
catalog.upsert para esos tres tipos. cities existe en el esquema y en la
importación de Base Operativa, pero no tiene una operación catalog.upsert en
el contrato actual.

### 2.3 Actividades

Cada elemento de activities conserva los siguientes campos:

| Campo | Significado y forma comprobada |
| --- | --- |
| id | Identificador único exigido por sanitizeDocument dentro de activities. |
| seriesId | Identificador de una fila de series o null cuando la tarjeta es independiente. En cuarentena siempre es null. |
| date | YYYY-MM-DD para una tarjeta de calendar; null para una tarjeta de quarantine. |
| planningBucket | calendar o quarantine. Etiquetas: Calendario y Pendiente. |
| clientId | Referencia opcional a catalog.clients[].id. |
| siteId | Referencia opcional a catalog.sites[].id. |
| city | Texto de ciudad guardado en la actividad; no es un cityId. |
| responsibleIds | Array de referencias a catalog.responsibles[].id. |
| serviceType | preventive, corrective, emergency, diagnostic, warranty o administrative. |
| status | Uno de los estados de actividad enumerados en §4. |
| sortOrder | Número o null; el reordenamiento del contrato usa el número para ordenar tarjetas dentro de un mismo día. |
| observations | Texto de observaciones, saneado hasta 5000 caracteres. |
| createdAt | Marca de creación de la tarjeta. |
| updatedAt | Marca de última modificación de la tarjeta. |
| completedAt | Marca de terminación o null; el código la establece al entrar en completed y la limpia al salir de ese estado. |
| history | Historial de la tarjeta, descrito abajo. |

Una entrada de history conserva at, action y detail, y puede conservar
scope y mode. El saneador retiene sólo las últimas 200 entradas por
actividad. Acciones que el código actual escribe incluyen created,
scheduled_from_quarantine, moved_to_quarantine, status_changed,
rescheduled, reordered, duplicated, series_created, extended,
bulk_edited, edited, planning_bucket_changed y text_normalized.
La lista es evidencia de acciones implementadas, no un enum adicional del
esquema.

Para servicios distintos de administrative, la validación de actividad exige
clientId, siteId y city. Una actividad confirmed exige al menos un
responsibleId. Las operaciones del contrato validan además que las
referencias existan y que la sede pertenezca al cliente indicado cuando editan
o crean esos datos.

### 2.4 Series

Cada elemento de series sólo conserva:

| Campo | Uso comprobado |
| --- | --- |
| id | Identificador compartido por varias actividades. |
| createdAt | Marca de creación de la serie. |
| updatedAt | Marca actualizada por las operaciones de ampliación que modifican la serie. |
| originalStart | Inicio registrado al crear o ampliar una serie. |
| originalEnd | Fin registrado al crear o ampliar una serie. |

La serie es un agrupador; no contiene estados ni una lista de actividades. La
relación es activities[].seriesId -> series[].id. Cada tarjeta conserva su
propio id, fecha, estado, observaciones, historial y marcas de tiempo.

### 2.5 Configuración y filtros

settings conserva:

~~~text
settings
├── currentDate
├── backupReminderDays
├── lastBackupAt
├── backupReminderDismissed
├── holidayRuleSetVersion
└── filters
    ├── query
    ├── cities
    ├── clients
    ├── sites
    ├── responsibles
    ├── serviceTypes
    ├── statuses
    ├── planningBuckets
    ├── dateFrom
    └── dateTo
~~~

Los siete filtros de selección son arrays de textos; query es texto y
dateFrom/dateTo son fechas o null cuando pasan por el saneador. Se
convierten filtros heredados escalares (status, serviceType, responsible,
planningBucket) a sus arrays actuales. Esta configuración es preferencia de
vista y filtro; no es una copia de los estados de las actividades.

### 2.6 Excepciones de festivos

Cada entrada de holidayOverrides puede conservar id, date, name,
reason, type, active, createdAt, updatedAt y action.

El tipo efectivo es manual-closure o allow-scheduling. El contrato nuevo
escribe type; el saneador y el cálculo de festivos aceptan la forma heredada
action: "remove" como equivalente a allow-scheduling cuando falta type.
Una excepción activa (active !== false) por fecha es única y los IDs de
excepción también son únicos. Las excepciones se aplican al mapa de festivos
calculado para decidir si una fecha es laborable; no cambian el valor guardado
de activity.date por sí solas.

### 2.7 Metadatos de importación

importMetadata es null por defecto o un objeto saneado con estos campos:

~~~text
fileName
fileSize
lastModified
sha256
importedAt
sheetCounts
├── dm_ciudad
├── dm_clientes
├── dm_sede
├── dm_directorio_siys
└── dm_equipo_cronograma
    └── sourceRows, imported, skipped, hints
warnings
└── code, message, sheet, row
~~~

Sólo se aceptan esas cinco hojas y los contadores sourceRows, imported,
skipped y hints. Las advertencias se limitan a code, message, sheet y
row. sha256 debe ser hexadecimal de 64 caracteres; el saneador lo guarda
en mayúsculas. Rutas, correos, cédulas, teléfonos, fotografías y campos
arbitrarios de la fuente no pertenecen a este objeto.

La importación de Base Operativa actualiza catálogo, importMetadata y una
entrada global de auditoría; no crea actividades. La importación de
Programacion sí crea actividades y series mediante las mismas funciones de
creación/rango/cuarentena.

### 2.8 Auditoría global

audit es un array de entradas con at, action y detail. El contrato lo
limita a las últimas 500 entradas y sólo agrega una entrada cuando una
operación mutadora produce un cambio real. Las lecturas y los no-op no agregan
auditoría ni revisión.

Acciones globales comprobadas para las transiciones de este documento son
activity_created, activities_moved, activities_duplicated,
activity_extended, activity_extended_range, activity_duplicated_range,
activity_quarantined, quarantine_assigned, activity_edited,
status_changed y activities_deleted. También existen acciones para
reordenamiento, edición múltiple, importaciones, excepciones y respaldos,
entre ellas backup_restored y backup_merged.

La auditoría global no es el historial detallado de cada tarjeta: el primero
resume la operación y el segundo vive dentro de activity.history. Ninguno de
los dos campos contiene un actor, una aprobación formal o un hash de cadena.

## 3. Relaciones e invariantes

### Relaciones

| Origen | Destino | Regla comprobada |
| --- | --- | --- |
| catalog.sites[].clientId | catalog.clients[].id | Una sede puede asociarse a un cliente; catalog.upsert exige que el cliente exista. |
| activities[].clientId | catalog.clients[].id | Si está presente, las operaciones de creación/edición deben resolverlo en el catálogo. |
| activities[].siteId | catalog.sites[].id | Si está presente, debe existir; si ambos IDs están presentes, la sede debe pertenecer al cliente. |
| activities[].responsibleIds[] | catalog.responsibles[].id | Las operaciones de creación/edición validan cada responsable; confirmar exige que el array no esté vacío. |
| activities[].seriesId | series[].id | Une tarjetas de una misma programación ampliada. null significa independiente; no se almacena una lista inversa en la serie. |
| activities[].city | ninguna entidad por ID | Es texto desnormalizado. La vista puede usar site.city como fallback, pero no existe cityId en la actividad. |
| holidayOverrides | mapa de festivos calculado | La relación es temporal/derivada para validar y generar fechas; no es una FK hacia actividades. |
| importMetadata | archivo de entrada | Describe la última importación saneada; no referencia una fila de catálogo por ID. |

### Invariantes aplicadas por el código

1. planningBucket: "quarantine" implica exactamente la combinación operativa
   date: null, status: "to_schedule" y seriesId: null.
2. planningBucket: "calendar" exige una fecha válida y no admite
   status: "to_schedule".
3. Los estados, tipos de servicio y bandejas deben pertenecer a sus catálogos
   de enums. Las etiquetas actuales son:

   ~~~text
   preventive      Mantenimiento preventivo
   corrective       Mantenimiento correctivo
   emergency        Llamada de emergencia
   diagnostic       Diagnóstico
   warranty         Garantía
   administrative   Administrativo

   scheduled        Programada
   confirmed        Confirmada
   in_progress      En ejecución
   completed        Terminada
   not_executed     No ejecutada
   cancelled        Cancelada
   to_schedule      Por programar
   ~~~

4. completedAt se conserva al establecer completed si ya existe, se crea con
   la marca de la operación si no existe y se vuelve null al salir de ese
   estado.
5. Una operación que mueve, edita, amplía o asigna una fecha no laborable exige
   allowNonWorking: true. Las generaciones por rango excluyen domingos y
   festivos por defecto y permiten includeNonWorking o
   forceIncludeDates.
6. El contrato rechaza IDs de actividad duplicados en una selección y exige que
   todos existan antes de mutar.
7. El saneador exige IDs únicos para actividades y valida cada actividad con
   validateActivity; valida además IDs y fechas de excepciones y la unicidad
   de las excepciones activas por fecha.
8. La colisión de dos tarjetas de una misma serie en la misma fecha es un
   conflicto para mover, editar la fecha o ampliar una tarjeta. La ampliación
   por rango, en cambio, omite fechas ya existentes de esa serie y las devuelve
   como advertencia SERIES_DATE_EXISTS.

Estas reglas no significan que exista una unicidad global por cliente, sede,
responsable o día: el código no impone esa regla.

## 4. Máquina de estados textual

### 4.1 Estado combinado de bandeja, fecha y serie

El estado estructural mínimo de una tarjeta es:

~~~text
PENDIENTE
  planningBucket = quarantine
  date           = null
  status         = to_schedule
  seriesId       = null

CALENDARIO INDEPENDIENTE
  planningBucket = calendar
  date           = YYYY-MM-DD
  status         = scheduled | confirmed | in_progress | completed |
                   not_executed | cancelled
  seriesId       = null

CALENDARIO EN SERIE
  planningBucket = calendar
  date           = YYYY-MM-DD
  status         = scheduled | confirmed | in_progress | completed |
                   not_executed | cancelled
  seriesId       = id de una serie
~~~

Las transiciones estructurales son:

~~~text
PENDIENTE --activity.assign-date--> CALENDARIO INDEPENDIENTE
PENDIENTE --activity.edit con planningBucket=calendar y date--> CALENDARIO INDEPENDIENTE
CALENDARIO INDEPENDIENTE --activity.quarantine--> PENDIENTE
CALENDARIO EN SERIE --activity.quarantine, scope=single--> PENDIENTE
CALENDARIO EN SERIE --activity.quarantine, scope=series--> PENDIENTE
CALENDARIO INDEPENDIENTE --activity.extend / extend-range--> CALENDARIO EN SERIE
CALENDARIO EN SERIE --activity.extend / extend-range--> CALENDARIO EN SERIE
CALENDARIO (cualquier serie) --activity.duplicate--> nuevas tarjetas INDEPENDIENTES
~~~

activity.move y activity.edit con cambio de fecha conservan el
seriesId; no convierten una tarjeta independiente en serie ni viceversa.
activity.assign-date siempre deja la tarjeta independiente. duplicate deja
la fuente intacta y sus copias sin serie. Las transiciones no crean un estado
deleted: activity.delete elimina registros del array.

### 4.2 Estado de status

Para una actividad de calendario, los seis estados operativos son válidos. El
contrato actual no impone un grafo de negocio como scheduled → confirmed →
in_progress: activity.status puede escribir cualquier valor permitido si
las invariantes de la bandeja y de responsables se cumplen. En consecuencia,
el siguiente diagrama representa destinos permitidos, no una recomendación de
flujo:

~~~text
scheduled ───────┐
confirmed ───────┤
in_progress ─────┤── activity.status / activity.edit / bulk-edit(status)
completed ───────┤       └── cualquier estado de calendario permitido
not_executed ────┤
cancelled ───────┘

quarantine + to_schedule ──(sólo permanece to_schedule)
~~~

Una actividad Pendiente no puede entrar en in_progress, completed,
not_executed, cancelled, scheduled ni confirmed mientras siga en esa
bandeja. Una actividad de Calendario no puede recibir to_schedule. Confirmar
requiere responsables. Cambiar a completed actualiza completedAt; los
demás cambios de estado limpian ese campo.

### 4.3 Ciclo de vida de una serie

~~~text
sin serie
  ├─ activity.create con endDate distinto de date
  │    └─ crea tarjetas con un seriesId común y una fila de series
  ├─ activity.extend
  │    └─ crea la serie si hacía falta y agrega una tarjeta
  └─ activity.extend-range, mode=extend
       └─ crea/reutiliza la serie y agrega fechas no existentes

serie existente
  ├─ move / edit de fecha / status / edición común
  │    └─ conserva la relación por seriesId
  ├─ extend / extend-range(extend)
  │    └─ agrega tarjetas a la misma serie
  ├─ extend-range(duplicate) o duplicate
  │    └─ crea copias nuevas con seriesId=null
  ├─ quarantine(single)
  │    └─ separa una tarjeta; conserva la serie sólo si quedan al menos dos
  └─ quarantine(series)
       └─ conserva una tarjeta Pendiente y retira las demás; elimina la serie

Pendiente
  └─ assign-date / edit con fecha y Calendario
       └─ vuelve sin serie y con status scheduled por defecto
~~~

En extend-range(extend), originalStart y originalEnd se recalculan con
las fechas de las tarjetas de la serie. En las demás operaciones de movimiento
o edición de fecha no hay una actualización general de esos dos campos.

## 5. Transiciones del contrato

### Regla común de revisión, atomicidad y auditoría

executeCalendarOperation sanea y clona el documento antes de entregar el
draft al handler. Si falla una validación, el objeto de entrada no cambia. Si
el resultado saneado difiere del origen:

1. se actualizan schemaVersion, appVersion,
   calendarMeta.updatedAt y settings.holidayRuleSetVersion;
2. se incrementa calendarMeta.revision exactamente una vez;
3. se agrega la entrada global audit correspondiente y se conserva como
   máximo el tramo final de 500 entradas.

Una operación idéntica devuelve changed: false, no incrementa revision y no
agrega auditoría. La respuesta también entrega result, warnings y, cuando
aplica, auditEntry. Los payloads son estrictos: los campos desconocidos son un
error INVALID_REQUEST.

La columna “revisión” de las transiciones siguientes significa esta regla
común. backup.restore es la excepción explícita y se describe en §6.

La migración es transversal a todas las transiciones: cada operación recibe un
documento que primero pasa por sanitizeDocument y cada resultado mutado vuelve a
salir con schemaVersion 4. Por eso crear, mover, duplicar, ampliar, poner en
Pendiente, asignar fecha, editar, cambiar estado y eliminar no tienen una
variante que escriba el formato heredado. Si el saneamiento no puede producir
una actividad válida, la transición no empieza y el documento de entrada queda
intacto. Las conversiones concretas de bandeja, filtros y regla de festivos
están en §6.

### 5.1 Crear

- **Operación:** activity.create.
- **Entrada y resultado:** acepta una fecha o un rango (date, endDate) para
  Calendario, o planningBucket: "quarantine" sin fecha para Pendiente. Puede
  resolver referencias por IDs o crear registros manuales a partir de
  clientName, siteName y responsibleNames. Devuelve IDs creados, seriesId,
  catálogo creado y fechas omitidas.
- **Invariantes:** Pendiente fuerza date: null, status: "to_schedule" y
  seriesId: null. En Calendario el rango genera una tarjeta por fecha incluida;
  includeNonWorking y forceIncludeDates controlan fechas no laborables. Un
  rango que no produce fechas es VALIDATION_FAILED.
- **Conflictos/revisión:** se validan enums, referencias, sede-cliente,
  requisitos operativos y responsables para confirmar. Crear no impone una
  unicidad global de tarjeta por día. Una fecha no laborable puede omitirse o
  incluirse explícitamente según la política del payload; no se usa un estado
  adicional de revisión.
- **Auditoría y respaldo:** auditoría activity_created, historial created;
  una creación real incrementa la revisión. Debe probarse sobre una copia JSON
  y producir un destino distinto del respaldo original según el runbook.

### 5.2 Mover

- **Operación:** activity.move.
- **Entrada y resultado:** recibe activityIds, targetDate, anchorId opcional
  y mode (preserve por defecto o same). preserve desplaza el conjunto
  manteniendo el delta respecto al ancla; same reúne todas las tarjetas en la
  fecha destino.
- **Invariantes:** no acepta tarjetas Pendiente; todas las fechas resultantes
  deben ser fechas válidas y el orden manual de las tarjetas movidas se reinicia
  (sortOrder: null). seriesId no cambia.
- **Conflictos/revisión:** domingos o festivos requieren
  allowNonWorking: true. Una fecha ocupada por otra tarjeta de la misma serie
  produce CONFLICT y la operación es atómica. Mover al mismo día en modo
  preserve es no-op.
- **Auditoría y respaldo:** cada tarjeta movida registra rescheduled en su
  historial y la operación usa activities_moved en auditoría global. Una
  mutación real incrementa la revisión; los warnings de fechas no laborables se
  deben revisar antes de restaurar el JSON modificado.

### 5.3 Duplicar

- **Operación:** activity.duplicate.
- **Entrada y resultado:** copia una o varias tarjetas con un nuevo ID por
  tarjeta, usando el ancla para conservar distancias relativas.
- **Invariantes:** la copia queda en Calendario, con status: "scheduled",
  completedAt: null, sortOrder: null y seriesId: null; la fuente no cambia.
  Se valida el resto de validateActivity y se conservan las referencias de la
  fuente; esta operación no resuelve nombres nuevos de catálogo.
- **Conflictos/revisión:** la operación valida las fechas resultantes, solicita
  confirmación para no laborables y hace la comprobación de conflictos de fecha
  de la misma serie antes de insertar. No convierte las copias en miembros de
  la serie de la fuente.
- **Auditoría y respaldo:** historial duplicated, auditoría
  activities_duplicated, IDs nuevos en el resultado y una revisión nueva si
  changed es verdadero. Las copias deben verificarse en el respaldo destino.

### 5.4 Ampliar una fecha

- **Operación:** activity.extend.
- **Entrada y resultado:** recibe una actividad y targetDate. Si la fuente no
  tiene serie, crea una fila de series, asigna un seriesId a la fuente y
  agrega una tarjeta nueva; si ya tiene serie, agrega la tarjeta a esa misma
  serie.
- **Invariantes:** la nueva tarjeta conserva los datos de la fuente pero nace
  scheduled, sin completedAt y con ID propio. La actividad fuente conserva
  su estado e historial, salvo la entrada series_created cuando se
  crea la serie. Pendiente no puede ampliarse válidamente desde esta acción.
- **Conflictos/revisión:** una fecha ya ocupada por la misma serie produce
  CONFLICT; una fecha no laborable requiere allowNonWorking: true. La fecha
  destino igual a la fuente es no-op. La serie actualizada recibe updatedAt
  nuevo cuando se agrega a una serie existente.
- **Auditoría y respaldo:** historial extended en la tarjeta nueva y, si se
  crea la serie, series_created en la fuente; auditoría global
  activity_extended. La revisión del documento aumenta una vez y el respaldo
  debe conservar fuente, copia y fila de serie como un conjunto.

### 5.5 Ampliar o duplicar un rango

- **Operación:** activity.extend-range con fromDate, toDate, mode de
  extend o duplicate, includeNonWorking y forceIncludeDates.
- **Modo extend:** sólo agrega a la serie fechas incluidas que aún no existan.
  Una fuente independiente se convierte en serie cuando se agrega al menos una
  fecha nueva. Actualiza originalStart y originalEnd a los extremos de las
  tarjetas de la serie.
- **Modo duplicate:** crea una tarjeta independiente por cada fecha incluida,
  con seriesId: null, estado scheduled y completedAt: null; no modifica la
  serie de la fuente.
- **Invariantes/conflictos:** toDate no puede ser anterior a fromDate y una
  fuente Pendiente no puede iniciar esta operación. En extend, las fechas
  repetidas de la misma serie se omiten con SERIES_DATE_EXISTS; en ambos modos
  se informan fechas no laborables omitidas. Si duplicate no genera fechas es
  un error de validación; si extend no tiene ninguna fecha nueva, el resultado
  es sin cambios.
- **Auditoría y respaldo:** historial extended o duplicated, auditoría
  activity_extended_range o activity_duplicated_range, warnings y IDs
  creados en el resultado. La revisión aumenta una vez por operación real; el
  JSON modificado debe conservar también las fechas omitidas y los warnings de
  la salida de la CLI.

### 5.6 Enviar a cuarentena / Pendiente

- **Operación:** activity.quarantine, con scope: "single" o "series".
- **Entrada y resultado:** una tarjeta de Calendario pasa a la combinación
  Pendiente. Con single, sólo la fecha seleccionada se independiza; con
  series, la tarjeta representante queda y las demás fechas de esa serie se
  retiran del array de actividades.
- **Invariantes:** sólo se permiten fuentes scheduled o confirmed. La
  tarjeta representante queda sin fecha, con planningBucket: "quarantine",
  status: "to_schedule", seriesId: null, sortOrder: null y
  completedAt: null. Con single, si la serie restante tiene menos de dos
  miembros, sus IDs de serie se limpian y la fila de serie se elimina.
- **Conflictos/revisión:** no es un cambio de estado final ni una cancelación;
  una tarjeta en ejecución, terminada, no ejecutada o cancelada se rechaza.
  Volver a enviar una tarjeta ya Pendiente no cambia el documento.
- **Auditoría y respaldo:** historial moved_to_quarantine con el scope,
  auditoría activity_quarantined y revisión nueva sólo si hubo cambio. El
  respaldo debe conservar date: null y la combinación de estado; el CSV de
  Pendiente es una vista separada y el CSV mensual excluye esas tarjetas.

activity.edit admite patch.planningBucket como atajo sólo para una tarjeta
sin serie al enviarla a Pendiente; una actividad de varios días debe usar la
acción específica de cuarentena.

### 5.7 Asignar fecha

- **Operación:** activity.assign-date.
- **Entrada y resultado:** sólo recibe una actividad Pendiente y targetDate.
  Vuelve a Calendario con status: "scheduled", sin serie, sin orden manual y
  sin completedAt.
- **Invariantes/conflictos:** la fuente debe ser Pendiente y la fecha debe ser
  YYYY-MM-DD. Domingo o festivo exige allowNonWorking: true. La tarjeta no
  se combina automáticamente con una serie existente.
- **Auditoría y respaldo:** historial scheduled_from_quarantine, auditoría
  quarantine_assigned, warning de fecha si se confirmó una no laborable y una
  revisión nueva si cambió. El respaldo debe poder mostrar la misma tarjeta con
  fecha válida, Calendario y to_schedule ya sustituido por scheduled.

### 5.8 Editar

- **Operación:** activity.edit, con patch, commonScope (single o
  series) y statusScope (single, future o series).
- **Campos editables:** date, planningBucket, clientId, siteId, city,
  responsibleIds, serviceType, status y observations. La fecha y la
  bandeja afectan a la tarjeta indicada; los campos comunes pueden extenderse a
  la serie; el alcance de estado se controla por separado.
- **Invariantes:** se valida cada tarjeta resultante. El cambio a Pendiente
  exige fecha nula, Por programar, sin serie y sin completedAt; no se permite
  usarlo sobre una actividad con serie. El cambio desde Pendiente a Calendario
  necesita una fecha válida y deja scheduled por defecto si no se envía otro
  estado permitido.
- **Conflictos/revisión:** un cambio de fecha dentro de una serie que choque con
  otra tarjeta produce CONFLICT; una fecha no laborable requiere
  allowNonWorking. Las referencias se validan al editar campos comunes. La
  operación es atómica aunque afecte varias tarjetas.
- **Auditoría y respaldo:** las tarjetas pueden registrar edited,
  planning_bucket_changed, rescheduled y status_changed; la auditoría
  global es activity_edited. El contrato incrementa una revisión por la
  operación, no por cada tarjeta. activity.bulk-edit es otra operación para
  serviceType, status, responsibleIds, city u observations; valida
  todas las tarjetas y revierte el draft si una queda inválida.

### 5.9 Cambiar estado

- **Operación:** activity.status, con status y alcance opcional. El alcance
  future incluye la fecha seleccionada y las posteriores de la misma serie;
  series incluye toda la serie; en una actividad independiente el alcance
  efectivo es la tarjeta.
- **Invariantes:** el destino debe estar en ACTIVITY_STATUSES. Una tarjeta
  Pendiente sólo puede recibir to_schedule; una tarjeta Calendario no puede
  recibirlo. confirmed exige responsables. El cambio no altera fecha, bandeja
  ni seriesId.
- **Conflictos/revisión:** no hay conflicto por secuencia de estados porque el
  contrato no implementa un grafo de transición. Un estado ya aplicado a todas
  las tarjetas seleccionadas devuelve no-op sin historial, auditoría ni revisión.
- **Auditoría y respaldo:** cada tarjeta cambiada registra status_changed con
  el alcance; la entrada global es status_changed. completedAt se ajusta
  conforme a la regla común. La salida de la operación y el respaldo deben
  indicar los IDs afectados, especialmente con future o series.

### 5.10 Eliminar

- **Operación:** activity.delete, con una lista de activityIds existentes.
- **Resultado:** elimina físicamente esas entradas de activities; no es un
  estado cancelled ni un borrado lógico. Las demás entidades y actividades no
  se modifican.
- **Invariantes/conflictos:** exige IDs no vacíos, únicos y existentes. No hay
  confirmación de negocio adicional dentro del contrato; la operación está
  marcada como destructiva.
- **Revisión y auditoría:** una eliminación real aumenta calendarMeta.revision
  una vez, conserva sólo el resumen global activities_deleted y no puede
  escribir historial en una actividad que ya no existe.
- **Respaldo:** debe ejecutarse sobre una copia y conservar el respaldo origen
  inmutable. backup.restore es la vía para recuperar el documento completo;
  no hay una operación de deshacer de actividad en el contrato.

## 6. Operaciones de soporte, migración y respaldo

### Catálogo y festivos

catalog.upsert crea o actualiza un cliente, sede o responsable, conserva
source/sourceKey y actualiza updatedAt. Si el cambio es real usa la misma
revisión y auditoría de contrato. holiday.add valida fecha, tipo, nombre y
motivo, rechaza otra excepción activa para la misma fecha y audita
holiday_override_added; holiday.delete elimina por ID y audita
holiday_override_deleted. Estas operaciones cambian las futuras decisiones
de no laborabilidad, pero no reprograman automáticamente las actividades ya
guardadas.

### Migración al esquema 4

La migración comprobada es implícita en sanitizeDocument, no una cadena de
migraciones separada:

1. Un documento sin schemaVersion se trata como versión heredada 1; uno con
   versión mayor que 4 se rechaza.
2. El resultado siempre declara schemaVersion: 4 y completa la base creada por
   createDefaultDocument.
3. Para fuentes anteriores a 4, las actividades se interpretan en calendar.
   Para fuentes 4 sin planningBucket, se infiere quarantine si el estado es
   to_schedule o la fecha es null; de lo contrario se infiere calendar.
4. Se agregan/normalizan planningBucket, date, seriesId, sortOrder,
   responsibleIds, observations e history según la forma saneada, y se
   validan las invariantes de actividad.
5. Los filtros escalares heredados se convierten en arrays. Un cambio de
   holidayRuleSetVersion añade la auditoría holiday_rules_migrated y aplica
   la regla vigente.
6. Catálogo, series, excepciones, importación y auditoría pasan por sus listas
   blancas; los campos desconocidos no se migran.

La migración no inventa responsables, clientes, sedes, fechas ni series. Un
respaldo heredado que no cumple la combinación de bandeja, fecha y estado se
rechaza. El saneador valida la forma de cada actividad, pero no ejecuta una
reparación silenciosa de referencias de catálogo.

### Respaldo JSON y revisión previa

El flujo de docs/OPERACION_RESPALDOS_JSON.md es parte del modelo operativo:

1. descargar un respaldo nuevo, conservarlo como origen inmutable y registrar
   canal, versión, appVersion, schemaVersion, revisión y hash SHA-256;
2. inspeccionar sin mutar;
3. modificar mediante una operación del contrato sobre un archivo destino
   diferente;
4. revisar changed, revision, IDs, warnings, conflictos y conteos;
5. restaurar sólo en el mismo canal/perfil y verificar visualmente y con un
   respaldo final.

backup.restore sanea el documento recibido y reemplaza el documento completo.
Conserva la revisión que trae el respaldo mediante revisionPolicy: "preserve"
y agrega backup_restored cuando la restauración produjo un cambio. El código
actual no compara automáticamente la revisión origen con la revisión actual;
el preflight del runbook exige detenerse si el cronograma cambió.

backup.merge no reemplaza metadatos de calendario, configuración,
importMetadata ni auditoría actuales. Mezcla catálogos, series, excepciones y
actividades mediante ID, sourceKey o claves naturales; remapea referencias y
prefiere el registro con updatedAt más reciente. Los empates o registros
actuales más recientes se reportan como conflictos. Las actividades con
referencias ausentes o inválidas no se incorporan. Al final elimina de
document.series las series que ya no son usadas por actividades. Si la mezcla
produce cambio, el contrato incrementa una revisión y audita backup_merged.

Ni backup.restore ni backup.merge deben confundirse con crear una orden
externa: este documento sólo modela actividades del calendario y no órdenes de
SIYS.

## 7. Hechos comprobados y pendientes

### Hechos comprobados

- El esquema vigente generado por createDefaultDocument es el esquema 4 y
  tiene exactamente los ocho bloques documentales descritos: calendarMeta,
  catalog, activities, series, settings, holidayOverrides,
  importMetadata y audit, además de schemaVersion y appVersion.
- La cuarentena/Pendiente está representada por la combinación estructural
  planningBucket: "quarantine", date: null, status: "to_schedule" y
  seriesId: null; las pruebas cubren creación, migración, respaldo, CSV e
  importación de esa combinación.
- Una serie no comparte IDs de actividad: cada fecha es una tarjeta independiente
  y la relación se hace por seriesId.
- Las operaciones mutadoras del contrato son atómicas sobre un draft saneado,
  tienen payload estricto y devuelven changed, result, warnings y
  auditEntry.
- La revisión y la auditoría se actualizan una vez por mutación real, mientras
  que las lecturas y no-op no avanzan el documento.
- La no laborabilidad combina domingos, festivos nacionales y
  holidayOverrides; el código permite una confirmación explícita o una
  inclusión de rango según la operación.

### Pendientes o límites del código actual

- No existe un grafo formal de transición de status, ni un estado de
  aprobación/revisión humana. El sistema valida combinaciones y enums, pero no
  impone una secuencia de negocio entre scheduled, confirmed,
  in_progress, completed, not_executed y cancelled.
- activity.delete sólo filtra activities; no elimina por sí mismo una fila de
  series que quede huérfana. backup.merge sí poda series no usadas. La
  política deseada para el borrado de la serie debe decidirse antes de
  convertirla en una nueva invariante.
- sanitizeDocument valida actividades y excepciones, pero no hace una
  validación general de todas las referencias de catálogo ni exige que cada
  seriesId tenga una fila de series. Algunas operaciones del contrato y
  backup.merge sí hacen esas comprobaciones para los datos que reciben.
- No hay compare-and-swap de calendarMeta.revision en backup.restore; la
  detección de cambios concurrentes es una revisión previa operacional, no una
  garantía del contrato.
- series.originalStart y series.originalEnd no tienen una semántica única
  aplicada por todas las mutaciones: la creación y la ampliación por rango los
  actualizan de formas definidas, mientras que mover o editar fechas no los
  recalcula siempre.
- city de actividad es texto y catalog.cities no tiene una FK desde la
  actividad. Normalizar esa relación requeriría una decisión de esquema nueva,
  no una inferencia documental.
- No existe en el documento un actor, una aprobación, un motivo estructurado de
  conflicto, una marca deletedAt, una entidad de orden externa o una lista
  inversa de actividades dentro de series. Esos conceptos no deben agregarse a
  payloads ni a respaldos hasta que se diseñe una versión de contrato/esquema.

Este inventario deja separadas las reglas implementadas de las decisiones que
requieren una tarea posterior. Mientras sigan pendientes, una integración debe
usar las operaciones actuales, revisar sus warnings/conflictos y conservar el
respaldo origen.
