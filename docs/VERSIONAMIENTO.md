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

### Fuentes autoritativas

- **package.json > version**: identificador de la release de código y de la
  CLI; es la fuente de versión de la línea que se desarrolla en `main`.
- **src/core.js > APP_VERSION**: versión que aparece en la interfaz y que se
  guarda en los respaldos nuevos; es la fuente de versión que consume el
  runtime.

Estas dos fuentes deben tener exactamente el mismo valor.

### Espejos y punteros

- **package-lock.json**: espejo generado por npm. Sus dos versiones raíz deben
  coincidir con package.json; no es una decisión independiente.
- **stable-version.txt**: puntero que el workflow usa para seleccionar el tag
  estable de la raíz de GitHub Pages. No es la versión de `main` y no tiene que
  coincidir con la beta en desarrollo.
- **dist/index.html** y **dist/calendario-hvac-siys.html**: salidas generadas
  por `npm run build`. Pueden contener una copia embebida de `APP_VERSION`, pero
  no son fuente ni autoridad; no se editan manualmente.
- **Tags Git**: identifican releases inmutables y usan el formato
  v<version>, por ejemplo v0.14.0-beta.1 o v0.14.0.

La validación automatizada está disponible con:

~~~text
npm run version:check
~~~

En el corte local comprobado el 2026-08-23, la rama de release declara
`0.17.0-beta.1` en `package.json` y `src/core.js`, los dos valores de versión
de `package-lock.json` coinciden y `stable-version.txt` contiene `v0.15.0`. Es
un estado del repositorio local: no certifica qué HTML está sirviendo
actualmente GitHub Pages.

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

Para este corte, los cambios posteriores a `0.16.0-beta.2` agregan capacidades
públicas de presentación/exportación y fronteras operativas nuevas. Por eso se
abre `0.17.0-beta.1`; no se usa `0.16.0-beta.3`. El esquema persistido y el
contrato se mantienen en 4 y 1, respectivamente, por lo que no se trata de una
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
`build:`, `ci:`, `refactor:` o `fix:`. No se incrementa `APP_VERSION` por el
mero hecho de crear un commit ni se edita `dist/` manualmente.

Un commit de release es distinto: actualiza de forma coordinada
`package.json`, `package-lock.json`, `src/core.js`, `CHANGELOG.md` y los
artefactos requeridos, ejecuta los gates y recibe el tag `v<version>` después
de integrar el PR. Un cambio documental que acompaña una versión pendiente se
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
| APP_VERSION | Release de la aplicación | Cada publicación beta o estable. |
| SCHEMA_VERSION | Formato persistido del calendario | Cuando cambia el formato o las reglas necesarias para leer/escribir documentos; debe existir migración o bloqueo explícito. |
| CONTRACT_VERSION | Respuesta e invariantes de la frontera de operaciones | Cuando cambia de forma incompatible la API de src/calendar-contract.js o la CLI. |
| formatVersion | Envoltura del respaldo JSON | Cuando cambia la estructura del envelope del respaldo. |
| calendarMeta.revision | Estado de un cronograma | Aumenta por una mutación real del documento; no es una release. |
| HOLIDAY_RULESET_VERSION | Reglas legales de festivos | Cambia cuando cambia la tabla o regla legal; se documenta aparte de SemVer. |

Registro histórico: la promoción `v0.13.0-beta.2` → `v0.13.0` fue compatible
con el esquema 4, respaldos, CLI y persistencia local. La promoción de la línea
`0.14.0` conservó ese contrato y cambió la persistencia publicada de la raíz
estable a Supabase; stable y beta mantienen calendarios lógicos separados
dentro del mismo proyecto. Estas versiones no describen el corte actual.

## 7. Canales de distribución

- La raíz de GitHub Pages usa el tag indicado por stable-version.txt.
- /beta/ usa la versión de main y debe mostrar la versión prerelease y la
  insignia BETA.
- El hecho de que package.json en main diga una beta no cambia la versión
  estable de la raíz.
- Supabase se activa en estable y beta cuando Pages inyecta la configuración
  pública; el archivo local conserva IndexedDB sin autenticación.
- Los respaldos se validan por URL, canal, versión visible, appVersion,
  schemaVersion, revision y perfil de navegador antes de restaurarse.

