# Criterios de diseño — SIYS Sync

## Propósito

Este documento es el contrato visual y de experiencia para hacer crecer la
MVP de SIYS Sync sin convertir cada nueva funcionalidad en una decisión de
diseño aislada. Define criterios verificables, no una colección de gustos.

La versión beta es el espacio para probar cambios de diseño. La versión
estable conserva el comportamiento y la apariencia aprobados hasta que una
propuesta beta cumpla las puertas de promoción descritas al final.

La iteración histórica `0.10.0-beta.2`, promovida a estable como `0.10.0`,
validó una interacción de tema sin diálogo, densidad de detalle en dos
columnas, búsqueda de responsables y controles de selección legibles en ambos
temas. La renovación integral SIYS Operations posterior se mantiene como la
línea activa `0.11.0-beta.1`; la estable conserva `v0.10.0` hasta una nueva
promoción explícita. Los datos operativos siguen aislados por canal.

## Producto, audiencia y tarea principal

- Producto: calendario local autocontenido para programar servicios HVAC SI&S.
- Público principal: coordinación de servicios y personas que consultan o
  actualizan la programación operativa.
- Tarea primaria: comprender qué actividad ocurre, cuándo, dónde, con quién y
  en qué estado; después crear, mover, filtrar, editar o respaldar la agenda.
- Contexto: consulta rápida en escritorio, tablet y teléfono, con datos locales
  y posibilidad de trabajar sin conexión.
- Contenido inmutable: significado operativo, nombres de acciones, privacidad
  local, advertencias de respaldo y reglas de fechas no laborables.

## Principios de decisión

1. Claridad operativa antes que novedad estética.
2. La fecha y la actividad son el foco; el catálogo, los filtros y la gestión
   apoyan esa tarea sin competir con ella.
3. Una señal visual no debe ser la única forma de comunicar estado, categoría,
   prioridad o error.
4. Se conserva la identidad SIYS Sync existente; no se inventan marcas,
   colores corporativos ni datos técnicos.
5. Se agrupa por tarea y significado. Las tarjetas se reservan para unidades
   independientes o accionables.
6. Se diseñan estados completos: predeterminado, foco, activo, seleccionado,
   cargando, éxito, error, deshabilitado y vacío.
7. El sistema debe funcionar con contenido real, nombres largos, varias
   tarjetas por día, datos ausentes y pantallas pequeñas.
8. Toda propuesta debe poder verificarse en navegador, teclado y tamaño real.

## Jerarquía y arquitectura de información

### Orden de prioridad

1. Mes o día consultado y actividades visibles.
2. Nueva actividad y navegación de fecha.
3. Búsqueda, filtros y estado de guardado.
4. Catálogo operativo y responsables.
5. Gestionar, compartir, configuración y ayuda.

### Reglas

- Cada pantalla tiene un foco primario reconocible en menos de tres segundos.
- La etiqueta, el valor, la unidad y el estado permanecen próximos.
- El resumen precede al detalle; la acción destructiva exige confirmación y
  ofrece recuperación cuando sea posible.
- Los nombres de botones describen la acción operativa, no el formato técnico.
- Los avisos persistentes deben ocupar el mínimo espacio compatible con su
  comprensión y no desplazar innecesariamente la agenda.

## Sistema visual

### Tokens de referencia

Los tokens viven en las variables CSS de `src/styles.css`, incluidos los
tokens de piloto beta al final del archivo. Las nuevas reglas deben reutilizar
roles, no introducir colores literales sin justificación.

| Rol | Referencia actual | Uso |
|---|---|---|
| Primario | `#4f7d32` | marca, encabezados y navegación |
| Acción primaria | `#365b2c` | guardar, confirmar y acciones principales |
| Fondo de página | `#edf1ec` | separación exterior |
| Superficie | `#ffffff` | paneles y controles |
| Texto principal | `#1e2a21` | lectura operativa |
| Texto secundario | `#69736b` | metadatos y ayuda |
| Borde | `#dfe5df` | separación estructural |
| Advertencia | `#fff3cd` / `#6b4700` | avisos con texto oscuro |
| Error | `#f9dddd` / `#8d2b2b` | errores y estados no ejecutados |

### Dirección beta `0.11.0-beta.1` — SIYS Operations

La beta prueba una línea operativa profesional, separada visualmente del
contrato estable hasta su eventual promoción:

- Fondo gris frío y superficies blancas en claro; superficies azul-verdosas
  escalonadas en oscuro.
- Verde/teal reservado para acción primaria, foco, selección y señales de
  éxito; nómina y contratista se distinguen con etiquetas y marcadores
  compactos, no con fondos saturados.
- Tarjetas con borde estructural y marcador superior de estado; la información
  principal conserva mínimo 11 px y el metadato 10 px sólo cuando permanece
  legible.
- Detalle en dos columnas cuando el ancho lo permite, con observaciones y
  datos operativos a todo el ancho; formularios, catálogo y menús comparten
  radios, bordes y estados.
- El modo oscuro beta define sus propios tokens de fondo, superficie, borde,
  texto y control. No se reutilizan tonos pastel del claro.
- La base sigue siendo HTML, CSS y JavaScript autocontenidos, sin fuentes,
  iconos ni dependencias remotas nuevas.

La dirección se inspira en recursos locales de Open Design —sistemas de
dashboard y productividad, más las guías de color, tipografía y cobertura de
estados—, adaptados a SIYS Sync sin copiar identidad de marca.

Las tarjetas beta usan roles semánticos separados para nómina, contratista,
mixta y sin responsable. En modo oscuro cada fondo cambia a una superficie
oscura con texto claro; no se reutilizan los colores pastel del modo claro.
En el contrato estable, los campos del detalle usan separación por línea y
espacio. La beta `0.11.0-beta.1` prueba bloques sutiles por dato para reducir la
lectura vertical sin convertirlos en tarjetas decorativas.

