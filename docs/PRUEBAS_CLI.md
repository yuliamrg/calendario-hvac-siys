# Paquete de pruebas de `calendary`

La CLI se prueba por proceso real, con archivos JSON temporales y sin depender
de IndexedDB, GitHub Pages, la Base Operativa real o una red externa.

## Ruta lógica

Cada ejecución e2e conserva el resultado anterior como entrada y escribe un
respaldo nuevo. La secuencia representa el uso operativo esperado:

1. `--help` y `--version`.
2. Inspección del calendario.
3. Consulta de clientes, sedes y responsables.
4. Alta de registros de catálogo.
5. Consulta y alta de excepciones de festivos.
6. Creación de una actividad de varios días.
7. Listado filtrado y consulta por identificador.
8. Edición común y de estado para una serie.
9. Intento de mover a domingo sin autorización y rechazo seguro.
10. Movimiento autorizado, duplicación y ampliación.
11. Cambio de estado y edición múltiple.
12. Eliminación confirmada y consulta `NOT_FOUND` posterior.
13. Exportación CSV.
14. Combinación de un respaldo con una actividad nueva.
15. Restauración del respaldo anterior.
16. `dry-run`, `quiet`, JSON inválido, conflicto de ruta y confirmación faltante.

## Capas

| Archivo | Alcance |
|---|---|
| `tests/contract.test.mjs` | atomicidad, revisiones, reglas del contrato y operaciones públicas |
| `tests/cli.test.mjs` | ayuda, JSON, escritura nueva y confirmación no interactiva |
| `tests/cli-e2e.test.mjs` | ruta completa de CLI con proceso real y archivos temporales |

La prueba e2e exige que todas las operaciones públicas del contrato estén
presentes en la cobertura, incluyendo calendario, actividades, catálogo,
festivos, respaldos y normalización documental.

## Ejecución

```powershell
npm run cli:smoke  # casos rápidos de proceso
npm run cli:e2e    # ruta completa aislada
npm run test:cli   # smoke + e2e
npm test           # contrato, CLI, documentación e importador
npm run goal:check # gate completo del proyecto
```

La suite comprueba stdout, stderr, códigos de salida, destinos que no deben
sobrescribirse, `--yes`, `--dry-run`, `--quiet`, JSON limpio y errores
accionables. No prueba la Base Operativa real ni los despliegues públicos; esos
son escenarios separados de navegador y de publicación.

La lectura cloud se prueba en `tests/cloud-read-contract.test.mjs` mediante
fixtures HTTP sintéticos. La matriz T1–T26 cubre canales stable/beta,
selección inequívoca, `--mine`, documento actual, revisiones separadas,
`observedAt`, `documentUpdatedAt`, hash, reutilización de `calendar-contract`,
errores de auth/RLS, rechazo de métodos no GET, compatibilidad `file`, rechazo
de escrituras cloud, ausencia de fallback y rechazo explícito de `--as-of`.
La suite no usa datos cloud reales ni guarda tokens.
