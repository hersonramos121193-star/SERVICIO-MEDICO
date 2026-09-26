/**
 * DASHBOARD SERVICIO MÉDICO - METELMEX
 * Backend Google Apps Script
 * -------------------------------------------------
 * VERSIÓN CON CONTROL DE ACCESO (TOKEN) + BITÁCORA
 * -------------------------------------------------
 * - Todas las peticiones van por POST con el token en el cuerpo JSON
 *   (lecturas: accion='leer'). GET queda deshabilitado para que el token
 *   no viaje en la URL. Sin token válido se rechaza sin tocar las hojas.
 * - Las lecturas exitosas también quedan en la bitácora.
 * - FechaCaptura conserva la fecha original en ediciones y cargas.
 * - La hoja "Log_Accesos" registra cada escritura exitosa y cada intento
 *   rechazado por token inválido.
 * - Las escrituras se serializan con LockService para que dos capturistas
 *   no intercalen un "reemplazar" (borrar + escribir) sobre la misma hoja.
 *
 * TOKEN (ya NO va escrito en este archivo, el repositorio es público):
 * - En el editor de Apps Script: Configuración del proyecto (⚙) >
 *   Propiedades de la secuencia de comandos > Agregar propiedad
 *     Propiedad: TOKEN_ACCESO
 *     Valor:     una cadena larga y aleatoria (p. ej. Utilities.getUuid())
 * - Ese mismo valor se captura en el dashboard (⚙ Configuración).
 * - Si la propiedad no existe, el backend rechaza todas las peticiones.
 * - Es un freno contra accesos casuales/automatizados, no una autenticación
 *   real. Para datos de salud (Incapacidades) se recomienda además restringir
 *   "Quién tiene acceso" del despliegue a "Cualquier usuario dentro de tu
 *   organización" si usan Google Workspace.
 * -------------------------------------------------
 * INSTALACIÓN:
 * 1. Extensiones > Apps Script > pega este archivo completo.
 * 2. Crea la propiedad TOKEN_ACCESO (ver arriba).
 * 3. Ejecuta `inicializarHojas` una vez y autoriza permisos.
 * 4. Implementar > Gestionar implementaciones > editar > Nueva versión
 *    (así se conserva la misma URL /exec).
 * -------------------------------------------------
 */

const SHEET_INCAPACIDADES = 'Incapacidades';
const SHEET_EMPLEADOS = 'Empleados';
const SHEET_LOG = 'Log_Accesos';

const HEADERS_INCAPACIDADES = [
  'ID', 'Codigo', 'Nombre', 'Puesto', 'Planta', 'TipoRegistro',
  'Incapacidad', 'FechaInicio', 'FechaFin', 'FechaAlta', 'Dias',
  'Folio', 'Telefono', 'IMSS', 'Estatus', 'FechaCaptura'
];

const HEADERS_EMPLEADOS = [
  'Codigo', 'Nombre', 'Puesto', 'Depto', 'Planta', 'NSS', 'Telefono',
  'FechaIngreso', 'Estatus', 'Notas'
];

const HEADERS_LOG = ['Fecha', 'Tipo', 'Accion', 'Resultado', 'Detalle'];

function inicializarHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  crearHojaSiNoExiste_(ss, SHEET_INCAPACIDADES, HEADERS_INCAPACIDADES);
  crearHojaSiNoExiste_(ss, SHEET_EMPLEADOS, HEADERS_EMPLEADOS);
  crearHojaSiNoExiste_(ss, SHEET_LOG, HEADERS_LOG);
}

function crearHojaSiNoExiste_(ss, nombre, headers) {
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(headers);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/**
 * Valida el token recibido contra la propiedad TOKEN_ACCESO del script.
 */
function tokenValido_(token) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN_ACCESO');
  return typeof esperado === 'string' && esperado.length > 0 &&
         typeof token === 'string' && token === esperado;
}

/**
 * Escribe una fila en la bitácora de accesos. Nunca debe interrumpir
 * el flujo principal si algo falla al escribir el log.
 */
function registrarAcceso_(tipo, accion, resultado, detalle) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = crearHojaSiNoExiste_(ss, SHEET_LOG, HEADERS_LOG);
    hoja.appendRow([new Date(), tipo, accion || '', resultado, detalle || '']);
  } catch (err) {
    // Silencioso a propósito: un fallo en el log no debe tumbar la petición.
  }
}

