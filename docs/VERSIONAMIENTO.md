# Política de versionamiento y releases

## Propósito

SIYS Sync usa [Semantic Versioning 2.0.0](https://semver.org/), con una política más estricta para el
periodo 0.x porque la aplicación maneja cronogramas operativos, respaldos JSON,
una CLI y un contrato de operaciones compartido.

La versión comunica el alcance del producto publicado. No se usa para contar
commits ni para sustituir la revisión operativa de un documento.

El mapa para leer el sistema es [SISTEMA.md](SISTEMA.md), el documento canónico
está en [MODELO_ESTADOS.md](MODELO_ESTADOS.md) y el empaquetado se explica en
[BUILD_RELEASE.md](BUILD_RELEASE.md).

## 1. Fuentes de versión y artefactos

- Web: `apps/web/package.json.version` = `WEB_VERSION` en
  `apps/web/src/ui/web-version.js`, hoy `0.19.1-beta.1` en `main`; la estable
  publicada sigue en `0.19.0` y `stable-version.txt` conserva su tag mientras
  se certifica la corrección.
- CLI: `apps/cli/package.json.version` = `CLI_VERSION` en
  `apps/cli/src/version.js`, hoy `0.18.0-beta.1`.
- Platform: `packages/platform/package.json.version = 0.0.0`, privado e interno,
  sin tags ni releases propios.
- Raíz: `package.json` privado, sin versión; sólo orquestación. `package-lock.json`
  refleja versiones de workspaces, no contiene versión raíz.
- `stable-version.txt = web-v0.19.0`: puntero Web estable, no versión de main.
- dist: salida generada del build, nunca autoridad ni edición manual.

`npm run version:check` valida cada producto independientemente y el formato
`web-v<stable-semver>` del puntero, sin exigir Web = CLI ni tags durante PR.
Los tags `web-v<version>` identifican Web; `cli-v<version>` identifican CLI.
Los tags históricos `v...` se conservan inmutables.

## 2. Regla base de Semantic Versioning

Una versión normal tiene la forma MAJOR.MINOR.PATCH.

Durante 0.x, SemVer permite cambios incompatibles y no considera estable el
contrato público. Para que las versiones sigan comunicando el alcance del
producto, este proyecto adopta una convención de release habitual: MINOR para
nuevas capacidades y PATCH para correcciones compatibles. Esta convención
aclara el uso de 0.x, pero no modifica ni pretende sustituir la especificación
oficial de SemVer.

| Tipo de cambio | Versión | Criterio |
|---|---|---|
| Nueva capacidad pública compatible | 0.MINOR.PATCH con MINOR + 1 y PATCH = 0 | Añade una función visible, una operación CLI compatible o un flujo operativo nuevo. |
| Corrección compatible | 0.MINOR.PATCH con PATCH + 1 | Corrige un defecto sin añadir una capacidad ni cambiar un contrato público. |
| Iteración de una prerelease | Misma base y beta + 1 | Ajusta, corrige o valida el alcance ya anunciado de la misma release. |
| Cambio incompatible durante 0.x | Nueva línea 0.MINOR.0 | Requiere migración, cambia un contrato o rompe el flujo; debe documentarse como incompatible aunque todavía no sea 1.0.0. |
| Primer contrato estable | 1.0.0 | Se declara estable la API, el formato de respaldo, la CLI y las reglas de compatibilidad. |
| Cambio incompatible después de 1.0.0 | MAJOR + 1 | Rompe el contrato público estable. |

Ejemplos históricos de la convención (no son el estado actual):

~~~text
0.13.0                  -> 0.14.0       nueva capacidad compatible
0.13.0                  -> 0.13.1       corrección compatible
0.13.0-beta.2           -> 0.13.0-beta.3 iteración de la misma release
0.13.0-beta.2           -> 0.13.0      promoción estable
0.13.0                  -> 1.0.0        primer contrato estable, si procede
~~~

La expresión “incrementar 0.1.0” significa incrementar el componente MINOR:
desde 0.13.0 se obtiene 0.14.0. “Incrementar 0.0.1” significa incrementar
PATCH: desde 0.13.0 se obtiene 0.13.1.

No se incrementa MINOR sólo porque haya una nueva compilación. Tampoco se
incrementa PATCH para esconder una nueva capacidad pública.

### Decisión práctica antes de cambiar la versión

La decisión se toma sobre el alcance público que llegará al canal, no sobre el
número de commits ni sobre el tamaño del diff:

| Pregunta | Evidencia que se revisa | Decisión |
|---|---|---|
| ¿Aparece una capacidad visible, una operación CLI o un flujo nuevo para el cliente? | UI, contrato, CLI, manual y pruebas | Nueva línea MINOR en `beta.1`. |
| ¿Sólo corrige un defecto dentro de la capacidad ya anunciada? | Issue, pruebas de regresión y changelog | PATCH de la misma base. |
| ¿La beta conserva exactamente el alcance público de su base? | Changelog y comparación contra el último tag publicado | `beta.N + 1`. |
| ¿Cambia esquema, respaldo, contrato o compatibilidad operativa? | `SCHEMA_VERSION`, `CONTRACT_VERSION`, `formatVersion` y migraciones | Nueva línea y advertencia de compatibilidad; si es incompatible, no se oculta como PATCH. |
| ¿El cambio sólo es documentación, test, CI, build o refactor interno? | No cambia comportamiento ni contrato | Conserva la versión. |

Por ejemplo, los cambios posteriores a `0.16.0-beta.2` agregaron capacidades
públicas de presentación/exportación y fronteras operativas nuevas. Por eso se
abrió `0.17.0-beta.1`; no se usó `0.16.0-beta.3`. El esquema persistido y el
contrato se mantuvieron en 4 y 1, respectivamente, por lo que no fue una
ruptura de compatibilidad.

## 3. Cómo se organiza una línea beta

SemVer define el formato y la precedencia de las prereleases, pero no
prescribe cómo dividir el trabajo en releases ni cuándo abrir una nueva línea
beta. Para mantener un flujo predecible, se fija la versión normal objetivo
antes de publicar beta.1:

Los números de esta sección son ejemplos de la política; el estado actual del
repositorio está en la sección 11.

- Se aplica primero la matriz de la sección 2 al contenido previsto de la
  release. Una nueva capacidad lleva a la siguiente MINOR; una corrección
  compatible lleva a PATCH; un cambio incompatible durante 0.x lleva a una
  nueva línea MINOR.
- Una vez publicada, por ejemplo, `0.14.0-beta.1`, cada beta que valide,
  corrija o ajuste esa misma versión normal conserva la base y aumenta sólo
  `beta.N`: `0.14.0-beta.2`, `0.14.0-beta.3`, etc.
- Si el alcance previsto cambia de forma que la versión normal que corresponde
  ya no es la misma, se cierra la línea y se inicia `beta.1` de la nueva
  versión: `0.14.0-beta.2` -> `0.15.0-beta.1`.
- Los cambios de estilo, accesibilidad, interacción o documentación pueden
  incluirse en la beta de la versión objetivo si no cambian su contrato
  público. Si cambian el esquema, la CLI, el formato de respaldo o el flujo
  operativo de forma incompatible, se aplica la matriz de la sección 2.

No se usa un criterio automático de “si hay duda, nueva línea”. La decisión se
justifica por el alcance declarado de la release y por el contrato público, y
se registra en `CHANGELOG.md` y en el PR. `beta.N` cuenta publicaciones de la
misma versión normal; no cuenta commits ni mide por sí solo el tamaño de la
implementación.

## 4. Flujo de desarrollo

Toda implementación nueva parte del `main` actualizado y se desarrolla en una
rama propia. No se trabaja directamente sobre `main`:

1. Revisar el estado y actualizar `main`:

   ~~~powershell
   git switch main
   git pull --ff-only origin main
   git status --short
   ~~~

   El estado debe estar limpio antes de crear la rama.
2. Crear una rama descriptiva para un solo cambio coherente:

   ~~~powershell
   git switch -c feat/<descripcion-corta>
   ~~~

3. Implementar, probar y actualizar la versión y los artefactos indicados en
   esta política. Si se necesita trabajar en paralelo, puede usarse un
   worktree adicional creado desde `main`.
4. Ejecutar las validaciones, hacer commit y publicar la rama en el remoto.
5. Abrir un PR contra `main` con el alcance, la versión objetivo y las
   evidencias de prueba.
6. Después de integrar el PR, publicar la beta o promover a estable según las
   secciones siguientes. Cuando el trabajo termine, eliminar la rama y el
   worktree asociado si existe; conservar los commits integrados y los tags.

### Commits que no cambian la versión

Los commits de documentación, pruebas, build, CI y refactorización interna
mantienen la versión mientras no cambien el alcance público de la release. Se
identifican con mensajes Conventional Commits, por ejemplo `docs:`, `test:`,
`build:`, `ci:`, `refactor:` o `fix:`. No se incrementa `WEB_VERSION` por el
mero hecho de crear un commit ni se edita `dist/` manualmente.

Un commit de release es distinto: actualiza de forma coordinada
`apps/web/package.json`, `package-lock.json`, `apps/web/src/ui/web-version.js`,
`CHANGELOG.md` y los artefactos requeridos, ejecuta los
gates y recibe el tag `web-v<version>` después de integrar el PR. Un cambio documental que acompaña una versión pendiente se
queda en la misma línea y se integra como commit revisable separado.

## 5. Prereleases y promoción

Una beta tiene una versión base normal seguida de -beta.N:

El ejemplo siguiente es histórico/ilustrativo y no identifica el canal vigente.

~~~text
0.14.0-beta.1 < 0.14.0-beta.2 < 0.14.0
~~~

- beta.1 es la primera publicación pública de la línea.
- beta.2, beta.3, etc. son iteraciones de esa misma línea.
- La promoción elimina el sufijo beta; no cambia MINOR ni PATCH.
- Una release publicada no se retaguea ni se modifica. Cualquier cambio
  posterior obtiene una versión nueva.
- No se usan rc, candidate o experiment como canales operativos hasta añadir
  una regla explícita para ellos.

Por ejemplo, si se acepta 0.14.0-beta.3, la release estable es v0.14.0. La
siguiente release con una nueva capacidad pública será 0.15.0-beta.1; una
corrección posterior a la estable será 0.14.1 o 0.14.1-beta.1 si se prueba
primero como beta.

## 6. Versiones que no son la versión de la aplicación

| Identificador | Qué versiona | Cuándo aumenta |
|---|---|---|
| WEB_VERSION | Release de SIYS Sync Web | Cada publicación Web beta o estable. |
| CLI_VERSION | Release de Calendary CLI | Independiente de Web; GitHub Release ZIP autónomo. |
| document.appVersion | Metadato legado opaco | No se incrementa con mutaciones ni se usa como compatibilidad, productor o último escritor. |
| SCHEMA_VERSION | Formato persistido del calendario | Cuando cambia el formato o las reglas necesarias para leer/escribir documentos; debe existir migración o bloqueo explícito. |
| CONTRACT_VERSION | Respuesta e invariantes de la frontera de operaciones | Cuando cambia de forma incompatible la API de packages/platform/src/calendar-contract.js o la CLI. |
| formatVersion | Envoltura del respaldo JSON | Cuando cambia la estructura del envelope del respaldo. |
| calendarMeta.revision | Estado de un cronograma | Aumenta por una mutación real del documento; no es una release. |
| HOLIDAY_RULESET_VERSION | Reglas legales de festivos | Cambia cuando cambia la tabla o regla legal; se documenta aparte de SemVer. |

Registro histórico: la promoción `v0.13.0-beta.2` → `v0.13.0` fue compatible
con el esquema 4, respaldos, CLI y persistencia local. La promoción de la línea
`0.14.0` conservó ese contrato y cambió la persistencia publicada de la raíz
estable a Supabase; stable y beta mantienen calendarios lógicos separados
dentro del mismo proyecto. Estas versiones no describen el corte actual.

## 7. Canales y publicación independientes

Web se distribuye por GitHub Pages: raíz desde el tag normal `web-v...`
indicado en stable-version.txt; `/beta/` desde main. Supabase se configura
con las variables públicas del workflow. URL/canal/versión visibles se
verifican en un despliegue autorizado; el repositorio no prueba estado remoto.

Una nueva release Web actualiza exclusivamente su manifiesto/WEB_VERSION,
el espejo workspace de package-lock.json, changelog y HTML generado. Tras
aprobar CI e integrar, se etiqueta el commit productor como `web-v<version>`.
`npm run release:web:check` comprueba fuentes y artefactos del tag; no requiere
HEAD igual al tag si sólo cambió infraestructura. Para promover a estable,
se crea la versión sin beta y se cambia el puntero mediante PR; se mantienen
las puertas visuales, responsive y operativas de promoción vigentes.

CLI se distribuye por GitHub Release mediante `cli-v<version>`. Una nueva
release CLI cambia su manifiesto/CLI_VERSION y espejo workspace del lock,
pruebas y documentación pertinentes. Tras CI, aprobación e integración se
etiqueta el commit aceptado. `npm run release:cli:check` exige tag/versión y
HEAD exactos; en Actions valida además ref y SHA. El workflow publica ZIP +
checksum y marca prerelease cuando corresponde. No publica npm.

## 8. Puertas mínimas

`npm run goal:check` incluye `npm run verify` y pruebas CLI/distribución.
`npm run version:check` valida autoridades por producto, Platform interno y
puntero stable. `npm run release:web:check` valida la release Web;
`npm run release:cli:check` valida la release CLI. Los tags se crean sobre
commits aceptados, no se mueven ni se reescriben después de publicar.
CI completa permanece sin optimización por paths porque Platform afecta ambos.

## 9. Corte actual y migración

Workstream 3 completó Architecture V2 e integró versionado, tags y releases
independientes sin cambiar el comportamiento de producto. Estado de canales:
Web estable `0.19.0`, promovida desde la beta certificada `0.19.0-beta.2`, y
beta Web `0.19.1-beta.1` en `main` para certificar una corrección compatible. La
estable `0.19.0` incluye confirmación por generación, protección de salida
interactiva y respaldo manual recuperable ante fallos de persistencia; el reset
no limpia los datos cuando `flushSave()` falla. La beta `0.19.1-beta.1` corrige
el alcance del menú móvil y el costo de conteo de opciones de filtro. La beta
`0.19.0-beta.1` agregó búsqueda temporal en los filtros. CLI `0.18.0-beta.1`,
Platform `0.0.0`, SCHEMA_VERSION 4, CONTRACT_VERSION 1 y backup formatVersion
1. No se cambia Supabase.

`web-v0.17.0`, `web-v0.18.0-beta.2` y `web-v0.18.0` conservan sus commits
históricos. El tag certificado `web-v0.19.0` identifica la release Web estable
actual, y `stable-version.txt` apunta a ese tag. Todos se resuelven con
`git rev-parse <tag>^{commit}`. Web se distribuye por GitHub Pages, sin GitHub
Release; el cambio del puntero se integra mediante un PR normal.

La release CLI `cli-v0.18.0-beta.1` ya está publicada y se conserva intacta.
Los ejemplos anteriores y CHANGELOG conservan historia; CHANGELOG registra la
promoción estable `0.19.0`, su beta certificada `0.19.0-beta.2` y mantiene la
entrada `0.19.0-beta.1` como versión anterior.
