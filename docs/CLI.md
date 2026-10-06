# CLI `calendary`

`calendary --version` usa `apps/cli/src/version.js > CLI_VERSION`, hoy
`0.18.0-beta.1`, independiente de `WEB_VERSION` (`0.19.0`, publicada como
estable y servida también desde `/beta/` hasta la próxima capacidad beta).
El chequeo Web no requiere que CLI coincida.
La CLI no importa versión Web ni pasa `document.appVersion` al contrato para
sellar mutaciones. Ese campo es metadato legado opaco, no compatibilidad ni
identidad del último escritor. Las mutaciones lo conservan; restore toma el
del respaldo y merge conserva el actual. Schema sigue en 4, contrato en 1 y
formato de respaldo en 1.

La CLI vive en el workspace privado `apps/cli` (`@siys-sync/cli`) y consume la
lógica compartida de `packages/platform` mediante imports
`@siys-sync/platform/...`. La raíz es orquestación privada sin versión.
`apps/cli/package.json.version` coincide con `CLI_VERSION`; el canal formal
es GitHub Release mediante tags `cli-v<version>`, independiente de Pages.

## Instalación desde release

1. Descargue el ZIP y `.zip.sha256` de la release `cli-v0.18.0-beta.1`.
2. Compruebe SHA-256 y extraiga `calendary-cli-0.18.0-beta.1.zip`.
3. Instale Node.js >=20 y entre a la carpeta extraída.
4. Ejecute `node bin/calendary.js --version` y `node bin/calendary.js --help`.

No requiere `npm install` ni clonar el repositorio. El ZIP contiene `bin/`,
`src/`, `package.json`, `README.txt` y `node_modules/@siys-sync/platform/`.
No incorpora URL/key Supabase ni credenciales; configure
`SIYS_SUPABASE_URL` y `SIYS_SUPABASE_PUBLISHABLE_KEY` con el modelo existente.
En los ejemplos de esta guía, sustituya `npm run cli --` por
`node bin/calendary.js` cuando use el ZIP.

Para actualizar, extraiga la nueva release en otra carpeta. Para desinstalar,
elimine esa carpeta; gestione la sesión externa mediante `cloud logout`.
La primera release `cli-v0.18.0-beta.1` ya está publicada; la promoción Web
`0.19.0` no mueve el tag CLI ni republica manualmente.

La CLI es una capa local y portable sobre el mismo contrato de la interfaz.
Supabase es la única autoridad del calendario: la CLI autentica, lee el
documento actual del calendario seleccionado, ejecuta el contrato y, cuando hay
cambios, persiste por la operación atómica de Supabase. No implementa
migraciones, backfill ni historial as-of. No existe modo file: un archivo JSON
nunca actúa como documento actual, autoridad ni destino de mutaciones.

Los únicos archivos que la CLI acepta son operandos o salidas explícitas:

- `--backup-file`: respaldo JSON para `backup restore|merge`;
- `--payload-file`: objeto exacto de una operación;
- `--csv-output`: destino de `calendar export-csv|export-quarantine-csv`.

El flujo operativo completo —incluida la carpeta canónica de respaldos, la
separación estable/beta y la restauración verificada— está en
[Operación de respaldos JSON](OPERACION_RESPALDOS_JSON.md).

## Inicio rápido

Requiere Node.js 20 o superior, `SIYS_SUPABASE_URL`,
`SIYS_SUPABASE_PUBLISHABLE_KEY` y una sesión autenticada. Desde el repositorio:

```powershell
npm run cli -- --help
npm run cli -- cloud login --email coordinador@example.com
npm run cli -- cloud whoami --output json
npm run cli -- cloud calendars --channel beta --output json
```

Para operar el calendario, la selección cloud debe ser explícita y segura. Si
falta `--source cloud` la CLI falla con `INVALID_REQUEST` antes de cualquier
red; tampoco se acepta `--source file`:

```text
calendary activity list \
  --source cloud \
  --channel beta \
  --calendar-id <uuid>
```

Stable y beta usan el mismo proyecto Supabase, pero sus `legacy_id` son
distintos:

```text
stable → calendario-hvac-siys
beta   → calendario-hvac-siys-beta
```

La contraseña nunca se pasa por argv. La sesión se inicia de forma interactiva
o mediante stdin:

```powershell
npm run cli -- cloud logout
```

