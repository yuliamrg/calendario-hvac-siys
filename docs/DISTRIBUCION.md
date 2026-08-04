# Distribución y GitHub Pages

## Entregables

`npm run build` genera dos archivos idénticos de la versión de trabajo:

- `dist/calendario-hvac-siys.html`, listo para copiar y abrir localmente.
- `dist/index.html`, entrada publicada por GitHub Pages.

Ambos contienen HTML, CSS, JavaScript y SheetJS en un solo archivo. El build
local sin variables cloud conserva el modo IndexedDB; el workflow de Pages
inyecta `SIYS_SUPABASE_URL` y `SIYS_SUPABASE_PUBLISHABLE_KEY` para activar Auth
y PostgREST. La clave `publishable` puede viajar en el frontend; la
`service_role` y la contraseña de Postgres nunca deben hacerlo.

## Persistencia

GitHub Pages no sirve el backend: Supabase proporciona Auth y la base de datos,
mientras Pages o el VPS sirve el HTML. El archivo local mantiene IndexedDB por
origen, perfil y navegador. La publicación cloud guarda en Supabase:

- `https://yuliamrg.github.io/calendario-hvac-siys/` conserva el calendario local
  de la versión estable `v0.11.0`.
- `https://yuliamrg.github.io/calendario-hvac-siys/beta/` usa el calendario cloud
  beta del mismo proyecto.
- `file:///.../calendario-hvac-siys.html` tiene otra base local.
- sin una cuenta de Supabase no se puede abrir el calendario cloud.

La cuenta de Supabase permite abrir el mismo calendario desde otro equipo.
Para migrar datos locales se debe exportar JSON en el origen anterior y
restaurarlo en el nuevo. Las copias siguen siendo necesarias para recuperación
operativa.

Dos pestañas del mismo origen comparten IndexedDB y usan el bloqueo de edición.
Dos equipos no se sincronizan y no deben tratarse como una vista general.

## Automatización

`CI` ejecuta pruebas, reconstrucción, auditoría autocontenida y comprueba que
`dist/` coincide con las fuentes. `Deploy GitHub Pages` construye un artefacto
dual: la raíz se obtiene de la etiqueta indicada en `stable-version.txt` y
`/beta/` se obtiene de `main`. Ambas fuentes se verifican antes del despliegue.

La auditoría falla si detecta:

- marcadores de build sin reemplazar;
- recursos ejecutables externos o una API de red fuera del adaptador Supabase;
- diferencias entre los dos HTML;
- archivos QA, copias de la Base Operativa, XLSX, CSV, PNG o respaldos
  versionados;
- patrones de token de GitHub dentro del HTML.

## Publicación manual de una versión

1. Trabajar en una rama `feat/fase-*`.
2. Ejecutar `npm run verify` y la prueba de navegador.
3. Revisar `git diff --check` y `git status`.
4. Abrir y aprobar el PR hacia `main`.
5. Esperar CI y probar `/beta/`.
6. Crear la etiqueta de la versión aceptada.
7. Crear la etiqueta estable aceptada y actualizar `stable-version.txt` mediante
   un PR de promoción.
8. Ejecutar el smoke test sobre estable y beta.

El smoke reproducible está en `tests/pages_smoke.py` y recibe `--url`,
`--beta-url`, `--local-html` y una carpeta opcional `--artifacts`.
