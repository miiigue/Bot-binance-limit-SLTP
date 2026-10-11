/**
 * Utilidades de fecha y hora respetando la zona horaria del país de residencia del usuario.
 * Zona horaria por defecto: Argentina (America/Argentina/Buenos_Aires).
 */

export function getCountryTimezone(countryName) {
  if (!countryName) return 'America/Argentina/Buenos_Aires';
  const c = String(countryName).toLowerCase().trim();
  if (c.includes('colombia')) return 'America/Bogota';
  if (c.includes('mexic') || c.includes('méxic')) return 'America/Mexico_City';
  if (c.includes('chile')) return 'America/Santiago';
  if (c.includes('peru') || c.includes('perú')) return 'America/Lima';
  if (c.includes('espana') || c.includes('españa') || c.includes('spain')) return 'Europe/Madrid';
  if (c.includes('ecuador')) return 'America/Guayaquil';
  if (c.includes('venezuela')) return 'America/Caracas';
  if (c.includes('uruguay')) return 'America/Montevideo';
  if (c.includes('paraguay')) return 'America/Asuncion';
  if (c.includes('bolivia')) return 'America/La_Paz';
  if (c.includes('brazil') || c.includes('brasil')) return 'America/Sao_Paulo';
  if (c.includes('estados unidos') || c.includes('usa') || c.includes('us')) return 'America/New_York';
  return 'America/Argentina/Buenos_Aires';
}

export function formatShortDate(dateVal, countryName) {
  if (!dateVal) return '';
  try {
    let d;
    if (dateVal instanceof Date) {
      d = dateVal;
    } else {
      let str = String(dateVal).trim();
      if (!str.includes('T') && !str.includes('Z')) {
        str = str.replace(' ', 'T') + 'Z';
      }
      d = new Date(str);
      if (isNaN(d.getTime())) {
        d = new Date(String(dateVal).replace(' ', 'T'));
      }
    }
    if (isNaN(d.getTime())) return String(dateVal);

    const tz = getCountryTimezone(countryName);
    const formatter = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(d);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return `${map.day}/${map.month} ${map.hour}:${map.minute}`;
  } catch (e) {
    return String(dateVal);
  }
}

export function formatFullDateTime(dateVal, countryName) {
  if (!dateVal) return '';
  try {
    let d;
    if (dateVal instanceof Date) {
      d = dateVal;
    } else {
      let str = String(dateVal).trim();
      if (!str.includes('T') && !str.includes('Z')) {
        str = str.replace(' ', 'T') + 'Z';
      }
      d = new Date(str);
      if (isNaN(d.getTime())) {
        d = new Date(String(dateVal).replace(' ', 'T'));
      }
    }
    if (isNaN(d.getTime())) return String(dateVal);

    const tz = getCountryTimezone(countryName);
    const formatter = new Intl.DateTimeFormat('es-AR', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(d);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  } catch (e) {
    return String(dateVal);
  }
}
