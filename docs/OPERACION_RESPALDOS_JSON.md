# Operación de respaldos JSON

Este documento define el procedimiento seguro para trasladar un cronograma
entre la interfaz web y una CLI que opere sobre el contrato del calendario.
La operación es local y portable: el JSON es el artefacto de intercambio, no
una base de datos compartida.

## Estado y alcance

La línea publicada incluye `bin/calendary.js`, el contrato compartido y las
pruebas de la CLI. La CLI opera únicamente sobre copias JSON y no accede
directamente a IndexedDB ni a Supabase. La interfaz y la CLI usan la misma
frontera de escritura.

Una **actividad de calendario** no es una orden real creada en SIYS.net. Si se
necesita crear una orden en SIYS, debe usarse el flujo y contrato de SIYS
correspondientes, con su propia investigación y confirmación.

## Ruta canónica de respaldos

Para este equipo, todos los respaldos de cronogramas se guardan en:

```powershell
$backupRoot = 'C:\Users\CoordServicio\OneDrive - Siys\cronogramas\Respaldo'
```

Reglas de la carpeta:

- El archivo descargado es el **origen inmutable** y nunca se sobrescribe.
- El JSON modificado se escribe en la misma carpeta con un nombre nuevo.
- El resultado restaurado se descarga nuevamente en la misma carpeta.
- Los archivos `.tmp`, incompletos o con tamaño todavía cambiante no se usan.
- La CLI no debe incrustar esta ruta en el contrato; la ruta es una convención
  operativa de este equipo y puede recibirse mediante `--input` y `--write`.

Convención recomendada:

```text
YYYY-MM-DD_HH-mm-ss_respaldo-cronograma_<coordinador>.json
YYYY-MM-DD_HH-mm-ss_cli-<accion>_<cliente>-<sede>.json
YYYY-MM-DD_HH-mm-ss_verificado-<canal>_<cliente>-<sede>.json
```

Ejemplo:

```text
2026-08-03_09-28-04_respaldo-cronograma_yuliam-rivera.json
2026-08-03_09-32-10_cli-activity-create_homecenter-armenia.json
2026-08-03_09-40-00_verificado-beta_homecenter-armenia.json
```

## Canales, perfiles y versiones

El archivo local usa IndexedDB separado. Stable y beta usan Supabase, pero cada
canal conserva un calendario lógico distinto. El archivo sólo debe volver al
mismo canal y perfil del que salió, salvo que se haya autorizado un traslado
explícito.

| Canal | URL | Referencia de versión | Regla |
|---|---|---|---|
| Estable | `https://yuliamrg.github.io/calendario-hvac-siys/` | `v0.14.1` | Uso operativo aprobado; Supabase/Auth |
| Beta | `https://yuliamrg.github.io/calendario-hvac-siys/beta/` | Leer el encabezado y el JSON | Supabase/Auth; calendario beta separado |
| Local | `dist/calendario-hvac-siys.html` | Leer la etiqueta de la interfaz | IndexedDB y sin autenticación |

Antes de modificar un archivo se registran: URL, canal, perfil de Chrome,
versión visible, `appVersion` del JSON, `schemaVersion`, revisión, fecha de
exportación y hash SHA-256.

Durante el ensayo del 3 de agosto de 2026 se observó una discrepancia: el
respaldo declaraba `channel: "beta"` y `appVersion: "0.10.0"`, mientras el
código local de la CLI beta declaraba `0.11.0-beta.1`. Esto debe tratarse como
una alerta de despliegue, no como una coincidencia de versiones. Si la versión
visible, la versión del respaldo y la versión esperada no coinciden, se detiene
la operación hasta identificar cuál publicación es la correcta.

## Flujo obligatorio

### 1. Preflight sin mutaciones

1. Confirmar el canal solicitado: estable o beta.
2. Confirmar que Chrome usa el perfil personal correcto.
3. Confirmar la URL, el distintivo del canal, la versión visible y el estado
   `Guardado`.
4. Verificar que no haya otra pestaña editando el mismo cronograma.
5. Anotar la revisión actual y no continuar si la versión es incompatible.

No se debe inferir el canal por el aspecto visual de la página: se usa la URL,
el distintivo y los metadatos del respaldo.

### 2. Descargar siempre un respaldo nuevo

Desde **Gestionar → Descargar copia del cronograma**:

