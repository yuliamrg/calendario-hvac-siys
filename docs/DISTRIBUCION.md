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

1. Clasificar el cambio: parche (`0.10.1`), hito (`0.11.0`) o primera
   estabilidad (`1.0.0`). La clasificación depende del impacto, no del tamaño
   del diff.
2. Si requiere validación beta, usar la base elegida con prerelease:
   `0.10.1-beta.1`, `0.11.0-beta.1` o `1.0.0-beta.1`.
3. Actualizar `package.json`, `package-lock.json` y `src/core.js`; ejecutar
   `npm run build` para regenerar `dist/`.
4. Ejecutar `npm run verify`, la prueba de navegador y revisar
   `git diff --check`.
5. Abrir el PR hacia `main`, esperar CI y probar `/beta/`.
6. Para otra iteración del mismo objetivo, incrementar sólo `beta.n`.
7. Cuando la beta sea aceptada, cambiar `X.Y.Z-beta.n` a `X.Y.Z`, verificar y
   crear la etiqueta inmutable `vX.Y.Z` sobre el commit aprobado.
8. Actualizar `stable-version.txt` a `vX.Y.Z` mediante un PR de promoción y
   volver a ejecutar el smoke test sobre raíz estable y `/beta/`.

Fusionar una beta a `main` sólo publica la línea beta. La raíz de Pages cambia
únicamente cuando `stable-version.txt` apunta a una etiqueta nueva.

El smoke reproducible está en `tests/pages_smoke.py` y recibe `--url`,
`--beta-url`, `--local-html` y una carpeta opcional `--artifacts`.
