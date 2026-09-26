# Auditoría técnica — `index.html` (Dashboard Servicio Médico METELMEX)

**Fecha:** 2026-09-26 · **Alcance:** `index.html` (frontend) y `Code.gs` (backend Apps Script, agregado al repositorio en la segunda ronda).

**Nomenclatura:** **[H]** es un hecho verificado en el código o por prueba. **[I]** es una interpretación. **[O]** es una opinión técnica.

---

## 1. Resumen ejecutivo

| # | Hallazgo | Severidad | Ubicación |
|---|----------|-----------|-----------|
| 1 | XSS almacenado: los datos de Excel y de Sheets se insertan sin escapar en `innerHTML` y en `onclick` | **Crítica** | L546-560, L927-941, L952-954, L1061-1070 |
| 2 | El token de acceso viaja en la URL (GET) y se guarda en `localStorage` en texto plano | **Alta** | L357-358, L407 |
| 3 | Copia completa de datos de salud y NSS en `localStorage`, aunque exista conexión al backend | **Alta** | L448-451, L533 |
| 4 | En los CSV, las fechas dd/mm con día ≤ 12 se invierten a mm/dd (confirmado con prueba) | **Alta** | L1163 |
| 5 | SheetJS 0.18.5 tiene CVE conocidos y ninguno de los dos CDN usa SRI | **Alta** | L7-8 |
| 6 | Se actualiza la pantalla antes de guardar y no hay reversión si el guardado falla, así que la pantalla y Sheets pueden no coincidir | **Alta** | L1035-1038, L1042-1044, L1116-1119, L1308, L1317, L620 |
| 7 | Cada carga reescribe la hoja completa (`modo:'reemplazar'`). Si dos usuarios trabajan a la vez, gana el último y se pierden datos | **Alta** | L620, L1308, L1317 |
| 8 | La incapacidad aparece "Cerrada" el mismo día de su Fecha Fin (debe seguir activa ese día) | Media | L473 |
| 9 | Los días de una incapacidad que cruza de año se cuentan completos en el año de inicio. Distorsiona los días subsidiados de RT | Media | L692-699, L758, L787-788 |
| 10 | La opción "Agregar / actualizar existentes" no actualiza nada: descarta los folios repetidos y duplica los registros sin folio | Media | L1299-1304 |
| 11 | El catálogo de empleados acepta códigos duplicados, y al editar un código queda un registro huérfano en el backend | Media | L1115-1119 |
| 12 | En el Excel exportado, "Incapacidades activas" ignora el filtro de planta, aunque el KPI en pantalla sí lo aplica | Baja | L792 vs L805 |
| 13 | Las fechas que no se reconocen se guardan como texto libre y desaparecen del dashboard sin ningún aviso | Baja | L513 |
| 14 | No se valida que Días = Fecha Fin − Fecha Inicio + 1 | Baja (control) | L1011-1039 |

---

## 2. Marco legal aplicable

- **LFPDPPP (ley nueva, publicada en el DOF el 20-mar-2025).** Los datos de salud son **datos personales sensibles**, y el responsable tiene un deber de seguridad (medidas administrativas, técnicas y físicas). *La ley se reexpidió en 2025, así que conviene verificar la numeración vigente de los artículos antes de citarlos en un dictamen.*
- **LSS, art. 72.** Fórmula de la prima de riesgo de trabajo; los días subsidiados (S) se toman por periodo anual. **El mismo artículo excluye los accidentes en trayecto de la siniestralidad.** [H] El código los separa correctamente (`esRT` en L686 no incluye TRAYECTO).
- **LSS, art. 74 y RACERF (capítulo de determinación de la prima).** La revisión anual de la siniestralidad se hace por año calendario. *La numeración del RACERF debe confirmarse contra el texto vigente.*
- **LFT, arts. 473-474.** Definiciones de riesgo de trabajo y de accidente de trabajo, incluido el de trayecto.

---

## 3. Análisis por hallazgo

