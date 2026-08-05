# Política de versionamiento y releases

## Propósito

SIYS Sync usa Semantic Versioning 2.0.0, con una política más estricta para el
periodo 0.x porque la aplicación maneja cronogramas operativos, respaldos JSON,
una CLI y un contrato de operaciones compartido.

La versión comunica el alcance del producto publicado. No se usa para contar
commits ni para sustituir la revisión operativa de un documento.

## 1. Fuentes de versión y artefactos

### Fuentes autoritativas

- **package.json > version**: identificador de la release de código y de la
  CLI.
- **src/core.js > APP_VERSION**: versión que aparece en la interfaz y que se
  guarda en los respaldos nuevos.

Estas dos fuentes deben tener exactamente el mismo valor.

### Espejos y punteros

- **package-lock.json**: espejo generado por npm. Sus dos versiones raíz deben
  coincidir con package.json; no es una decisión independiente.
- **stable-version.txt**: puntero al tag estable que publica la raíz de
  GitHub Pages. No tiene que coincidir con la versión beta que está en main.
- **dist/index.html** y **dist/calendario-hvac-siys.html**: salidas generadas
  por npm run build. No se editan manualmente.
- **Tags Git**: identifican releases inmutables y usan el formato
  v<version>, por ejemplo v0.14.0-beta.1 o v0.14.0.

La validación automatizada está disponible con:

~~~text
npm run version:check
~~~

## 2. Regla base de Semantic Versioning

Una versión normal tiene la forma MAJOR.MINOR.PATCH.

Durante 0.x se adopta esta matriz:

| Tipo de cambio | Versión | Criterio |
|---|---|---|
| Nueva capacidad pública compatible | 0.MINOR.PATCH con MINOR + 1 y PATCH = 0 | Añade una función visible, una operación CLI compatible o un flujo operativo nuevo. |
| Corrección compatible | 0.MINOR.PATCH con PATCH + 1 | Corrige un defecto sin añadir una capacidad ni cambiar un contrato público. |
| Iteración de una prerelease | Misma base y beta + 1 | Ajusta, corrige o valida el alcance ya anunciado de la misma release. |
| Cambio incompatible durante 0.x | Nueva línea 0.MINOR.0 | Requiere migración, cambia un contrato o rompe el flujo; debe documentarse como incompatible aunque todavía no sea 1.0.0. |
| Primer contrato estable | 1.0.0 | Se declara estable la API, el formato de respaldo, la CLI y las reglas de compatibilidad. |
| Cambio incompatible después de 1.0.0 | MAJOR + 1 | Rompe el contrato público estable. |

Ejemplos:

~~~text
0.13.0                  -> 0.14.0       nueva capacidad compatible
0.13.0                  -> 0.13.1       corrección compatible
0.13.0-beta.1           -> beta.2       iteración de la misma release
0.13.0-beta.2           -> 0.13.0      promoción estable
0.13.0                  -> 1.0.0        primer contrato estable, si procede
~~~

La expresión “incrementar 0.1.0” significa incrementar el componente MINOR:
desde 0.13.0 se obtiene 0.14.0. “Incrementar 0.0.1” significa incrementar
PATCH: desde 0.13.0 se obtiene 0.13.1.

No se incrementa MINOR sólo porque haya una nueva compilación. Tampoco se
incrementa PATCH para esconder una nueva capacidad pública.

## 3. Cómo se decide si una beta inicia una nueva línea

Antes de cambiar el número se redacta el alcance de la próxima release:

- Si el cambio pertenece al alcance ya anunciado, se conserva la base y se
  incrementa beta: 0.14.0-beta.1, 0.14.0-beta.2, 0.14.0-beta.3.
- Si aparece una capacidad pública independiente, se cierra la línea actual y
  se inicia la siguiente: 0.15.0-beta.1.
- Un ajuste de etiqueta, estilo, accesibilidad o interacción sólo usa beta + 1
  si no introduce una capacidad operativa independiente.
- Si el cambio altera esquema, contrato CLI, formato de respaldo o flujo
  operativo de forma incompatible, se inicia una nueva línea MINOR y se
  documenta la migración.

La decisión se registra en CHANGELOG.md y en el PR. Si existe duda entre
iteración y nueva capacidad, se elige la nueva línea; no se rebautiza una
versión ya publicada.

## 4. Prereleases y promoción

Una beta tiene una versión base normal seguida de -beta.N:

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
siguiente capacidad independiente será 0.15.0-beta.1; una corrección posterior
a la estable será 0.14.1 o 0.14.1-beta.1 si se prueba primero como beta.

## 5. Versiones que no son la versión de la aplicación

