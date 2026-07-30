# Calendario HVAC SI&S

Herramienta local para programar servicios HVAC en un calendario mensual. El
entregable listo para usar es:

`dist/calendario-hvac-siys.html`

No requiere instalación, servidor ni conexión a internet. Se abre con doble
clic en Chrome o Microsoft Edge y guarda la información en el perfil local del
navegador mediante IndexedDB.

## Primer uso

1. Abra `dist/calendario-hvac-siys.html`.
2. Use **Importar Base Operativa** en la barra superior y seleccione
   `Base_operativa_HVAC_SIYS.xlsx`.
3. Revise la vista previa y confirme la importación.
4. Arrastre una sede desde el catálogo a un día o use el botón **+** del día.
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
- Domingos y festivos se excluyen inicialmente de los rangos; la vista previa
  permite incluir fechas específicas.
- Los cierres manuales y las excepciones laborales se administran con el botón
  **Festivos y ajustes** (símbolo `◉`).
- **Exportar CSV** genera la programación del mes visible con columnas
  separadas para personal de nómina y contratistas.

## Persistencia y respaldos

Los datos permanecen únicamente en el navegador y equipo donde se usó el
archivo. Borrar los datos del navegador, cambiar de perfil o usar otro equipo
no traslada la programación.

Use **Descargar respaldo JSON** regularmente y guárdelo en una carpeta
sincronizada o protegida. **Restaurar respaldo** valida el archivo antes de
reemplazar la información activa y conserva una copia de recuperación local.

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
```

El HTML incorpora localmente SheetJS Community Edition 0.20.3 para leer
archivos Excel. Su licencia y aviso se encuentran en `vendor/` y también están
incluidos dentro del HTML generado.