### H1 — XSS almacenado (Crítica)
[H] Valores como `Codigo`, `Nombre`, `Puesto`, `Planta`, `Folio` e `ID` salen de archivos cargados (exports de nómina o de portales) o de Google Sheets, y se interpolan sin escapar en plantillas HTML. `ID` y `Codigo` además quedan dentro de `onclick="...('${i.ID}')"`: una comilla simple rompe el atributo y permite ejecutar JavaScript.
[I] Cualquiera que pueda editar la hoja o hacer que se cargue un Excel manipulado podría leer `localStorage`: el token y la base completa de incapacidades con NSS.
**Corrección:** una función `esc()` para todo lo que se inserte en HTML, y usar `data-id` con `addEventListener` en lugar de `onclick` armado como texto.

### H2 — Token expuesto
[H] `apiGet` manda `&token=` en la URL. Esa URL queda en los registros de ejecución de Apps Script, en el historial del navegador y en los proxys corporativos.
**Corrección:** mandar también las lecturas por POST con el token en el cuerpo, y guardar el token en `sessionStorage` o pedirlo en cada sesión.

### H3 — Respaldo local de datos sensibles
[H] `guardarLocalRespaldo()` se ejecuta en **cada** refresco de pantalla, aun con backend conectado, y deja en el navegador todas las incapacidades (diagnóstico por tipo, NSS, teléfono).
[I] En un equipo compartido (enfermería o RH) esto expone datos sensibles sin necesidad y contradice el deber de seguridad de la LFPDPPP.
**Corrección:** guardar la copia local solo en "modo sin backend", o no guardarla, y limpiarla al conectar.

### H4 — Inversión de fechas en CSV (Crítica para los indicadores)
[H] Prueba con SheetJS 0.18.5: `05/03/2024` (5 de marzo) se convierte al serial 45415, que es el **3 de mayo de 2024**. En cambio, `25/03/2024` se queda como texto y se interpreta bien. Resultado: en el mismo archivo, unas fechas se leen bien y otras mal según el día.
[I] Esto afecta el mes y el año de inicio, el estatus, el cruce del día 01 y los días por periodo.
**Corrección (una línea):** `XLSX.read(texto, {type:'string', raw:true})` en L1163.

### H5 — Dependencias
[H] SheetJS 0.18.5 tiene CVE-2023-30533 (prototype pollution al leer archivos manipulados; corregido en 0.19.3) y CVE-2024-22363 (ReDoS; corregido en 0.20.2). La aplicación procesa archivos que sube el usuario. cdnjs ya no publica versiones nuevas de SheetJS.
**Corrección:** cargar SheetJS ≥ 0.20.3 desde `cdn.sheetjs.com`, o hospedarlo localmente, y agregar el atributo `integrity` (SRI) a los dos `<script>`.

### H6 / H7 — Integridad de datos contra Google Sheets
[H] La lista local se modifica y la pantalla se redibuja **antes** de `apiPost`. Si el POST falla, la pantalla muestra datos que nunca se guardaron, y la copia local también los guarda. Además `apiPost` no revisa otros errores de tipo `ok:false`. Las cargas masivas y la actualización de la tabla depto→área mandan **toda** la hoja con `modo:'reemplazar'`.
[I] Con dos capturistas trabajando a la vez, el último en guardar sobrescribe lo del otro. Queda sin evidencia de quién capturó qué.
**Corrección:** guardar primero y actualizar la pantalla solo si el backend confirma. Mandar deltas (upsert por ID o por folio) en lugar de la hoja completa. Registrar en el backend una bitácora de usuario, fecha y acción.

### H8 — Estatus el día de la Fecha Fin
[H] `fin <= hoy` pone "Cerrada" a la incapacidad desde su último día.
[I] El certificado ampara hasta la fecha de término, inclusive; el trabajador se reincorpora al día siguiente.
**Corrección:** usar `fin < hoy`.

### H9 — Días por año
[H] Cada registro suma todos sus días al mes y al año de `FechaInicio`. Por ejemplo, una incapacidad de RT del 20-dic al 15-ene suma 27 días al año de inicio y 0 al siguiente.
[I] Para comparar con la siniestralidad anual (LSS art. 72), los días subsidiados deben repartirse por año calendario.
**Corrección:** repartir los días de cada registro por mes y año al calcular las series de días.

### H10 — "Agregar / actualizar existentes"
[H] Si un folio ya existe, el registro nuevo **se descarta** en lugar de actualizarse. Los registros sin folio siempre se agregan, así que cargar dos veces el mismo archivo duplica los días.
**Corrección:** reemplazar el registro existente cuando coincide el folio, y rechazar o marcar las filas sin folio.