Las rutas públicas documentadas son referencias de configuración. Sólo una
verificación explícita de Pages y del smoke autenticado puede demostrar un
despliegue o un resultado remoto; la coincidencia de versiones en el repositorio
no lo demuestra.

## 8. Flujo de publicación beta

1. Clasificar el cambio con la matriz de la sección 2 y redactar su alcance.
2. Elegir la versión objetivo. Una nueva línea comienza en beta.1.
3. Actualizar package.json, package-lock.json y APP_VERSION.
4. Actualizar CHANGELOG.md, documentación y pruebas que describan el contrato.
5. Ejecutar npm run goal:check y las pruebas de navegador requeridas. goal:check
   incluye build, version:check, auditoría, pruebas de código y pruebas de CLI.
6. Revisar git diff --check, git status y que dist/ sólo sea salida generada.
7. Abrir un PR hacia main con el alcance, la versión y las evidencias.
8. Esperar CI, integrar el PR y crear el tag beta sobre el commit exacto
   integrado: v<version>. El tag se crea después de integrar, nunca sobre una
   rama o commit distinto del que CI aprobó.
9. Ejecutar `npm run release:check -- --require-current-tag`. Esta variante
   resuelve el commit de `v<version>` y lo compara con `HEAD`; no basta con que
   el tag exista. Probar `/beta/`
   sólo cuando exista un despliegue autorizado y registrar la versión visible,
   el canal y el resultado de las pruebas; no inferirlo desde el tag o `dist/`.
10. Para otra beta de la misma versión normal, repetir desde el paso 2 con
    beta.N + 1. Si el contenido de la siguiente release requiere otra versión
    normal según la sección 2, iniciar beta.1 de esa nueva base.

## 9. Flujo de promoción a estable

La promoción es una publicación separada de la beta:

1. Seleccionar el commit beta aceptado y congelar su alcance.
2. Crear un commit de promoción con la versión normal, sin sufijo beta, en
   package.json, package-lock.json y APP_VERSION.
3. Regenerar dist/ y ejecutar todas las validaciones de estable.
4. Crear el tag estable sobre ese commit: `v<version>` sin prerelease.
5. Actualizar stable-version.txt al tag normal promovido mediante un PR hacia
   main.
6. Esperar el despliegue y verificar la raíz estable y /beta/.
7. Si el canal beta continúa, iniciar en `main` la siguiente línea MINOR que
   corresponda a su alcance. Si se pausa, documentar explícitamente la pausa.

El tag estable no debe apuntar a un commit cuyo APP_VERSION aún tenga
el sufijo beta.

## 10. Puertas mínimas

Para cualquier publicación:

- package.json, package-lock.json y APP_VERSION coinciden;
- stable-version.txt tiene un tag normal vMAJOR.MINOR.PATCH;
- npm run version:check pasa;
- npm run verify pasa;
- dist/ es autocontenido, idéntico en sus dos archivos y proviene del build;
- CI pasa y el PR conserva trazabilidad;
- el tag apunta al commit exacto de la versión publicada, comprobado con
  `npm run release:check -- --require-current-tag`.

Para promover a estable, además:

- se pasan las pruebas de navegador en estable y beta;
- se prueban los seis viewports responsive;
- se revisan accesibilidad, contraste, teclado, claro, oscuro, impresión y
  exportación PNG cuando corresponda;
- se compara explícitamente contra la estable vigente;
- se documenta la decisión de promoción y la compatibilidad de esquema,
  respaldos, CLI y persistencia.

## 11. Corte local actual e historial

En el corte local comprobado el 2026-08-23:

- la rama de release contiene la línea `0.17.0-beta.1` en `package.json` y
  `APP_VERSION`, derivada del `main` local con los commits pendientes de PR;
- `package-lock.json` conserva esa misma versión en su raíz y en
  `packages[""]`.
- `stable-version.txt` selecciona `v0.15.0` como tag normal para la fuente
  estable del workflow.
- `CHANGELOG.md` registra `0.17.0-beta.1` como la nueva línea beta y mantiene
  `0.15.0` como promoción estable; esto es evidencia local del repositorio, no
  confirmación de que Pages esté sirviendo esas rutas.

Las versiones `0.14.0`, `0.14.1`, `0.15.0-beta.3` y las demás que aparecen en
los ejemplos o en el changelog se conservan como historial. No deben leerse
como la versión estable o beta actual. Esta separación evita confundir la
versión de `main`, el puntero stable y los HTML generados en `dist/`.
