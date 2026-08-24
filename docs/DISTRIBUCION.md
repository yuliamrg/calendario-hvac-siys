# Distribución y GitHub Pages

La política que decide el número de versión está en
VERSIONAMIENTO.md. Este documento define cómo se convierten esas versiones en
artefactos y canales publicados.

Para completar el mapa, consulte [SISTEMA.md](SISTEMA.md),
[MODELO_ESTADOS.md](MODELO_ESTADOS.md) y [BUILD_RELEASE.md](BUILD_RELEASE.md).

## Entregables

Una ejecución exitosa de `npm run build` genera dos archivos idénticos de la
versión de trabajo:

- dist/calendario-hvac-siys.html, listo para copiar y abrir localmente;
- dist/index.html, entrada publicada por GitHub Pages.

Ambos contienen HTML, CSS, JavaScript y SheetJS en un solo archivo. El build
local sin variables cloud conserva IndexedDB; el workflow de Pages inyecta
SIYS_SUPABASE_URL y SIYS_SUPABASE_PUBLISHABLE_KEY para activar Auth y
PostgREST en los canales estable y beta. La clave publishable puede viajar en
el frontend; la service_role y la contraseña de Postgres nunca deben hacerlo.

`dist/` contiene salidas generadas: una diferencia, una versión embebida o un
archivo existente allí no cambia la autoridad de las fuentes. El `HEAD` local
incluye `d27383a`, que regeneró las salidas después de la última frontera de
imports. Eso no certifica que GitHub Pages esté sirviendo esos archivos.

## Canales

| Canal | Fuente publicada | Versión |
|---|---|---|
| Estable, raíz | Tag normal indicado por `stable-version.txt` | La versión del tag, sin prerelease. En el corte local, `v0.15.0`. |
| Beta, /beta/ | `main` | La versión prerelease de `main`. En el corte local, `0.17.0-beta.1`. |
| Local | `dist/calendario-hvac-siys.html` | Artefacto generado; leer la versión visible sólo como verificación del artefacto. |

`stable-version.txt` es un puntero de distribución, no la fuente de la versión
de `main`. En el corte local apunta a `v0.15.0`, mientras la rama de release
declara `0.17.0-beta.1`; esa diferencia es intencional. El puntero y el código local no
demuestran por sí solos que las URLs públicas estén desplegadas o actualizadas.

GitHub Pages no sirve el backend: Supabase proporciona Auth y la base de datos,
mientras Pages sirve el HTML. La raíz estable y el canal beta usan el mismo
proyecto Supabase, pero cada uno apunta a un calendario lógico separado.

Las migraciones de Supabase se aplican desde un entorno autorizado y se
verifican con `migration list --linked` y `db push --linked --dry-run` antes de
publicar. El workflow de Pages sólo construye el frontend: no debe usarse para
suponer que el esquema remoto quedó actualizado. Las migraciones de provisión
son idempotentes y crean un calendario vacío por canal para cada cuenta Auth;
no alteran los documentos JSON existentes.

## Automatización

CI comprueba:

1. la política de versión con npm run version:check;
2. las pruebas de código;
3. la reconstrucción de dist/;
4. que ambos HTML sean autocontenidos e idénticos;
5. la auditoría de red, secretos y artefactos operativos;
6. que no haya diferencias pendientes en dist/.

El workflow de GitHub Pages prepara un artefacto dual:

1. lee stable-version.txt;
2. verifica el tag estable indicado;
3. ejecuta las validaciones sobre la fuente estable;
4. verifica la fuente beta de main;
5. copia la estable a la raíz y main a /beta/.

La ejecución del workflow y la disponibilidad de las URLs deben verificarse por
separado; este documento no afirma un resultado remoto. Los commits locales
pendientes de integración tampoco equivalen a una publicación.

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
8. Crear el tag beta sobre el commit exacto integrado: `v<version>`.
9. Ejecutar `npm run release:check -- --require-current-tag`; esta comprobación
   exige que `v<version>` exista y apunte al commit exacto de `HEAD`.
10. Verificar `/beta/` sólo con un despliegue autorizado y registrar versión,
    canal, persistencia y resultado del smoke test.

Una nueva beta.N conserva la misma base sólo si conserva el mismo alcance. Una
nueva capacidad pública inicia una nueva línea MINOR.

## Promoción de beta a estable

La promoción no consiste en retaggear el commit beta. Se crea una publicación
estable separada:

1. Seleccionar el commit beta aceptado.
2. Crear un commit de promoción que quite `-beta.N` de la versión objetivo en
   package.json, package-lock.json y APP_VERSION.
3. Regenerar dist/ y ejecutar las pruebas de estable.
4. Crear `v<version>` sobre ese commit estable.
5. Actualizar stable-version.txt al tag normal promovido mediante un PR hacia
   main.
6. Esperar Deploy GitHub Pages.
7. Verificar la raíz estable y /beta/.
8. Si el canal beta continúa, iniciar en `main` la siguiente línea MINOR que
   corresponda; si se pausa, documentar la pausa.

El tag estable nunca debe apuntar a un artefacto que todavía muestre una
versión beta.

## Persistencia y respaldos

- Cuando se ejecutan con configuración cloud, GitHub Pages estable y beta tienen
  rutas y calendarios lógicos separados, aunque compartan el proyecto Supabase.
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

El smoke está en `tests/pages_smoke.py` y recibe `--url`, `--beta-url`,
`--local-html` y una carpeta opcional `--artifacts`. Para la promoción también
se deben cubrir Chrome y Edge, los seis viewports responsive y las
comprobaciones de accesibilidad indicadas en `CRITERIOS_DE_DISENO.md`. No se
ejecutó un smoke remoto en esta actualización documental.
