# Versionamiento de SIYS Sync

## Regla general

SIYS Sync usa [Semantic Versioning 2.0.0](https://semver.org/) con una
adaptación explícita para el periodo `0.x` de la MVP. El número no avanza por
calendario, cantidad de archivos ni esfuerzo: avanza según el impacto del
cambio sobre la experiencia, las capacidades y los contratos del producto.

La versión activa debe coincidir en estas fuentes:

- `package.json > version`: fuente de release y automatización.
- `package-lock.json`: versión del paquete raíz.
- `src/core.js > APP_VERSION`: versión guardada en copias y mostrada en la UI.
- `dist/`: salida regenerada por `npm run build`; nunca se edita a mano.

El `SCHEMA_VERSION` de `src/core.js` es independiente. Sólo aumenta cuando
cambia el formato persistido o las reglas necesarias para leer y escribir
copias; un cambio visual no lo incrementa.

## Cómo decidir el incremento

La primera pregunta es qué contrato cambia, no si el cambio parece grande:

| Versión | Criterio | Ejemplos en SIYS Sync |
|---|---|---|
| `0.x.y` | Corrección compatible, sin capacidad ni contrato nuevo | corregir contraste, un overflow, texto, foco, regresión, rendimiento o una validación aislada |
| `0.x.0` | Hito de producto o capacidad visible nueva, conservando compatibilidad de datos y flujos | nueva agenda móvil, filtros multiselección, combinación JSON o un sistema visual integral |
| `1.0.0` | Decisión de estabilidad del producto: datos, copias, importación/exportación y flujos principales tienen un contrato público mantenido | primera release que garantiza compatibilidad y migraciones como producto estable |
| `N.0.0` posterior | Cambio incompatible después de `1.0.0` | romper un contrato público que no puede migrarse de forma compatible |

Antes de `1.0.0`, un cambio incompatible no obliga por sí solo a saltar a
`1.0.0`: se clasifica como el siguiente hito `0.x.0`, se documenta la ruptura y
se incrementa `SCHEMA_VERSION` si afecta datos persistidos. `1.0.0` es una
puerta de madurez y compromiso, no un sinónimo de "cambio grande".

### Ejemplos concretos desde `v0.10.0`

- Reparar el contraste del modo oscuro, evitar que desaparezcan los días o
  corregir un botón: `0.10.1`.
- La convención histórica de parches como `0.9.1` se conserva para arreglos
  compatibles; no se convierte automáticamente en un nuevo hito.
- Introducir una capacidad operativa nueva o renovar transversalmente tarjetas,
  temas, controles, detalle y jerarquía: `0.11.0`.
- Declarar estable el contrato de persistencia, respaldos, importación,
  exportación y flujos principales: `1.0.0`.

## Canales beta

Una beta es una versión previa a una versión base que todavía no existe como
estable:

```text
0.10.1-beta.1   # candidato a parche
0.11.0-beta.1   # candidato a nuevo hito
1.0.0-beta.1    # candidato a primera versión estable
```

- `beta.1`, `beta.2`, etc. ordena iteraciones del mismo objetivo.
- El número base se elige antes del sufijo.
- Después de publicar `v0.10.0`, no se debe crear `0.10.0-beta.6`.
- Si el cambio es un parche validable, la base es `0.10.1`; si es un hito,
  `0.11.0`; si prepara el primer contrato estable, `1.0.0`.
- La beta debe mostrar su versión y distintivo `BETA`.
- Una versión final ya publicada no se reetiqueta ni se sobrescribe.

## Estado actual del proyecto

`v0.10.0` es la versión estable fijada por `stable-version.txt` y por la
etiqueta Git existente. Las entradas históricas `0.10.0-beta.1` a
`0.10.0-beta.5` documentan la línea que precedió a esa promoción; no se
reescriben sus commits ni se reutiliza esa base.
No se reescriben etiquetas ni commits históricos.

La línea activa de desarrollo se reencauza como `0.11.0-beta.1` porque la
renovación SIYS Operations es un hito visual transversal posterior a
`v0.10.0`. Esta corrección no cambia la etiqueta estable ni sus datos.

El contrato visual beta inicial quedó registrado en el commit histórico
`0d05123`; esa referencia se conserva como evidencia y no define la base de la
línea actual.

## Fuentes de GitHub Pages

- `main` contiene la línea beta o de trabajo publicada en `/beta/`.
- `stable-version.txt` contiene una etiqueta inmutable `vX.Y.Z` para la raíz
  estable `/`.
- Fusionar una beta en `main` publica o actualiza sólo `/beta/`; no promueve
  estable automáticamente.
- Promover requiere una versión final, una etiqueta nueva y actualizar
  `stable-version.txt` mediante un cambio verificable.
- Las ramas de trabajo no son destinos de Pages. Para ver una rama antes del
  merge se usa una preview local; para publicar beta se requiere PR aprobado y
  merge a `main`. El detalle operativo está en
  [Flujo de GitHub Pages y beta](GITHUB_PAGES.md).

## Flujo de release

### 1. Desarrollo beta

1. Clasificar el cambio como parche, hito o primera estabilidad.
2. Elegir la base correcta (`0.10.1`, `0.11.0` o `1.0.0`) y añadir `-beta.1`.
3. Actualizar `package.json`, `package-lock.json` y `src/core.js`.
4. Actualizar changelog, criterios de diseño y pruebas documentales.
5. Ejecutar `npm run verify` y pruebas de navegador representativas.
6. Regenerar `dist/`, abrir PR a `main` y probar `/beta/`.
7. Para otra iteración del mismo objetivo, incrementar sólo `beta.n`.

### 2. Promoción a estable

Cuando la beta cumple sus puertas de aceptación:

1. Cambiar el candidato de `X.Y.Z-beta.n` a `X.Y.Z` en un commit de release.
2. Ejecutar `npm run verify` y las pruebas de aceptación.
3. Crear la etiqueta inmutable `vX.Y.Z` sobre ese commit aprobado.
4. Actualizar `stable-version.txt` a `vX.Y.Z` mediante un PR de promoción.
5. Fusionar a `main` y verificar raíz estable y `/beta/`.
6. Si continúa el desarrollo, abrir inmediatamente la siguiente línea beta,
   por ejemplo `0.12.0-beta.1`.

La raíz estable no cambia sólo porque una beta se fusione a `main`. La
promoción exige explícitamente la etiqueta y el puntero estable.

## Puerta para `1.0.0`

Se puede considerar `1.0.0` sólo cuando exista una decisión explícita de
producto y se hayan comprobado al menos:

- persistencia y migraciones documentadas;
- formato de respaldos e importación/exportación con compatibilidad definida;
- flujos principales aceptados y sin contratos provisionales conocidos;
- documentación de usuario y de release actualizada;
- pruebas de regresión, navegador, accesibilidad y distribución aprobadas;
- política clara para cambios incompatibles posteriores.

Una renovación visual, por profesional que sea, no satisface por sí sola esta
puerta.

## Lista de comprobación

1. Clasificar el cambio por impacto.
2. Confirmar que la base elegida aún no tiene release estable.
3. Sincronizar las fuentes de versión.
4. Actualizar documentación, changelog y pruebas.
5. Ejecutar `npm run verify` y pruebas de navegador.
6. Revisar `git diff --check`, `git status` y `dist/`.
7. Publicar beta en `main` o promover con etiqueta y `stable-version.txt`.
8. Verificar las dos URLs y dejar el árbol Git limpio.
