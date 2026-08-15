# CLI `calendary`

La CLI es una capa local y portable sobre el mismo contrato de la interfaz. No
instala un servicio, no usa red y no abre IndexedDB: siempre lee una copia JSON
y, para cambios, crea otra copia JSON.

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