function respuestaNoAutorizada_(tipo, accion) {
  registrarAcceso_(tipo, accion, 'RECHAZADO', 'Token inválido o ausente');
  return respuestaJSON_({ ok: false, error: 'No autorizado' });
}

/**
 * Las lecturas ya no se aceptan por GET: el token quedaría en la URL
 * (historial del navegador, registros de ejecución, proxys). Se leen con
 * POST { accion: 'leer', tipo: 'todo' | 'incapacidades' | 'empleados', token }.
 */
function doGet(e) {
  registrarAcceso_('GET', (e.parameter.accion || ''), 'RECHAZADO', 'Lectura por GET deshabilitada; usar POST accion=leer');
  return respuestaJSON_({ ok: false, error: 'Lectura por GET deshabilitada. Actualiza el dashboard.' });
}

function leerDatos_(accion) {
  let payload;
  if (accion === 'incapacidades') {
    payload = { incapacidades: leerHoja_(SHEET_INCAPACIDADES, HEADERS_INCAPACIDADES) };
  } else if (accion === 'empleados') {
    payload = { empleados: leerHoja_(SHEET_EMPLEADOS, HEADERS_EMPLEADOS) };
  } else {
    payload = {
      incapacidades: leerHoja_(SHEET_INCAPACIDADES, HEADERS_INCAPACIDADES),
      empleados: leerHoja_(SHEET_EMPLEADOS, HEADERS_EMPLEADOS)
    };
  }
  return payload;
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    registrarAcceso_('POST', 'desconocida', 'RECHAZADO', 'Body no es JSON válido');
    return respuestaJSON_({ ok: false, error: 'Solicitud inválida' });
  }

  const accion = body.accion;
  const token = body.token;

  if (!tokenValido_(token)) {
    return respuestaNoAutorizada_('POST', accion);
  }

  // Lectura: no necesita bloqueo. Se registra en bitácora (trazabilidad de consultas a datos de salud).
  if (accion === 'leer') {
    try {
      const tipo = body.tipo || 'todo';
      const payload = leerDatos_(tipo);
      registrarAcceso_('POST', 'leer', 'OK', 'tipo=' + tipo);
      return respuestaJSON_(payload);
    } catch (err) {
      registrarAcceso_('POST', 'leer', 'ERROR', String(err));
      return respuestaJSON_({ ok: false, error: String(err) });
    }
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    registrarAcceso_('POST', accion, 'ERROR', 'Hoja ocupada por otra escritura');
    return respuestaJSON_({ ok: false, error: 'Otra captura está guardando. Intenta de nuevo en unos segundos.' });
  }

  try {
    if (accion === 'guardarIncapacidades') {
      guardarIncapacidades_(body.registros, body.modo || 'reemplazar');
      registrarAcceso_('POST', accion, 'OK', (body.registros || []).length + ' registros, modo=' + (body.modo || 'reemplazar'));
      return respuestaJSON_({ ok: true });
    }

    if (accion === 'guardarEmpleados') {
      guardarEmpleados_(body.registros, body.modo || 'reemplazar');
      registrarAcceso_('POST', accion, 'OK', (body.registros || []).length + ' registros, modo=' + (body.modo || 'reemplazar'));
      return respuestaJSON_({ ok: true });
    }

    if (accion === 'upsertIncapacidad') {
      upsertFila_(SHEET_INCAPACIDADES, HEADERS_INCAPACIDADES, body.registro, 'ID');
      registrarAcceso_('POST', accion, 'OK', 'ID=' + (body.registro ? body.registro.ID : ''));
      return respuestaJSON_({ ok: true });
    }

    if (accion === 'eliminarIncapacidad') {
      eliminarFila_(SHEET_INCAPACIDADES, HEADERS_INCAPACIDADES, 'ID', body.id);
      registrarAcceso_('POST', accion, 'OK', 'ID=' + body.id);
      return respuestaJSON_({ ok: true });
    }

    if (accion === 'upsertEmpleado') {
      upsertFila_(SHEET_EMPLEADOS, HEADERS_EMPLEADOS, body.registro, 'Codigo');
      registrarAcceso_('POST', accion, 'OK', 'Codigo=' + (body.registro ? body.registro.Codigo : ''));
      return respuestaJSON_({ ok: true });
    }

    if (accion === 'eliminarEmpleado') {
      eliminarFila_(SHEET_EMPLEADOS, HEADERS_EMPLEADOS, 'Codigo', body.codigo);
      registrarAcceso_('POST', accion, 'OK', 'Codigo=' + body.codigo);
      return respuestaJSON_({ ok: true });
    }

    registrarAcceso_('POST', accion, 'RECHAZADO', 'Acción no reconocida');
    return respuestaJSON_({ ok: false, error: 'Acción no reconocida: ' + accion });
  } catch (err) {
    registrarAcceso_('POST', accion, 'ERROR', String(err));
    return respuestaJSON_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function leerHoja_(nombre, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = crearHojaSiNoExiste_(ss, nombre, headers);
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return [];
  const datos = hoja.getRange(2, 1, ultimaFila - 1, headers.length).getValues();
  return datos.map(fila => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = fila[i]; });
    return obj;
  }).filter(obj => Object.values(obj).some(v => v !== '' && v !== null));
}