### H11 — Catálogo de empleados
[H] Un empleado nuevo con un código que ya existe se agrega duplicado. Si al editar se cambia el código, el backend recibe un upsert con el código nuevo y el anterior se queda.
**Corrección:** validar que el código sea único y mandar `codigoOriginal` al backend.

---

## 4. Riesgos y contingencias

| Riesgo | Impacto | Exposición en auditoría |
|--------|---------|-------------------------|
| Fuga de datos sensibles (H1-H3) | Sanciones de la autoridad de protección de datos y daño reputacional | Revisión de controles de TI y aviso de privacidad |
| Fechas o días incorrectos (H4, H9) | Indicadores de RT que no cuadran con el SUA ni con la determinación anual de la prima | Diferencias al conciliar contra el IMSS (ST-2, ST-7 y certificados) |
| Pérdida o sobrescritura de registros (H6, H7, H10) | Faltan casos en el histórico | Sin rastro de auditoría para demostrar la integridad |
| Duplicados (H10, H11) | Días inflados y KPIs de ausentismo equivocados | Posibles hallazgos en una revisión interna de nómina e incapacidades |

---

## 5. Procedimiento de corrección sugerido (por prioridad)

1. **Inmediato (bajo esfuerzo):** H4 (`raw:true`), H8 (`<`), H12, escape de HTML (H1).
2. **Corto plazo:** SheetJS actualizado con SRI (H5); token por POST (H2); copia local solo sin backend (H3).
3. **Mediano plazo (requiere cambios en `Code.gs`):** guardar por deltas y confirmar antes de actualizar la pantalla (H6, H7); bitácora; lógica de upsert por folio (H10); unicidad de código (H11).
4. **Mejoras funcionales:** repartir días por año (H9); validar días contra fechas y reportar las filas rechazadas al cargar (H13, H14).

---

## 6. Recomendación práctica y controles internos [O]

- **Conciliación mensual** de los días de RT del dashboard contra el SUA y los certificados de incapacidad antes de usarlos en la determinación de la prima (febrero).
- **Acceso:** limitar quién puede editar la hoja de Google, rotar el token en cada cambio de personal y no usar el dashboard en equipos compartidos mientras H1-H3 sigan abiertos.
- **Exportaciones:** los Excel exportados contienen NSS y teléfono. Conviene definir quién puede exportar y retirar esas columnas cuando no se necesiten.
- **Carga masiva:** antes de usar "Reemplazar todo", exportar un respaldo. [O] Esa opción debería requerir un respaldo automático previo.

> *Nota:* las citas del RACERF y la numeración de la LFPDPPP 2025 deben verificarse contra el texto vigente del DOF, porque pueden cambiar por reforma.

---

## 7. Estado de correcciones (ronda 1: correcciones rápidas)

| # | Estado | Cambio |
|---|--------|--------|
| H1 | ✅ Corregido | `esc()` en todo lo que se inserta con `innerHTML`; los botones usan `data-id` con un solo manejador de clics en lugar de `onclick` armado como texto |
| H4 | ✅ Corregido | `XLSX.read(..., {raw:true})` en CSV. Probado: `05/03/2024` ahora se lee como 5 de marzo |
| H5 | ⚠ Parcial | Chart.js ahora carga con firma de integridad (SRI). SheetJS se actualizó a 0.20.3 (`cdn.sheetjs.com`), **pero sin SRI**: el CDN no fue accesible desde el entorno de trabajo para calcular la firma. Está pendiente agregarla, o bien hospedar el archivo junto al HTML |
| H8 | ✅ Corregido | `fin < hoy`: el día de Fecha Fin la incapacidad sigue "Activa" |
| H12 | ✅ Corregido | El Excel exportado respeta el filtro de planta en "Incapacidades activas" |
| — | ✅ Adicional | Los IDs se normalizan a texto (los que vienen de Sheets como número ya no rompen editar y eliminar), y el modo local también pasa por la normalización |

