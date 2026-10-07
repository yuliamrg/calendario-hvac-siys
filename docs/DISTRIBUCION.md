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

`dist/` es salida generada, no autoridad de versión. Web usa
`apps/web/package.json` + `WEB_VERSION`; CLI usa `apps/cli/package.json` +
`CLI_VERSION`. La raíz privada no posee versión de producto.

## Canales

| Producto/canal | Fuente | Distribución |
| --- | --- | --- |
| Web stable publicada | `stable-version.txt = web-v0.19.1`, versión `0.19.1` | Raíz GitHub Pages |
| Web beta | main, `0.19.1` hasta que empiece otra línea beta | `/beta/` GitHub Pages |
| Web local | Build HTML | Archivo autocontenido |
| Calendary CLI | `cli-v<version>`, publicada `0.18.0-beta.1` | GitHub Release ZIP + SHA-256 |
| Platform | `packages/platform`, `0.0.0` privado | Interno, sin tags/releases propios |

Web usa tags `web-v...`; CLI usa `cli-v...`. Los tags `v...` son historial
inmutable. `web-v0.17.0`, `web-v0.18.0-beta.2` y `web-v0.18.0` conservan
exactamente sus commits históricos. `web-v0.19.0` conserva su commit histórico;
el tag certificado `web-v0.19.1` identifica la release Web estable actual y
`stable-version.txt` selecciona el tag que Pages publica en la raíz.
El puntero no altera el contenido del tag. Los tags por sí solos no disparan
Pages ni GitHub Releases; el merge del cambio de puntero a `main` dispara Pages.

## Instalar Calendary CLI

Descargue `calendary-cli-0.18.0-beta.1.zip` y su checksum desde GitHub Releases,
verifique SHA-256 y extraiga. Con Node.js >=20, desde la carpeta extraída:

```powershell
node bin/calendary.js --version
node bin/calendary.js --help
```

El ZIP incluye CLI y `node_modules/@siys-sync/platform` desde el runtime
compartido original. No requiere clonar ni npm install; no incluye Web,
migraciones ni configuración Supabase. Use las variables públicas existentes
y cloud login. Consulte [CLI](CLI.md). La primera publicación se realizó con
`cli-v0.18.0-beta.1` y se conserva sin cambios en la promoción de Web
`0.18.1`. No se publica npm: el ZIP satisface el canal requerido sin registro
ni auth npm.

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
2. Actualizar apps/web/package.json, el espejo workspace del lock y WEB_VERSION.
3. Actualizar CHANGELOG.md, documentación y pruebas del contrato.
4. Ejecutar:

~~~text
npm run goal:check
~~~

5. Ejecutar el smoke test de navegador requerido y revisar
   git diff --check y git status.
6. Abrir un PR hacia main con el alcance, la versión y la evidencia.
7. Esperar CI e integrar el PR.
8. Crear el tag beta sobre el commit exacto integrado: `web-v<version>`.
9. Ejecutar `npm run release:web:check`; esta comprobación
   valida fuentes y artefactos del tag, sin exigir igualdad con HEAD posterior.
10. Verificar `/beta/` sólo con un despliegue autorizado y registrar versión,
    canal, persistencia y resultado del smoke test.

Una nueva beta.N conserva la misma base sólo si conserva el mismo alcance. Una
nueva capacidad pública inicia una nueva línea MINOR.

## Promoción de beta a estable

La promoción no consiste en retaggear el commit beta. Se crea una publicación
estable separada:

1. Seleccionar el commit beta aceptado.
2. Crear un commit de promoción que quite `-beta.N` de la versión objetivo en
   apps/web/package.json, el espejo workspace del lock y WEB_VERSION.
3. Regenerar dist/ y ejecutar las pruebas de estable.
4. Crear `web-v<version>` sobre ese commit estable.
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

El smoke público de `tests/pages_smoke.py` es de sólo lectura. Comprueba la
carga HTTP, versión y canal, configuración cloud y el endpoint GET de salud de
Auth. Usa un contexto nuevo sin sesión, no abre ni descarga calendarios y
reporta `PUBLIC_APP_HEALTHY` con readiness `AUTHENTICATION_REQUIRED` cuando la
interfaz espera inicio de sesión. Sólo permite el origen de Pages y el origen
Supabase anunciado por la configuración; bloquea destinos inesperados y todo
método HTTP distinto de GET, HEAD u OPTIONS.

```powershell
$playwrightPython = if ($env:PLAYWRIGHT_PYTHON) { $env:PLAYWRIGHT_PYTHON } else { Join-Path $env:USERPROFILE 'conda-envs\skill-playwright-cli-py312\python.exe' }
& $playwrightPython tests/pages_smoke.py `
  --url 'https://yuliamrg.github.io/calendario-hvac-siys/' `
  --beta-url 'https://yuliamrg.github.io/calendario-hvac-siys/beta/' `
  --stable-version 0.19.1 --beta-version 0.19.1
```

Las pruebas que crean o editan actividades se ejecutan únicamente sobre una
copia temporal del HTML local con Supabase desactivado. La guarda compartida
de navegador bloquea solicitudes HTTP(S) inesperadas y cualquier mutación; la
suite Node también bloquea `fetch` externo. Las regresiones no deben usar IDs
de calendarios operativos ni leer o escribir calendarios compartidos.

```powershell
& $playwrightPython tests/filter_option_search_browser.py --html dist/index.html
& $playwrightPython tests/responsive_smoke.py --html dist/index.html
& $playwrightPython tests/quarantine_browser_smoke.py --html dist/index.html
& $playwrightPython tests/browser_save_durability.py
```

`tests/browser_smoke.py` requiere además `--base` con un libro sintético local.
Para una promoción también se cubren Chrome y Edge, los viewports responsive y
las comprobaciones de accesibilidad de `CRITERIOS_DE_DISENO.md`.

## Workflow CLI independiente

`cli-release.yml` sólo responde a tags `cli-v*`, valida ref/versión exactos,
prueba CLI/shared y el paquete autónomo, crea ZIP y checksum y publica con gh.
Las betas se marcan prerelease. La CI de PR valida todo el repositorio sin
path filters. Platform no tiene workflow de release.
