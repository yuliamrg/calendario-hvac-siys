# Distribución y GitHub Pages

## Entregables

`npm run build` genera dos archivos idénticos de la versión de trabajo:

- `dist/calendario-hvac-siys.html`, listo para copiar y abrir localmente.
- `dist/index.html`, entrada publicada por GitHub Pages.

Ambos contienen HTML, CSS, JavaScript y SheetJS en un solo archivo. Los enlaces
a las leyes sólo se abren por decisión del usuario; la aplicación no realiza
solicitudes a servidores ni APIs.

## Persistencia

GitHub Pages no agrega backend. IndexedDB continúa guardando por origen, perfil
y navegador:

- `https://yuliamrg.github.io/calendario-hvac-siys/` tiene una base local.
- `https://yuliamrg.github.io/calendario-hvac-siys/beta/` utiliza una base beta
  diferente.
- `file:///.../calendario-hvac-siys.html` tiene otra base local.
- otro equipo, perfil, Chrome o Edge empieza con otra base.

Recargar o volver a abrir el mismo origen en el mismo perfil conserva los
datos. Borrar datos del sitio los elimina. Para mover información se debe
exportar JSON en el origen anterior y restaurarlo en el nuevo.

Dos pestañas del mismo origen comparten IndexedDB y usan el bloqueo de edición.
Dos equipos no se sincronizan y no deben tratarse como una vista general.

## Automatización

`CI` ejecuta pruebas, reconstrucción, auditoría autocontenida y comprueba que
`dist/` coincide con las fuentes. `Deploy GitHub Pages` construye un artefacto
dual: la raíz se obtiene de la etiqueta indicada en `stable-version.txt` y
`/beta/` se obtiene de `main`. Ambas fuentes se verifican antes del despliegue.

La auditoría falla si detecta:

- marcadores de build sin reemplazar;
- recursos ejecutables externos o APIs de red;
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
7. Actualizar `stable-version.txt` mediante un PR de promoción.
8. Ejecutar el smoke test sobre estable y beta.

El smoke reproducible está en `tests/pages_smoke.py` y recibe `--url`,
`--beta-url`, `--local-html` y una carpeta opcional `--artifacts`.