### Backend `Code.gs`
| Hallazgo | Estado |
|----------|--------|
| B1. El token estaba escrito en el código y el repositorio es **público** | ✅ Ahora se lee de *Propiedades de la secuencia de comandos* (`TOKEN_ACCESO`). **El token anterior se compartió fuera de la hoja y debe rotarse** |
| B2. Sin bloqueo: dos "reemplazar" simultáneos pueden intercalar el borrado y la escritura y dejar la hoja corrupta | ✅ Se agregó `LockService` (espera de 30 s) |
| B3. `FechaCaptura` se sobrescribe con la fecha actual en cada "reemplazar" y en cada edición, así que se pierde la fecha real de captura | Pendiente (mediano plazo, junto con H6/H7) |
| B4. Las lecturas (GET) exitosas de datos de salud no quedan en la bitácora | Pendiente. Recomendado para trazabilidad (deber de seguridad, LFPDPPP) |
| B5. La bitácora no identifica **quién** hizo la acción (solo hay token compartido) | Pendiente. Con despliegue restringido al dominio, se puede usar `Session.getActiveUser()` |
| B6. El token sigue viajando en la URL del GET (H2) | Pendiente (requiere cambiar frontend y backend a la vez) |

## 8. Estado de correcciones (ronda 2)

| # | Estado | Cambio |
|---|--------|--------|
| H2 / B6 | ✅ Corregido | Las lecturas van por POST (`accion:'leer'`) con el token en el cuerpo; `doGet` quedó deshabilitado |
| H3 | ✅ Corregido | Con backend conectado, la copia local se borra y ya no se escribe. Solo existe en modo sin backend. Si el backend no responde, **no** se muestran copias viejas |
| H6 | ✅ Corregido | Todo guardado espera la confirmación de Sheets (`ok:true`). Si falla, la pantalla no cambia y el modal queda abierto para reintentar |
| H6-bis | ✅ Nuevo control | Sin una lectura válida de Sheets, se bloquean las escrituras (evita que una carga "agregar" sobre una lista vacía borre la hoja) |
| B3 | ✅ Corregido | `FechaCaptura` se conserva en ediciones y cargas; solo los registros nuevos reciben la fecha actual |
| B4 | ✅ Corregido | Las lecturas exitosas quedan en `Log_Accesos` |
| H7 | ⚠ Parcial | Con el bloqueo (B2) y la escritura condicionada a la confirmación, ya no se corrompe la hoja, pero las cargas siguen enviando la hoja completa. Si dos usuarios trabajan a la vez, gana el último en guardar. Pendiente: guardar solo los cambios (deltas) |
| B5 | Pendiente | Identificar al usuario en la bitácora (requiere despliegue restringido al dominio) |

**Compatibilidad:** esta versión del dashboard **no funciona con el `Code.gs` anterior** (lee por POST), y el `Code.gs` nuevo rechaza al dashboard anterior (lee por GET). Deben publicarse juntos.

## 9. Estado de correcciones (ronda 3)

| # | Estado | Cambio |
|---|--------|--------|
| — | ✅ Corregido (PR #2) | Un error del backend al leer ya no se muestra como "Conectado"; aparece la causa y la solución |
| H9 | ✅ Corregido | Los días de cada registro se reparten entre los meses y años calendario que cubre `[FechaInicio, FechaFin]`. Si Días no coincide con el rango, se reparte en proporción y se conserva el total capturado. Sin Fecha Fin válida (o con un rango mayor a 10 años), todo va al mes de inicio. Los **casos** se siguen contando en el mes de su fecha de inicio (registro INICIAL) |

**Impacto en los indicadores:** a partir de esta versión, los "Días perdidos" de cada año pueden cambiar respecto a los reportes anteriores. Las incapacidades que cruzan de año pasan una parte de sus días al año siguiente. El total histórico no cambia. Esto alinea el dashboard con el periodo anual de la siniestralidad (LSS art. 72; revisión anual, LSS art. 74).
| H10 | ✅ Corregido | "Agregar / actualizar" reconoce el registro por **Folio** (sin distinguir mayúsculas ni espacios) y, si no tiene folio, por código + fecha de inicio + fecha fin + tipo. Los registros existentes **se actualizan** conservando su ID y FechaCaptura; los idénticos se cuentan como "sin cambios"; los repetidos dentro del archivo se reportan. Al terminar se muestra un resumen (nuevos, actualizados, sin cambios, repetidos). Volver a cargar el mismo archivo ya no duplica días |
