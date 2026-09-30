# Paquete de pruebas de `calendary`

La CLI se prueba sin depender de IndexedDB, GitHub Pages, la Base Operativa
real ni una red externa. El smoke ejecuta el proceso real; la ruta e2e ejecuta
`runCli()` in-process contra un fake Supabase stateful.

## Ruta lógica

Cada ejecución e2e opera sobre el documento remoto simulado, que se actualiza
tras cada RPC. La secuencia representa el uso operativo esperado:

1. `--help` y `--version`.
2. Inspección del calendario.
3. Consulta de clientes, sedes y responsables.
4. Alta de registros de catálogo.
5. Consulta y alta de excepciones de festivos.
6. Creación de una actividad de varios días y de un operando `--payload-file`.
7. Reordenamiento, listado filtrado y consulta por identificador.
8. Edición común y de estado para una serie.
9. Intento de mover a domingo sin autorización y rechazo seguro.
10. Movimiento autorizado, duplicación y ampliación.
11. Cambio de estado y edición múltiple.
12. Eliminación confirmada y consulta `NOT_FOUND` posterior.
13. Exportación CSV con `--csv-output`.
14. Combinación de un respaldo con una actividad nueva (`--backup-file`).
15. Restauración del respaldo anterior (`--backup-file`).
16. `dry-run`, `quiet`, JSON inválido y confirmación faltante.
17. Identificación del calendario con sincronización de metadata.
18. Evidencia de revisión: `cloudRevision N → mutación → N+1`.

## Capas

| Archivo | Alcance |
|---|---|
| `tests/contract.test.mjs` | atomicidad, revisiones, reglas del contrato y operaciones públicas |
| `tests/cli.test.mjs` | ayuda, versión y rechazo de `--source file`, `--input` y `--write` |
| `tests/cli-e2e.test.mjs` | contrato público completo contra un fake Supabase stateful |
| `tests/cloud-read-contract.test.mjs` | lectura cloud, selección, canales y sin fallback file |
| `tests/cloud-write-contract.test.mjs` | RPC atómico, CAS, conflicto, 401, red y timeout |
| `tests/cloud-mutation-cli.test.mjs` | mutaciones y `calendar.identify` sobre el writer |
| `tests/cloud-backup-cli.test.mjs` | `backup restore|merge` con `--backup-file` |
| `tests/migration-rpc-contract.test.mjs` | contrato SQL de `persist_calendar_document` |

La cobertura combinada exige que todas las operaciones públicas del contrato
estén presentes en la suite. La ruta e2e ejercita calendario, actividades,
catálogo, festivos, respaldos y normalización documental; `calendar.identify`
también se cubre en `tests/contract.test.mjs` junto con sus invariantes de
escritura.

## Ejecución

```powershell
npm run cli:smoke  # casos rápidos de proceso
npm run cli:e2e    # ruta cloud completa aislada
npm run test:cli   # smoke + e2e
npm test           # contrato, CLI, documentación e importador
npm run goal:check # gate completo del proyecto
```

La suite comprueba stdout, stderr, códigos de salida, `--yes`, `--dry-run`,
`--quiet`, JSON limpio, operaciones que no deben persistir y errores
accionables. No prueba la Base Operativa real ni los despliegues públicos; esos
son escenarios separados de navegador y de publicación.

La e2e usa un fake Supabase con estado en memoria: GET `calendars`, GET
`profiles`, GET `calendar_documents` y RPC `persist_calendar_document`. El RPC
fake comprueba `expected_revision`, devuelve conflicto si no coincide,
actualiza el documento sólo cuando coincide, incrementa la revisión cloud y
sincroniza `name`/`coordinator` del calendario. Las reglas de negocio
permanecen en `calendar-contract`; el fake sólo almacena estado.

La lectura cloud se prueba además en `tests/cloud-read-contract.test.mjs`
mediante fixtures HTTP sintéticos. La matriz T1–T39 cubre canales stable/beta,
selección inequívoca, `--mine`, documento actual, revisiones separadas,
`observedAt`, `documentUpdatedAt`, hash, reutilización de `calendar-contract`,
errores de auth/RLS, rechazo de métodos no GET, ausencia de fallback y rechazo
explícito de `--as-of`, así como el retiro del modo file. La escritura cloud se
prueba en `tests/cloud-write-contract.test.mjs` (RPC atómico, CAS, conflicto,
401, red, timeout) y en `tests/cloud-mutation-cli.test.mjs` (mutaciones y
`calendar.identify` sobre el mismo writer). El contrato SQL de la migración se
verifica en `tests/migration-rpc-contract.test.mjs`. La suite no usa datos cloud
reales ni guarda tokens.
