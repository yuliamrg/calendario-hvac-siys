# Flujo de GitHub Pages y beta

## Regla principal

GitHub Pages no publica cada rama. En este repositorio, la rama `main` es la
única referencia autorizada para desplegar el entorno `github-pages`.

Por tanto, una rama de trabajo como `agent/...` o `feat/...` sólo existe para
desarrollo, pruebas locales y revisión de PR. Sus archivos no aparecen en
Pages hasta que el PR se fusiona a `main`.

## Qué publica el workflow

`.github/workflows/pages.yml` construye un sitio dual:

| URL | Fuente | Qué significa |
|---|---|---|
| `/` | etiqueta indicada por `stable-version.txt` | versión estable inmutable |
| `/beta/` | `main` en el commit que dispara el workflow | línea beta publicada |

En cada ejecución se verifican ambas fuentes. La estable se obtiene haciendo
checkout de la etiqueta `vX.Y.Z` indicada por `stable-version.txt`; la beta se
obtiene del checkout normal del evento, que en el flujo autorizado es `main`.

El workflow se dispara automáticamente cuando hay un `push` a `main`. También
permite `workflow_dispatch`, pero ejecutar manualmente una referencia de rama
no convierte esa rama en una preview publicada: la protección del entorno
`github-pages` sólo permite desplegar desde `main`.

## Flujo correcto para una beta

```text
rama de trabajo
      │
      ├─ pruebas locales y npm run verify
      │
      └─ PR a main
             │
             ├─ CI aprobado
             │
             └─ merge a main
                    │
                    └─ Deploy GitHub Pages
                           └─ /beta/ se actualiza
```

Pasos:

1. Crear o continuar una rama de trabajo.
2. Elegir la versión beta según el impacto: por ejemplo,
   `0.10.1-beta.1` para un parche o `0.11.0-beta.1` para un hito.
3. Ejecutar pruebas, construir y revisar localmente.
4. Abrir un PR hacia `main`.
5. Esperar CI y revisar el cambio del PR.
6. Fusionar el PR a `main`.
7. Esperar el workflow de Pages y probar `/beta/`.

Para otra iteración del mismo objetivo, aumentar `beta.n`, repetir el PR y
fusionar nuevamente a `main`. No se crea un despliegue separado por rama.

## Promoción de beta a estable

La beta no se vuelve estable sólo por fusionarse a `main`. La promoción tiene
dos acciones adicionales:

1. Cambiar la versión aceptada de `X.Y.Z-beta.n` a `X.Y.Z` y crear la etiqueta
   inmutable `vX.Y.Z` sobre el commit aprobado.
2. Actualizar `stable-version.txt` a `vX.Y.Z` mediante un PR a `main`.

Al fusionarse ese PR, Pages vuelve a construir el sitio: `/` toma la etiqueta
nueva y `/beta/` sigue tomando `main`. Si comienza un nuevo ciclo, se cambia
`main` a la siguiente beta, por ejemplo `0.12.0-beta.1`.

## Qué no hacer

- No ejecutar `workflow_dispatch` desde una rama `agent/...` esperando que se
  publique; el build puede terminar bien, pero el deploy será rechazado por la
  protección del entorno.
- No modificar `stable-version.txt` para publicar una beta.
- No crear etiquetas estables para cada rama de trabajo.
- No duplicar ramas sólo para intentar que aparezcan en Pages.
- No considerar que un merge a `main` cambió la raíz estable: la raíz depende
  de la etiqueta, no del número que tenga `main`.

## Cómo ver una rama antes del merge

Para una preview de una rama se debe usar el archivo local generado:

```powershell
npm run build
python -m http.server 8000 --directory dist
```

Luego abrir `http://localhost:8000/`. Esta preview local no comparte IndexedDB
con la beta ni con estable y no reemplaza la revisión posterior en Pages.

## Estado de este proyecto

La estable publicada sigue en `v0.10.0`. La corrección de versionamiento local
prepara `0.11.0-beta.1`, pero esa versión sólo aparecerá en `/beta/` después de
fusionar su PR a `main` y completar el workflow de Pages.