| Identificador | Qué versiona | Cuándo aumenta |
|---|---|---|
| APP_VERSION | Release de la aplicación | Cada publicación beta o estable. |
| SCHEMA_VERSION | Formato persistido del calendario | Cuando cambia el formato o las reglas necesarias para leer/escribir documentos; debe existir migración o bloqueo explícito. |
| CONTRACT_VERSION | Respuesta e invariantes de la frontera de operaciones | Cuando cambia de forma incompatible la API de src/calendar-contract.js o la CLI. |
| formatVersion | Envoltura del respaldo JSON | Cuando cambia la estructura del envelope del respaldo. |
| calendarMeta.revision | Estado de un cronograma | Aumenta por una mutación real del documento; no es una release. |
| HOLIDAY_RULESET_VERSION | Reglas legales de festivos | Cambia cuando cambia la tabla o regla legal; se documenta aparte de SemVer. |

La promoción `v0.13.0-beta.2` → `v0.13.0` fue compatible con el esquema 4,
respaldos, CLI y persistencia local. La promoción de la línea `0.14.0` conserva
ese contrato y cambia la persistencia publicada de la raíz estable a Supabase;
stable y beta mantienen calendarios lógicos separados dentro del mismo proyecto.

## 6. Canales de distribución

- La raíz de GitHub Pages usa el tag indicado por stable-version.txt.
- /beta/ usa la versión de main y debe mostrar la versión prerelease y la
  insignia BETA.
- El hecho de que package.json en main diga una beta no cambia la versión
  estable de la raíz.
- Supabase se activa en estable y beta cuando Pages inyecta la configuración
  pública; el archivo local conserva IndexedDB sin autenticación.
- Los respaldos se validan por URL, canal, versión visible, appVersion,
  schemaVersion, revision y perfil de navegador antes de restaurarse.

## 7. Flujo de publicación beta

1. Clasificar el cambio con la matriz de la sección 2 y redactar su alcance.
2. Elegir la versión objetivo. Una nueva línea comienza en beta.1.
3. Actualizar package.json, package-lock.json y APP_VERSION.
4. Actualizar CHANGELOG.md, documentación y pruebas que describan el contrato.
5. Ejecutar npm run goal:check y las pruebas de navegador requeridas. goal:check
   incluye build, version:check, auditoría, pruebas de código y pruebas de CLI.
6. Revisar git diff --check, git status y que dist/ sólo sea salida generada.
7. Abrir un PR hacia main con el alcance, la versión y las evidencias.
8. Esperar CI, integrar el PR y crear el tag beta sobre el commit exacto
   integrado: v<version>.
9. Ejecutar npm run release:check -- --require-current-tag, probar /beta/ en
   línea y registrar la versión visible, el canal y el resultado de las
   pruebas.
10. Para una nueva iteración del mismo alcance, repetir desde el paso 2 con
    beta.N + 1. Para una nueva capacidad, iniciar otra base MINOR.

## 8. Flujo de promoción a estable

La promoción es una publicación separada de la beta:

1. Seleccionar el commit beta aceptado y congelar su alcance.
2. Crear un commit de promoción con la versión normal, sin sufijo beta, en
   package.json, package-lock.json y APP_VERSION.
3. Regenerar dist/ y ejecutar todas las validaciones de estable.
4. Crear el tag estable sobre ese commit: v0.14.0.
5. Actualizar stable-version.txt al tag normal promovido mediante un PR hacia
   main.
6. Esperar el despliegue y verificar la raíz estable y /beta/.
7. Si el canal beta continúa, iniciar en main la siguiente línea MINOR
   correspondiente. Para este repositorio, después de v0.14.0 es
   0.15.0-beta.1. Si no continúa, documentar explícitamente la pausa.

El tag estable no debe apuntar a un commit cuyo APP_VERSION aún tenga
el sufijo beta.

## 9. Puertas mínimas

Para cualquier publicación:

- package.json, package-lock.json y APP_VERSION coinciden;
- stable-version.txt tiene un tag normal vMAJOR.MINOR.PATCH;
- npm run version:check pasa;
- npm run verify pasa;
- dist/ es autocontenido, idéntico en sus dos archivos y proviene del build;
- CI pasa y el PR conserva trazabilidad;
- el tag apunta al commit de la versión publicada.

Para promover a estable, además:

- se pasan las pruebas de navegador en estable y beta;
- se prueban los seis viewports responsive;
- se revisan accesibilidad, contraste, teclado, claro, oscuro, impresión y
  exportación PNG cuando corresponda;
- se compara explícitamente contra la estable vigente;
- se documenta la decisión de promoción y la compatibilidad de esquema,
  respaldos, CLI y persistencia.

## 10. Estado de transición de este repositorio

- La estable vigente es v0.13.0 hasta completar la promoción de la línea 0.14.0.
- La beta publicada vigente en esta línea es 0.14.0-beta.2.
- 0.12.0-beta.1 y 0.13.0-beta.1 forman parte del historial beta y no fueron
  promovidas a estable.
- El repositorio conserva evidencia de 0.13.0-beta.1, pero debe verificarse
  por separado si se requiere crear retrospectivamente su tag. No se crea un
  tag histórico sin comprobar que el commit corresponde exactamente al
  artefacto que se publicó.

Esta política sustituye las frases anteriores que hacían coincidir
package.json con la versión estable incluso cuando main estaba en beta.