function guardarIncapacidades_(registros, modo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = crearHojaSiNoExiste_(ss, SHEET_INCAPACIDADES, HEADERS_INCAPACIDADES);
  if (modo === 'reemplazar') {
    limpiarHoja_(hoja, HEADERS_INCAPACIDADES);
  }
  const ahora = new Date();
  // FechaCaptura: se conserva la original; solo los registros nuevos reciben la fecha actual
  const filas = registros.map(r => HEADERS_INCAPACIDADES.map(h => h === 'FechaCaptura' ? fechaCaptura_(r[h], ahora) : (r[h] !== undefined ? r[h] : '')));
  if (filas.length) {
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, HEADERS_INCAPACIDADES.length).setValues(filas);
  }
}

function guardarEmpleados_(registros, modo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = crearHojaSiNoExiste_(ss, SHEET_EMPLEADOS, HEADERS_EMPLEADOS);
  if (modo === 'reemplazar') {
    limpiarHoja_(hoja, HEADERS_EMPLEADOS);
  }
  const filas = registros.map(r => HEADERS_EMPLEADOS.map(h => r[h] !== undefined ? r[h] : ''));
  if (filas.length) {
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, HEADERS_EMPLEADOS.length).setValues(filas);
  }
}

/**
 * Convierte la FechaCaptura recibida (llega como texto ISO desde el dashboard)
 * a Date; si no viene o no es válida, usa el valor por defecto.
 */
function fechaCaptura_(valor, porDefecto) {
  if (!valor) return porDefecto;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? porDefecto : d;
}

function limpiarHoja_(hoja, headers) {
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila > 1) {
    hoja.getRange(2, 1, ultimaFila - 1, headers.length).clearContent();
  }
}

function upsertFila_(nombreHoja, headers, registro, campoClave) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = crearHojaSiNoExiste_(ss, nombreHoja, headers);
  const ultimaFila = hoja.getLastRow();
  const idxClave = headers.indexOf(campoClave);
  let filaEncontrada = -1;

  if (ultimaFila >= 2) {
    const claves = hoja.getRange(2, idxClave + 1, ultimaFila - 1, 1).getValues();
    for (let i = 0; i < claves.length; i++) {
      if (String(claves[i][0]) === String(registro[campoClave])) {
        filaEncontrada = i + 2;
        break;
      }
    }
  }

  const fila = headers.map(h => {
    if (h === 'FechaCaptura') return fechaCaptura_(registro[h], new Date());
    return registro[h] !== undefined ? registro[h] : '';
  });

  if (filaEncontrada > -1) {
    hoja.getRange(filaEncontrada, 1, 1, headers.length).setValues([fila]);
  } else {
    hoja.appendRow(fila);
  }
}

function eliminarFila_(nombreHoja, headers, campoClave, valor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = crearHojaSiNoExiste_(ss, nombreHoja, headers);
  const ultimaFila = hoja.getLastRow();
  const idxClave = headers.indexOf(campoClave);
  if (ultimaFila < 2) return;
  const claves = hoja.getRange(2, idxClave + 1, ultimaFila - 1, 1).getValues();
  for (let i = 0; i < claves.length; i++) {
    if (String(claves[i][0]) === String(valor)) {
      hoja.deleteRow(i + 2);
      break;
    }
  }
}

function respuestaJSON_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