1. Guardar el archivo en `$backupRoot`.
2. Esperar a que termine la descarga y exista un `.json` completo.
3. No reutilizar un respaldo antiguo sólo porque tiene un nombre parecido.
4. Calcular y conservar el hash:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath $source
```

El respaldo nuevo es la única entrada autorizada para la modificación.

### 3. Validar e inspeccionar el JSON

La validación mínima, incluso cuando no esté disponible la CLI, es:

```powershell
$raw = Get-Content -Raw -LiteralPath $source | ConvertFrom-Json
[PSCustomObject]@{
  Format = $raw.format
  FormatVersion = $raw.formatVersion
  AppVersion = $raw.appVersion
  Channel = $raw.channel
  Revision = $raw.revision
  ExportedAt = $raw.exportedAt
  SchemaVersion = $raw.document.schemaVersion
  Activities = @($raw.document.activities).Count
}
```

Se espera `format: calendario-hvac-siys-backup`, `formatVersion: 1`, un
`document` válido y un `schemaVersion` soportado por la aplicación.

La inspección se realiza además con:

```powershell
node bin/calendary.js calendar inspect --input $source --output json
```

La inspección es de sólo lectura y debe conservarse junto con el registro de
la operación.

### 4. Modificar mediante el contrato

La modificación se hace con la CLI y el contrato, nunca editando el JSON a
mano. El origen y el destino deben ser archivos diferentes:

```powershell
$modified = Join-Path $backupRoot 'YYYY-MM-DD_HH-mm-ss_cli-<accion>_<cliente>-<sede>.json'

node bin/calendary.js activity create `
  --input $source `
  --write $modified `
  --payload '<objeto JSON definido por el contrato>' `
  --output json
```

Antes de la escritura definitiva se ejecuta `--dry-run` cuando la operación lo
permita y se revisan `changed`, `revision`, IDs creados, advertencias y
conteos. No se usa `--yes` para ocultar una confirmación que requiera criterio
operativo.

Reglas del payload:

- Fechas en `YYYY-MM-DD`, nunca `03/08/2026` ni fechas ambiguas.
- Usar los IDs existentes de cliente, sede y responsables.
- Resolver nombres contra el catálogo; no corregir ortografía a mano ni
  adivinar coincidencias.
- Conservar `null` y campos opcionales según el contrato.
- Mantener UTF-8 para nombres con tildes y caracteres especiales.
- No agregar campos desconocidos ni eliminar partes no relacionadas del
  documento.

### 5. Restaurar en el mismo canal

En la misma sesión de Chrome:

1. Abrir **Gestionar → Recuperar una copia del cronograma**.
2. Elegir el JSON modificado.
3. Revisar nombre, canal, versión, revisión, actividades y catálogos en el
   resumen.
4. Confirmar sólo si la revisión y los conteos son los esperados.
5. Usar **Combinar otra copia** únicamente cuando se haya pedido combinar;
   **Recuperar** reemplaza el documento completo.

Una restauración no debe ejecutarse si, después de descargar el origen, el
cronograma actual cambió. En ese caso se descarga otro respaldo y se repite el
flujo desde el preflight.

La automatización con Chrome adjunto puede rechazar la carga directa con
`DOM.setFileInputFiles: Not allowed`. No se debe desactivar la seguridad ni
reintentar una mutación ambigua: se conserva el JSON, se usa la selección
normal del navegador o se solicita la carga manual y luego se verifica el
resultado.

### 6. Verificar y cerrar

Después de restaurar:

1. Confirmar visualmente la tarjeta en la fecha correcta.
2. Abrir el detalle y verificar cliente, sede, ciudad, responsables, servicio,
   estado y observaciones.
3. Descargar un respaldo final en `$backupRoot`.
4. Inspeccionar el respaldo final y verificar el ID de la actividad.
5. Guardar los tres artefactos: origen, modificado y verificado.

Si un clic, una carga o una restauración termina en timeout, el resultado se
considera **ambiguo** hasta consultar nuevamente la aplicación. No se repite
automáticamente una operación de escritura.

## Estructura JSON que debe conservarse

El respaldo versionado contiene una envoltura similar a:

```text
format
formatVersion
exportedAt
appVersion
origin
channel
revision
document
```

Dentro de `document` se conservan, entre otros:

```text
schemaVersion
appVersion
calendarMeta
catalog
activities
series
settings
holidayOverrides
importMetadata
audit
```

La CLI modifica únicamente lo necesario y entrega un documento saneado. No se
deben copiar cédulas, teléfonos, correos ni otros datos sensibles a nombres de
archivo, logs o payloads de prueba.

## Checklist de aceptación

- [ ] Canal, URL, perfil y versión fueron confirmados.
- [ ] Se descargó un respaldo nuevo en `$backupRoot`.
- [ ] El archivo `.json` es válido, completo y tiene hash registrado.
- [ ] `channel`, `appVersion`, `schemaVersion` y revisión fueron inspeccionados.
- [ ] Se usaron IDs de catálogo exactos.
- [ ] El archivo original no fue sobrescrito.
- [ ] La CLI produjo un destino nuevo y una salida estructurada.
- [ ] La vista previa de restauración coincidió con lo esperado.
- [ ] La restauración se hizo en el mismo canal y perfil.
- [ ] Se verificó la tarjeta y se descargó el respaldo final.
- [ ] No hubo reintentos automáticos después de un resultado ambiguo.
