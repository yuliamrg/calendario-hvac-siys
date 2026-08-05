# Distribución y GitHub Pages

La política que decide el número de versión está en
VERSIONAMIENTO.md. Este documento define cómo se convierten esas versiones en
artefactos y canales publicados.

## Entregables

npm run build genera dos archivos idénticos de la versión de trabajo:

- dist/calendario-hvac-siys.html, listo para copiar y abrir localmente;
- dist/index.html, entrada publicada por GitHub Pages.

Ambos contienen HTML, CSS, JavaScript y SheetJS en un solo archivo. El build
local sin variables cloud conserva IndexedDB; el workflow de Pages inyecta
SIYS_SUPABASE_URL y SIYS_SUPABASE_PUBLISHABLE_KEY para activar Auth y
PostgREST en los canales estable y beta. La clave publishable puede viajar en
el frontend; la service_role y la contraseña de Postgres nunca deben hacerlo.

## Canales

| Canal | Fuente publicada | Versión |
|---|---|---|
| Estable, raíz | Tag normal indicado por stable-version.txt | La versión del tag, sin prerelease. |
| Beta, /beta/ | main | La versión prerelease de main, por ejemplo 0.14.0-beta.1. |
| Local | dist/calendario-hvac-siys.html | Leer la versión visible del archivo. |

stable-version.txt es un puntero de distribución, no la fuente de la versión
de main. Después de esta promoción apunta a v0.14.1; cuando se inicie la
siguiente línea beta, main tendrá una prerelease distinta mientras la raíz
estable seguirá usando ese tag normal.

GitHub Pages no sirve el backend: Supabase proporciona Auth y la base de datos,
mientras Pages sirve el HTML. La raíz estable y el canal beta usan el mismo
proyecto Supabase, pero cada uno apunta a un calendario lógico separado.

## Automatización

CI comprueba:

1. la política de versión con npm run version:check;
2. las pruebas de código;
3. la reconstrucción de dist/;
4. que ambos HTML sean autocontenidos e idénticos;
5. la auditoría de red, secretos y artefactos operativos;
6. que no haya diferencias pendientes en dist/.

Deploy GitHub Pages crea un artefacto dual:

1. lee stable-version.txt;
2. verifica el tag estable indicado;
3. ejecuta las validaciones sobre la fuente estable;
4. verifica la fuente beta de main;
5. copia la estable a la raíz y main a /beta/.

## Publicación de una beta

1. Clasificar el cambio y elegir la versión según VERSIONAMIENTO.md.
2. Actualizar package.json, package-lock.json y APP_VERSION.
3. Actualizar CHANGELOG.md, documentación y pruebas del contrato.
4. Ejecutar:

~~~text
npm run goal:check
~~~

5. Ejecutar el smoke test de navegador requerido y revisar
   git diff --check y git status.
6. Abrir un PR hacia main con el alcance, la versión y la evidencia.
7. Esperar CI e integrar el PR.
8. Crear el tag beta sobre el commit exacto integrado:
   v0.14.0-beta.1, v0.14.0-beta.2, etc.
9. Ejecutar npm run release:check -- --require-current-tag.
10. Verificar /beta/ en línea y registrar versión, canal, persistencia y
    resultado del smoke test.

Una nueva beta.N conserva la misma base sólo si conserva el mismo alcance. Una
nueva capacidad pública inicia una nueva línea MINOR.

## Promoción de beta a estable

La promoción no consiste en retaggear el commit beta. Se crea una publicación
estable separada:

1. Seleccionar el commit beta aceptado.
2. Crear un commit de promoción que cambie la versión de
   0.14.0-beta.N a 0.14.0 en package.json, package-lock.json y APP_VERSION.
3. Regenerar dist/ y ejecutar las pruebas de estable.
4. Crear v0.14.0 sobre ese commit estable.
5. Actualizar stable-version.txt al tag normal promovido mediante un PR hacia
   main.
6. Esperar Deploy GitHub Pages.
7. Verificar la raíz estable y /beta/.
8. Si el canal beta continúa, iniciar en main la siguiente línea MINOR
   correspondiente; en este repositorio es 0.15.0-beta.1. Si se pausa,
   documentar la pausa.

El tag estable nunca debe apuntar a un artefacto que todavía muestre una
versión beta.

## Persistencia y respaldos

- GitHub Pages estable y beta tienen rutas y calendarios lógicos separados,
  aunque compartan el proyecto Supabase.
- La sesión Auth se comparte entre ambos canales del mismo origen y las
  revisiones cloud son independientes por calendario; una cuenta con membresía
  puede abrir el canal correspondiente desde otro equipo.
- La stable hace una única lectura de su IndexedDB heredado. Sólo copia el
  documento si el calendario cloud está vacío; conserva el origen local y no
  repite la copia después de un reinicio cloud intencional.
- El archivo local continúa separado en IndexedDB y no se sincroniza solo con
  Supabase.
- Antes de restaurar un respaldo se comprueban URL, canal, versión visible,
  appVersion, schemaVersion, revision y perfil del navegador.
- No se sube un respaldo beta a estable ni uno estable a beta sin una
  migración autorizada y verificada.

## Smoke reproducible

El smoke está en tests/pages_smoke.py y recibe --url, --beta-url, --local-html y
una carpeta opcional --artifacts. Para la promoción también se deben cubrir
Chrome y Edge, los seis viewports responsive y las comprobaciones de
accesibilidad indicadas en CRITERIOS_DE_DISENO.md.
