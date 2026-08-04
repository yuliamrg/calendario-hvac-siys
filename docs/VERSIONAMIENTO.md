# Versionamiento de SIYS Sync

## Regla adoptada

SIYS Sync usa [Semantic Versioning 2.0.0](https://semver.org/) con una
adaptación explícita para el periodo `0.x` del producto.

El número de versión se mantiene en dos fuentes que deben coincidir:

- `package.json > version`: fuente de release y de automatización.
- `src/core.js > APP_VERSION`: versión que se guarda en las copias y que se
  muestra en la interfaz.

Después de cambiar la versión se ejecuta `npm run build` para regenerar ambos
archivos de `dist/`. No se edita la distribución manualmente.

## Cómo se decide el incremento

| Tipo | Cuándo se usa | Ejemplo |
|---|---|---|
| `0.x.0` | Hito de producto o capacidad visible nueva que conserva la compatibilidad de datos y los flujos existentes | `0.9.0` agenda-first, `0.8.0` responsive y acciones táctiles |
| `0.x.y` | Corrección aislada, regresión o ajuste interno sin una superficie de producto nueva | `0.9.1` |
| `1.0.0` | Primera API/formato estable o cambio incompatible que requiera migración o cambie un contrato público | `1.0.0` |

Mientras el producto sea `0.x`, la compatibilidad no se presume por el número:
se conserva por decisión del proyecto y se valida con pruebas de migración,
persistencia y regresión.

El `SCHEMA_VERSION` de `src/core.js` es independiente del número de la app.
Sólo aumenta cuando cambia el formato persistido o las reglas necesarias para
leer/escribir copias; un cambio visual no lo incrementa.

La bandeja Pendiente usa el esquema 4. Los documentos de esquemas
anteriores se migran asignando `planningBucket: "calendar"`; la versión estable
anterior no interpreta documentos nuevos de esquema 4.

## Canales beta

Una beta se identifica con un sufijo prerelease:

```text
0.10.0-beta.1
```

- La base (`0.10.0`) es el siguiente hito previsto.
- `beta.1`, `beta.2`, etc. ordena las iteraciones publicadas antes de la
  promoción.
- La beta debe mostrar su versión y su distintivo `BETA`.
- La versión estable no se cambia hasta que la beta cumpla las puertas de
  promoción de `CRITERIOS_DE_DISENO.md` y las pruebas del proyecto.

## Preflight de canal y respaldos

La versión del código local no sustituye la versión observada en el canal que
se va a operar. Antes de restaurar un JSON se comparan:

- la URL y el canal (`stable` o `beta`);
- la versión visible en la interfaz;
- `appVersion`, `channel`, `schemaVersion` y `revision` del respaldo;
- el perfil del navegador donde se guardan los datos.

Una discrepancia se trata como una alerta de despliegue y detiene la
restauración hasta identificar la publicación correcta. No se debe subir un
respaldo beta a estable, ni uno estable a beta, por coincidencia de nombres o
porque ambas interfaces tengan el mismo aspecto.

La ruta operativa de respaldos de este equipo está documentada en
[`OPERACION_RESPALDOS_JSON.md`](OPERACION_RESPALDOS_JSON.md). El procedimiento
exige descargar un respaldo nuevo antes de cada modificación, conservar el
origen, escribir un destino nuevo y verificar un respaldo final.

## Aplicación a este proyecto

La versión estable actual es `0.11.0`. Esta release promueve a estable la
CLI local y el contrato programático compartido para trabajar sobre respaldos
JSON. `package.json`, `src/core.js` y `stable-version.txt` deben conservar
`0.11.0` hasta la siguiente release.

La beta anterior `0.12.0-beta.1` añadió la bandeja **Pendiente**, el esquema 4,
los tipos Diagnóstico y Garantía y las operaciones de respaldo/CLI
correspondientes. La nueva beta en preparación es `0.13.0-beta.1`: incorpora
persistencia cloud con Supabase Auth, PostgREST y PostgreSQL administrado, sin
cambiar el canal estable. Se publica sólo en `/beta/`; la raíz estable continúa
usando `v0.11.0` hasta la promoción explícita.

El historial confirma una convención de hitos de producto: después de `0.3.0`
se publicaron `0.4.0`, `0.5.0`, `0.6.0`, `0.7.0`, `0.8.0` y `0.9.0` para
capacidades o etapas visibles. No se encontró una secuencia histórica de
parches `0.x.y` para corregir únicamente defectos.

Por eso, el trabajo beta posterior a `0.9.0` se clasifica como `0.10.0-beta.1`:

1. consolida un contrato visual y componentes reutilizables;
2. corrige de forma transversal el tema oscuro, tarjetas, controles y densidad;
3. corrige un defecto persistente del encabezado de días;
4. mantiene separado el canal estable y no cambia el formato de datos.

La siguiente iteración publicada de esa misma línea se clasifica como
`0.10.0-beta.2`: conserva el alcance de la beta visual, pero incorpora ajustes
de interacción y densidad medidos en navegador —cambio directo de tema,
cabecera persistente de días, detalle más compacto, búsqueda de responsables,
contraste del buscador y botones de selección— sin cambiar el esquema ni
introducir una capacidad de producto independiente.

Tras pasar las puertas de promoción, esa línea visual se publicó como
`v0.10.0`; esta es una referencia histórica del contrato visual anterior. La
promoción no creó una interfaz diferente: convirtió el contrato visual
validado en la versión estable y fijó `v0.10.0` como la etiqueta de la raíz de
GitHub Pages. `/beta/` podía continuar como canal de prueba, con datos y
preferencias separados por origen/canal.

El commit anterior que añadió la primera capa del contrato beta (`0d05123`)
no actualizó la versión. Esta regla corrige esa omisión: todo cambio que se
publique en un canal beta debe actualizar las dos fuentes de versión, regenerar
`dist/`, pasar `npm run verify` y quedar registrado en Git.

## Lista de comprobación de release

1. Clasificar el cambio como hito (`0.x.0`), parche (`0.x.y`) o ruptura.
2. Elegir el sufijo de canal si es beta, candidato o experimento.
3. Actualizar `package.json` y `src/core.js` con el mismo valor.
4. Actualizar pruebas o documentación cuando cambie el contrato.
5. Ejecutar `npm run verify` y pruebas de navegador de estable y beta.
6. Revisar que `dist/` sólo contenga la salida del build.
7. Commit con la versión en el mensaje y publicar la rama correspondiente.
8. Promover a estable sólo después de la revisión beta y sus puertas de
   promoción; crear la etiqueta estable y actualizar `stable-version.txt` en
   una publicación posterior verificable.