## Lectura cloud actual

Para consultar un calendario actual la selección debe ser inequívoca. Si hay
varios candidatos, la CLI devuelve `CALENDAR_AMBIGUOUS`; no elige el más
reciente ni el primero:

```powershell
npm run cli -- activity list --source cloud --channel beta `
  --calendar-id 00000000-0000-0000-0000-000000000000 `
  --from 2026-08-15 --to 2026-08-15 --output json
```

`--mine` restringe la selección a `created_by` del usuario autenticado y no
puede combinarse con `--calendar-id`.

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
`calendar_documents` y, cuando está disponible, `profiles`. Las mutaciones
ejecutan el contrato local y persisten por el RPC transaccional
`persist_calendar_document`: hace CAS sobre `calendar_documents.revision` y
sincroniza `calendars.name`/`coordinator` desde el mismo documento en una sola
transacción. El inicio y cierre de sesión usan las operaciones de autenticación
correspondientes. Los errores de autenticación, RLS o red no hacen fallback
silencioso a JSON local. Si `calendar_documents.revision` cambió en el
servidor, la operación falla con `CONFLICT` sin recargar ni reaplicar.

## Mutaciones

Todas las operaciones mutantes del contrato pasan por el mismo camino:
autenticación, `CloudCalendarSource`, contrato y, si `changed === true` y no es
`--dry-run`, `CloudCalendarWriter`. Un no-op (`changed === false`) no emite RPC
y no avanza la revisión cloud.

```powershell
npm run cli -- activity create `
  --source cloud --channel beta `
  --calendar-id 00000000-0000-0000-0000-000000000000 `
  --payload '{"date":"2026-08-03","serviceType":"administrative","status":"scheduled","observations":"Planeación"}' `
  --output json
```

Para automatización, `--payload` acepta directamente el objeto definido en el
[contrato](CONTRATO_CALENDARIO.md); `--payload-file` lee ese objeto desde un
archivo como operando, nunca como estado:

```powershell
npm run cli -- activity create `
  --source cloud --channel beta `
  --calendar-id 00000000-0000-0000-0000-000000000000 `
  --payload-file .\payload.json `
  --output json
```

Use `--dry-run` para autenticar, leer el documento real y validar el contrato
sin persistir. Las operaciones destructivas `activity delete`, `holiday delete`
y `backup restore` solicitan confirmación; en procesos no interactivos
requieren `--yes`. Las fechas dominicales o festivas requieren
`--allow-non-working` cuando la operación tiene ese control. Para normalizar
texto visible o ampliar rangos se recomienda usar `--payload` con el objeto
exacto del contrato.

## Respaldos (`backup restore` / `backup merge`)

El respaldo JSON es un operando independiente que se indica con
`--backup-file` y nunca determina el target. El documento actual se lee del
calendario cloud seleccionado y el respaldo sólo entra por `--backup-file`.

Cloud restore (`--yes` confirma la operación destructiva en modo no
interactivo):

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

`--backup-file` sólo se admite en `backup restore|merge`; en cualquier otra
operación se rechaza con `INVALID_REQUEST`. Las sintaxis históricas
`--source file`, `--input` y `--write` fueron retiradas y fallan de forma
explícita antes de cualquier red o archivo.

## Salidas y códigos

`--output human` es legible; `--output json` deja datos estructurados en
stdout. Los errores van a stderr. Códigos: `0` éxito, `1` error interno/IO, `2`
entrada o validación, `3` no encontrado y `4` conflicto o confirmación faltante.

`calendar export-csv` y `calendar export-quarantine-csv` imprimen CSV en stdout
o lo crean con `--csv-output`. CSV es la única exportación tabular de la CLI;
Excel y PNG permanecen en la UI.

## Verificación

```powershell
npm run cli:smoke
npm run cli:e2e
npm run test:cli
npm run goal:check
```

La ruta lógica y la matriz completa están en
[PRUEBAS_CLI.md](PRUEBAS_CLI.md). La prueba e2e ejecuta la CLI in-process
contra un fake Supabase stateful (Auth, PostgREST y el RPC
`persist_calendar_document`), encadena cada operación sobre el documento
remoto actualizado tras cada RPC y comprueba que las operaciones públicas del
contrato sean invocables desde la CLI. Los archivos temporales se usan
únicamente como `--backup-file` o `--csv-output`.
