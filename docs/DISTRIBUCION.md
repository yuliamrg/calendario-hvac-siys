# Distribución y GitHub Pages

## Entregables

`npm run build` genera dos archivos idénticos:

- `dist/calendario-hvac-siys.html`, listo para copiar y abrir localmente.
- `dist/index.html`, entrada publicada por GitHub Pages.

Ambos contienen HTML, CSS, JavaScript y SheetJS en un solo archivo. Los enlaces
a las leyes sólo se abren por decisión del usuario; la aplicación no realiza
solicitudes a servidores ni APIs.

## Persistencia

GitHub Pages no agrega backend. IndexedDB continúa guardando por origen, perfil
y navegador:

- `https://yuliamrg.github.io/calendario-hvac-siys/` tiene una base local.
- `file:///.../calendario-hvac-siys.html` tiene otra base local.
- otro equipo, perfil, Chrome o Edge empieza con otra base.

Recargar o volver a abrir el mismo origen en el mismo perfil conserva los
datos. Borrar datos del sitio los elimina. Para mover información se debe
exportar JSON en el origen anterior y restaurarlo en el nuevo.

Dos pestañas del mismo origen comparten IndexedDB y usan el bloqueo de edición.
Dos equipos no se sincronizan y no deben tratarse como una vista general.

## Automatización

`CI` ejecuta pruebas, reconstrucción, auditoría autocontenida y comprueba que
`dist/` coincide con las fuentes. `Deploy GitHub Pages` sólo se ejecuta desde
`main`, vuelve a validar y despliega `dist/` mediante el mecanismo oficial de
GitHub Pages.

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
5. Esperar CI y despliegue Pages.
6. Ejecutar el smoke test sobre la URL de producción.
7. Crear la etiqueta de versión únicamente después del smoke de producción.

El smoke reproducible está en `tests/pages_smoke.py` y recibe `--url`,
`--local-html` y una carpeta opcional `--artifacts`.
