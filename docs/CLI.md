# CLI `calendary`

La CLI es una capa local y portable sobre el mismo contrato de la interfaz. La
fuente `file` (predeterminada) no usa red ni abre IndexedDB: lee una copia JSON
y, para cambios, crea otra copia JSON. La fuente `cloud` lee y escribe el
documento actual de Supabase mediante la operación atómica de persistencia; no
implementa migraciones, backfill ni historial as-of.

El flujo operativo completo —incluida la carpeta canónica de respaldos, la
separación estable/beta y la restauración verificada— está en
[Operación de respaldos JSON](OPERACION_RESPALDOS_JSON.md).

## Inicio rápido

Requiere Node.js 20 o superior. Desde el repositorio:

```powershell
npm run cli -- --help
npm run cli -- calendar inspect --input .\cronograma.json --output json
npm run cli -- activity list --input .\cronograma.json --from 2026-08-01 --to 2026-08-31
npm run cli -- activity extend-range --input .\cronograma.json --dry-run `
  --payload '{"activityId":"actividad_123","fromDate":"2026-08-03","toDate":"2026-08-14","mode":"extend"}'
```

## Lectura cloud actual

La fuente cloud requiere `SIYS_SUPABASE_URL`,
`SIYS_SUPABASE_PUBLISHABLE_KEY` y una sesión autenticada. Stable y beta usan
el mismo proyecto Supabase, pero sus `legacy_id` son distintos:

```text
stable → calendario-hvac-siys
beta   → calendario-hvac-siys-beta
```

La contraseña nunca se pasa por argv. Puede iniciar sesión de forma
interactiva o mediante stdin:

```powershell
npm run cli -- cloud login --email coordinador@example.com
npm run cli -- cloud whoami --output json
npm run cli -- cloud calendars --channel beta --output json
npm run cli -- cloud logout
```

Para consultar un calendario actual la selección debe ser inequívoca. Si hay
varios candidatos, la CLI devuelve `CALENDAR_AMBIGUOUS`; no elige el más
reciente ni el primero:

```powershell
npm run cli -- activity list --source cloud --channel beta `
  --calendar-id 00000000-0000-0000-0000-000000000000 `
  --from 2026-08-15 --to 2026-08-15 --output json
```

Cada resultado cloud incluye `source.kind`, `channel`, `calendarId`,
`legacyId`, `calendarName`, `createdBy`, `cloudRevision`,
`documentRevision`, `documentUpdatedAt`, `observedAt` y `documentHash`.
`cloudRevision` y `documentRevision` son contadores independientes: el primero
corresponde a la fila `calendar_documents` y el segundo a
`document.calendarMeta.revision`. No se exige igualdad; si ambos existen y
difieren, se conservan y se informa `REVISION_COUNTERS_DIFFER`, sin bloquear
la lectura ni presentar el documento como corrupto. `observedAt` es el momento de lectura y
`documentUpdatedAt` el timestamp de la fila actual. `as-of` histórico no está
soportado y falla con `HISTORICAL_QUERY_UNSUPPORTED`.

Las operaciones de lectura cloud sólo realizan GET sobre `calendars`,
`calendar_documents` y, cuando está disponible, `profiles`. Las mutaciones con
`--source cloud` ejecutan el contrato local y persisten por el RPC transaccional
`persist_calendar_document`: hace CAS sobre `calendar_documents.revision` y
sincroniza `calendars.name`/`coordinator` desde el mismo documento en una sola
transacción. El inicio y cierre de sesión usan las operaciones de autenticación
correspondientes. Los errores de autenticación, RLS o red no hacen fallback
silencioso al JSON local. Si `calendar_documents.revision` cambió en el
servidor, la operación falla con `CONFLICT` sin recargar ni reaplicar.
`backup restore` y `backup merge` también aceptan `--source cloud` y persisten
por ese mismo RPC; el respaldo se indica siempre con `--backup-file`.

Una escritura nunca sobrescribe la entrada ni un destino existente:

```powershell
npm run cli -- activity move `
  --input .\cronograma.json `
  --write .\cronograma-movido.json `
  --activity-ids actividad_123 `
  --target-date 2026-08-10
```

Para automatización, `--payload` acepta directamente el objeto definido en el
[contrato](CONTRATO_CALENDARIO.md):

```powershell
npm run cli -- activity create `
  --input .\cronograma.json `
  --write .\cronograma-nuevo.json `
  --payload '{"date":"2026-08-03","serviceType":"administrative","status":"scheduled","observations":"Planeación"}' `
  --output json
```

Use `--dry-run` para validar sin generar archivo. Las operaciones destructivas
`activity delete`, `holiday delete` y `backup restore` solicitan confirmación;
en procesos no interactivos requieren `--yes`. Las fechas dominicales o
festivas requieren `--allow-non-working` cuando la operación tiene ese control.
Para normalizar texto visible o ampliar rangos se recomienda usar `--payload`
con el objeto exacto del contrato.

## Respaldos (`backup restore` / `backup merge`)

`--source` selecciona siempre la autoridad o target del calendario (`file` o
`cloud`). El respaldo JSON es un operando independiente que se indica con
`--backup-file` y nunca determina el target. En modo file, `--input` es el
documento actual, `--backup-file` el respaldo y `--write` el destino nuevo; en
modo cloud, el documento actual se lee del calendario y el respaldo sólo entra
por `--backup-file`.

File restore (el `--source file` es el predeterminado y puede omitirse):

```powershell
npm run cli -- backup restore `
  --input .\actual.json `
  --backup-file .\respaldo.json `
  --write .\restaurado.json
```

File merge:

```powershell
npm run cli -- backup merge `
  --source file `
  --input .\actual.json `
  --backup-file .\respaldo.json `
  --write .\combinado.json
```

Cloud restore (`--yes` confirma la operación destructiva en modo no interactivo):

```powershell
npm run cli -- backup restore `
  --source cloud --channel beta `
  --calendar-id 00000000-0000-0000-0000-000000000000 `
  --backup-file .\respaldo.json `
  --yes
```

Cloud merge:

```powershell
npm run cli -- backup merge `
  --source cloud --channel beta `
  --calendar-id 00000000-0000-0000-0000-000000000000 `
  --backup-file .\respaldo.json
```

Cloud dry-run (lee el documento real, valida el respaldo y ejecuta el contrato,
sin persistir):

```powershell
npm run cli -- backup restore `
  --source cloud --channel beta `
  --calendar-id 00000000-0000-0000-0000-000000000000 `
  --backup-file .\respaldo.json `
  --dry-run --yes
```

La sintaxis histórica `backup restore --source respaldo.json` ya no es válida:
`--source` sólo admite `file` o `cloud`. El respaldo se indica con
`--backup-file`.

## Salidas y códigos

`--output human` es legible; `--output json` deja datos estructurados en
stdout. Los errores van a stderr. Códigos: `0` éxito, `1` error interno/IO, `2`
entrada o validación, `3` no encontrado y `4` conflicto o confirmación faltante.

`calendar export-csv` imprime CSV en stdout o lo crea con `--csv-output`. CSV
es la única exportación tabular de la CLI MVP; Excel y PNG permanecen en la UI.

## Verificación

```powershell
npm run cli:smoke
npm run cli:e2e
npm run test:cli
npm run goal:check
```

La ruta lógica y la matriz completa están en
[PRUEBAS_CLI.md](PRUEBAS_CLI.md). La prueba e2e usa una copia sintética
temporal, encadena cada operación sobre el respaldo anterior y comprueba que
las operaciones públicas del contrato sean invocables desde la CLI.
