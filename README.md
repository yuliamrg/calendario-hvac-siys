# SIYS Sync

Herramienta local para programar servicios HVAC en un calendario mensual. El
entregable listo para usar es:

`dist/calendario-hvac-siys.html`

No requiere instalación, servidor ni conexión a internet. Se abre con doble
clic en Chrome o Microsoft Edge y guarda la información en el perfil local del
navegador mediante IndexedDB.

También puede abrirse desde GitHub Pages. Esa opción sigue siendo estática: los
datos se guardan en el navegador que abre el sitio y no se sincronizan. La
versión local y la versión Pages usan almacenamientos separados; la opción
**Descargar copia del cronograma** permite trasladar la programación entre
ambas. El archivo usa internamente el formato JSON.

GitHub Pages ofrece dos canales:

- estable: `https://yuliamrg.github.io/calendario-hvac-siys/`;
- beta: `https://yuliamrg.github.io/calendario-hvac-siys/beta/`.

Cada canal tiene su propia IndexedDB. Los datos sólo pasan de uno a otro
mediante una copia del cronograma elegida por el usuario.

## Primer uso

1. Abra `dist/calendario-hvac-siys.html`.
2. Abra **Gestionar > Actualizar base operativa** y seleccione
   `Base_operativa_HVAC_SIYS.xlsx`.
3. Revise la vista previa y confirme la importación.
4. Arrastre una sede desde el banco a un día o haga clic en el fondo del día.
5. Complete la tarjeta y guárdela.
6. Use **Descargar copia del cronograma** al terminar una carga importante.

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
- En teléfono y tablet vertical, la agenda diaria es la vista principal.
  **Ver mes** abre un selector superpuesto y **Más** agrupa Banco, Gestionar,
  Compartir y Configuración. El detalle ofrece alternativas táctiles para Mover, Duplicar,
  Ampliar, Editar y Cambiar estado sin depender del arrastre.
- En tablet horizontal y escritorio se conserva el tablero completo; los temas
  Claro, Oscuro y Sistema funcionan en todos los tamaños.
- El banco se puede ocultar y tiene desplazamiento propio.
- Domingos y festivos se excluyen inicialmente de los rangos; la vista previa
  permite incluir fechas específicas.
- Los cierres manuales y las excepciones laborales se administran con el botón
  **Festivos y ajustes** (símbolo `◉`).
- **Compartir > Descargar listado del mes** genera la programación del mes visible con columnas
  separadas para personal de nómina y contratistas.
- **Filtros** combina varias ciudades, clientes, sedes, responsables, servicios
  y estados; **PNG** descarga exactamente esa vista.
- **Plantilla** e **Importar programación** permiten una carga masiva Excel con
  validación previa, detección de duplicados y una sola operación deshacible.

## Persistencia y copias de seguridad

Los datos permanecen únicamente en el navegador y equipo donde se usó el
archivo. Borrar los datos del navegador, cambiar de perfil o usar otro equipo
no traslada la programación.

Use **Gestionar > Descargar copia del cronograma** regularmente y guárdela en
una carpeta sincronizada o protegida. La copia incluye el nombre del cronograma,
coordinador, revisión, versión y origen de exportación. **Recuperar una copia**
valida el archivo, advierte si su revisión es anterior o igual y conserva una
copia de recuperación local. Los respaldos creados con `v0.1.0` se migran
automáticamente.

**Borrar y empezar de cero** descarga primero una copia y exige escribir
`REINICIAR`. La operación limpia el cronograma y su recuperación en ese
navegador, sin afectar otros perfiles u orígenes.

**Recuperar una copia del cronograma** reemplaza el documento completo.
**Combinar otra copia** combina catálogos, actividades, series y excepciones sin eliminar
registros ausentes. El registro con `updatedAt` más reciente gana; en empate se
conserva el actual y la vista previa informa el conflicto.

La sección **Datos locales del navegador** indica si el navegador concedió
persistencia al origen. Esta protección reduce el riesgo de liberación
automática por falta de espacio, pero no reemplaza los respaldos JSON.

Sólo una pestaña puede editar a la vez. Las demás abren en modo de lectura y
pueden consultar, filtrar y exportar. **Tomar control** transfiere la edición a
la pestaña actual; si la pestaña editora se cierra o deja de responder, otra
recupera el control después de aproximadamente 15 segundos.

## Nombre del cronograma y edición múltiple

**Configuración > Nombre del cronograma** permite asignar un nombre y coordinador. La
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
- [Criterios de diseño y promoción beta](docs/CRITERIOS_DE_DISENO.md)
- [Reglas de versionamiento](docs/VERSIONAMIENTO.md)
- [Historial de cambios](CHANGELOG.md)
- [Distribución y GitHub Pages](docs/DISTRIBUCION.md)
