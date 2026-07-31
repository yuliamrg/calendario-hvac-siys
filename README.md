# SIYS Sync

Herramienta local para programar servicios HVAC en un calendario mensual. El
entregable listo para usar es:

`dist/calendario-hvac-siys.html`

No requiere instalación, servidor ni conexión a internet. Se abre con doble
clic en Chrome o Microsoft Edge y guarda la información en el perfil local del
navegador mediante IndexedDB.

También puede abrirse desde GitHub Pages. Esa opción sigue siendo estática: los
datos se guardan en el navegador que abre el sitio y no se sincronizan. La
versión local y la versión Pages usan almacenamientos separados; el respaldo
JSON permite trasladar la programación entre ambas.

GitHub Pages ofrece dos canales:

- estable: `https://yuliamrg.github.io/calendario-hvac-siys/`;
- beta: `https://yuliamrg.github.io/calendario-hvac-siys/beta/`.

Cada canal tiene su propia IndexedDB. Los datos sólo pasan de uno a otro
mediante un archivo JSON elegido por el usuario.

## Primer uso

1. Abra `dist/calendario-hvac-siys.html`.
2. Use **Importar Base Operativa** en la barra superior y seleccione
   `Base_operativa_HVAC_SIYS.xlsx`.
3. Revise la vista previa y confirme la importación.
4. Arrastre una sede desde el banco a un día o haga clic en el fondo del día.
5. Complete la tarjeta y guárdela.
6. Cree un **respaldo JSON** al terminar una carga importante.

La importación sólo lee clientes, sedes, ciudades, responsables y pistas
operativas permitidas. No elimina registros locales, no reemplaza campos
personalizados y no importa cédulas, NIT, correos ni contactos.

## Operación

- El calendario empieza en lunes y muestra domingos y festivos colombianos.
- Una tarjeta admite varios responsables, separados entre nómina y
  contratistas.
- Los estados son: Programada, Confirmada, En ejecución, Terminada,
  No ejecutada y Cancelada.
- Puede seleccionar varias tarjetas con su casilla o con `Ctrl`/`Cmd`, moverlas
  juntas o cambiarles el estado.
- Con teclado, entre al calendario con `Tab` y recorra las fechas con las
  flechas; `Enter` abre una nueva actividad en la fecha enfocada.
- Un servicio de varios días crea tarjetas independientes vinculadas. Después
  puede editar una fecha, las fechas futuras o toda la serie.
- Al arrastrar una tarjeta a otro día puede **Mover**, **Duplicar** o
  **Ampliar**. Ampliar conserva tarjetas diarias independientes, pero enlaza
  sus datos comunes. Soltar en el mismo día no genera cambios.
- En teléfono y tablet vertical, el mes compacto se complementa con una agenda
  del día. El detalle ofrece alternativas táctiles para Mover, Duplicar,
  Ampliar, Editar y Cambiar estado sin depender del arrastre.
- En tablet horizontal y escritorio se conserva el tablero completo; los temas
  Claro, Oscuro y Sistema funcionan en todos los tamaños.
- El banco se puede ocultar y tiene desplazamiento propio.
- Domingos y festivos se excluyen inicialmente de los rangos; la vista previa
  permite incluir fechas específicas.
- Los cierres manuales y las excepciones laborales se administran con el botón
  **Festivos y ajustes** (símbolo `◉`).
- **Exportar CSV** genera la programación del mes visible con columnas
  separadas para personal de nómina y contratistas.
- **Filtros** combina varias ciudades, clientes, sedes, responsables, servicios
  y estados; **PNG** descarga exactamente esa vista.
- **Plantilla** e **Importar programación** permiten una carga masiva Excel con
  validación previa, detección de duplicados y una sola operación deshacible.

## Persistencia y respaldos

Los datos permanecen únicamente en el navegador y equipo donde se usó el
archivo. Borrar los datos del navegador, cambiar de perfil o usar otro equipo
no traslada la programación.

Use **Descargar respaldo JSON** regularmente y guárdelo en una carpeta
sincronizada o protegida. El respaldo incluye el nombre del cronograma,
coordinador, revisión, versión y origen de exportación. **Restaurar respaldo**
valida el archivo, advierte si su revisión es anterior o igual y conserva una
copia de recuperación local. Los respaldos creados con `v0.1.0` se migran
automáticamente.

**Reiniciar datos** descarga primero un respaldo y exige escribir
`REINICIAR`. La operación limpia el cronograma y su recuperación en ese
navegador, sin afectar otros perfiles u orígenes.

**Restaurar respaldo JSON** reemplaza el documento completo. **Añadir desde
JSON** combina catálogos, actividades, series y excepciones sin eliminar
registros ausentes. El registro con `updatedAt` más reciente gana; en empate se
conserva el actual y la vista previa informa el conflicto.

La sección **Datos locales del navegador** indica si el navegador concedió
persistencia al origen. Esta protección reduce el riesgo de liberación
automática por falta de espacio, pero no reemplaza los respaldos JSON.

Sólo una pestaña puede editar a la vez. Las demás abren en modo de lectura y
pueden consultar, filtrar y exportar. **Tomar control** transfiere la edición a
la pestaña actual; si la pestaña editora se cierra o deja de responder, otra
recupera el control después de aproximadamente 15 segundos.

## Identificación y edición múltiple

**Identificación** permite asignar un nombre y coordinador al cronograma. La
revisión aumenta con cada cambio operativo; navegar entre meses o aplicar
filtros no la incrementa.

Al seleccionar varias tarjetas se puede:

- moverlas conservando la distancia relativa o reunirlas en una fecha;
- cambiar el estado;
- reemplazar el servicio;
- reemplazar, agregar o quitar responsables;
- reemplazar o vaciar la ciudad;
- reemplazar, agregar o vaciar observaciones;
- eliminarlas con confirmación.

Las operaciones múltiples son atómicas: si alguna tarjeta quedaría inválida,
no cambia ninguna. La última operación se puede deshacer.

## Actualizar el catálogo

La Base Operativa se puede importar nuevamente cuando cambien clientes, sedes o
responsables. Antes de aplicar, la herramienta muestra los registros nuevos,
actualizados, sin cambios y ausentes. Los ausentes no se borran
automáticamente.

## Desarrollo y verificación

Requiere Node.js 20 o superior sólo para reconstruir el entregable:

```powershell
npm test
npm run build
npm run audit
```

El HTML incorpora localmente SheetJS Community Edition 0.20.3 para leer
archivos Excel. Su licencia y aviso se encuentran en `vendor/` y también están
incluidos dentro del HTML generado.

Documentación:

- [Manual completo](docs/MANUAL_DE_USO.md)
- [Guía de Base Operativa](docs/BASE_OPERATIVA.md)
- [Historial de cambios](CHANGELOG.md)
- [Distribución y GitHub Pages](docs/DISTRIBUCION.md)
