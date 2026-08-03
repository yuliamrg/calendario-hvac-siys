# Contrato de operaciones del calendario

`src/calendar-contract.js` es la única frontera de escritura compartida por la
interfaz y la CLI. Recibe un documento, una solicitud y opciones de ejecución;
no lee IndexedDB, archivos, red ni variables de entorno.

```js
executeCalendarOperation(document, {
  operation: "activity.move",
  payload: { activityIds: ["actividad_1"], targetDate: "2026-08-10" }
}, { now, idFactory });
```

## Respuesta e invariantes

Todas las operaciones retornan `{ contractVersion, operation, changed,
document, result, warnings, auditEntry }`. Las escrituras son atómicas: se
sanea y clona la entrada, y un error nunca altera el objeto recibido. Un cambio
real incrementa una sola vez `calendarMeta.revision`, actualiza versiones y
añade auditoría; una operación idéntica devuelve `changed: false` sin revisión
ni auditoría.

Los errores exponen `CalendarContractError.code`: `INVALID_REQUEST`,
`INVALID_DOCUMENT`, `UNSUPPORTED_SCHEMA`, `VALIDATION_FAILED`, `NOT_FOUND`,
`CONFLICT`, `NON_WORKING_CONFIRMATION_REQUIRED` o `INTERNAL_ERROR`.

## Operaciones

| Operación | Payload específico | Resultado principal |
|---|---|---|
| `calendar.inspect` | `{}` | metadatos, conteos y rango |
| `calendar.export-csv` | `{ year, month }` | contenido, MIME y nombre CSV |
| `activity.list` | `from`, `to`, `clientId`, `siteId`, `city`, listas de responsables/servicios/estados, `query` | `items` resueltos |
| `activity.get` | `{ activityId }` | actividad resuelta |
| `activity.create` | fecha/rango, referencias, servicio, estado, observaciones y política no laborable | IDs, serie y fechas omitidas |
| `activity.edit` | `{ activityId, patch, commonScope, statusScope, allowNonWorking }` | IDs y campos cambiados |
| `activity.move` | `{ activityIds, targetDate, anchorId?, mode?, allowNonWorking? }` | movimientos |
| `activity.duplicate` | `{ activityIds, targetDate, anchorId?, allowNonWorking? }` | IDs nuevos |
| `activity.extend` | `{ activityId, targetDate, allowNonWorking? }` | tarjeta y serie |
| `activity.status` | `{ activityId, status, scope? }` | IDs afectados |
| `activity.bulk-edit` | `{ activityIds, field, value, mode? }` | IDs y campo |
| `activity.delete` | `{ activityIds }` | IDs eliminados |
| `catalog.list` | `{ type, active?, query? }` | registros |
| `catalog.upsert` | `{ type, id?, values }` | registro creado/actualizado |
| `holiday.list` | `{ year }` o `{ from, to }` | festivos calculados |
| `holiday.add` | `{ date, type, name, reason? }` | ID de excepción |
| `holiday.delete` | `{ overrideId }` | ID eliminado |
| `backup.restore` | `{ document }` | revisión origen y conteos |
| `backup.merge` | `{ document }` | conteos, detalles y advertencias |

Los payloads son estrictos: campos desconocidos se rechazan. Las fechas usan
`YYYY-MM-DD`; los alcances son `single`, `future` o `series` según la operación;
y mover, duplicar, ampliar o editar hacia domingo/festivo requiere
`allowNonWorking: true`. Las referencias de cliente, sede y responsables deben
existir y ser coherentes.

## Límites de la CLI MVP

El contrato manipula el JSON canónico. IndexedDB sigue siendo un adaptador
exclusivo de la interfaz. Excel, PNG, importación de Base Operativa y control de
pestañas continúan como capacidades de UI y no forman parte de la CLI MVP.