Los pares principales deben mantener, como mínimo, 4.5:1 para texto normal y
3:1 para texto grande o componentes no textuales. El color se acompaña con
etiqueta, icono, patrón, posición o texto.

### Tipografía

- Familia base: Arial, Segoe UI o una familia equivalente disponible localmente.
- Texto de actividad: no bajar de 11 px para el contenido operativo en la
  variante beta; el metadato puede usar 10 px si sigue siendo legible.
- Interfaz táctil: objetivos de al menos 44 px cuando la acción sea primaria o
  de navegación.
- No comprimir texto para que quepa: primero truncar con detalle accesible,
  divulgar progresivamente o cambiar la composición.

### Retícula y espaciado

- Escritorio: panel de catálogo + calendario modular de siete columnas.
- Móvil: agenda diaria como vista primaria; el mes es un selector superpuesto.
- Escala base recomendada: 4, 8, 12, 16, 24, 32 y 48 px.
- El espacio interior comunica pertenencia; el exterior separa grupos.
- Mantener alineación de bordes, ejes, líneas base y controles equivalentes.
- El encabezado de los siete días es una zona persistente: conserva una altura
  propia y permanece visible mientras se desplaza el calendario con contenido.

### Superficies, bordes e iconos

- Usar tarjetas sólo para actividades, grupos de catálogo o unidades accionables.
- Mantener radios y elevaciones por rol; no agregar sombra, borde y fondo cuando
  una sola señal sea suficiente.
- Las acciones esenciales llevan etiqueta visible. Un icono aislado requiere
  nombre accesible y no debe depender de la forma del glifo.
- La familia iconográfica debe ser coherente en grosor, caja y tamaño óptico.

## Responsive

| Rango | Experiencia | Criterio de aceptación |
|---|---|---|
| hasta 899 px | agenda diaria, acciones táctiles y mes superpuesto | sin overflow horizontal; navegación anterior/hoy/siguiente operable |
| 900–1199 px | tablero completo comprimido | columnas, filtros y acciones siguen distinguibles |
| 1200 px o más | tablero completo | catálogo y calendario comparables sin pérdida de jerarquía |

También se prueban 320×640, 390×844, 844×390, 768×1024, 1024×768 y 1440×900,
además de contenido largo, zoom, teclado, tema oscuro y altura reducida.

## Accesibilidad e interacción

- Mantener `lang="es"`, títulos descriptivos, nombres accesibles y foco visible.
- Las pestañas deben exponer `role=tablist`, `role=tab`, `aria-selected`,
  `aria-controls`, `role=tabpanel` y `aria-labelledby` de forma coherente.
- El orden de teclado debe seguir el recorrido visual y conservar el foco al
  cerrar diálogos o paneles.
- No depender sólo del color para nómina, contratistas, festivos, estados o
  errores.
- Respetar `prefers-reduced-motion` y evitar transiciones que retrasen la tarea.
- Validar con inspección del árbol accesible y revisión manual; las pruebas
  automatizadas no demuestran por sí solas una buena jerarquía.

## Estados y recuperación

Cada componente nuevo debe documentar sus estados y su recuperación. Como
mínimo:

- calendario: vacío, con actividades, festivo, domingo, fuera de mes, hoy,
  selección y arrastre;
- actividad: programada, confirmada, en ejecución, terminada, no ejecutada y
  cancelada;
- operación: guardando, guardado, error, solo lectura y control recuperable;
- importación y respaldo: vista previa, advertencia, éxito, conflicto,
  cancelación y deshacer.

## Rendimiento, privacidad y distribución

- Mantener el HTML autocontenido y sin solicitudes de red en ejecución normal.
- No incorporar fuentes, iconos, imágenes ni dependencias remotas sin revisar
  licencia, peso y disponibilidad offline.
- No introducir datos operativos en capturas, fixtures, documentación pública o
  artefactos de distribución.
- Las preferencias visuales pueden vivir fuera del documento operativo; no deben
  cambiar la revisión ni contaminar respaldos.

## Puertas de promoción beta → estable

Una mejora visual beta sólo se promueve si:

- alcanza al menos 85/100 en la rúbrica visual web y no tiene defectos
  críticos;
- conserva contenido, privacidad, persistencia, exportaciones y flujo operativo;
- pasa `npm run verify` y las pruebas de navegador en Chrome y Edge;
- pasa los seis viewports responsive sin overflow ni superposición;
- mantiene contraste, foco, navegación por teclado y estados accesibles;
- se revisa en claro, oscuro, impresión y exportación PNG cuando corresponda;
- se compara explícitamente contra la versión estable y se documenta la
  decisión de promoción.

La promoción visual también respeta el impacto de versionamiento: una
corrección aislada de contraste, responsive o accesibilidad puede ser un
parche `0.x.y`; una renovación transversal del sistema visual o una capacidad
visible nueva es un hito `0.x.0`; `1.0.0` sólo se considera cuando los contratos
de datos y flujos del producto ya cumplen su puerta de estabilidad. El tamaño
del diff o el número de iteraciones beta no decide por sí solo la versión.

## Registro de cambios de diseño

Cada cambio relevante debe registrar:

1. problema observado y evidencia;
2. criterio aplicado;
3. alcance —beta o estable—;
4. componentes y tokens afectados;
5. pruebas ejecutadas;
6. resultado antes de promover.

La beta es un canal de aprendizaje, no una excepción para saltarse accesibilidad,
privacidad o pruebas de regresión.
