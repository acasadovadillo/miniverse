// Los interruptores de la dirección, en un solo sitio y con una sola regla, para comparar en el mismo código lo de
// ahora con lo de antes (el banco, las pruebas a mano, F3):
//   ?<parte>=0      esa parte, como estaba antes de mejorarla
//   ?<parte>=<otro> para mirarla (solo donde se dice: ?contacto=ver, ?contacto=rojo)
// Las partes: hierba (todas las hojas a cualquier distancia), impostores (los árboles sencillos de lejos), relieve (sin
// guardarlo en el navegador), contacto (sin sombra de contacto), sombras (todo el mapa cada dos fotogramas), personas
// (todas a todo, sin dormidas ni detalle de lejos) y suelo (el de antes del 2026-11-10). Los nombres de antes siguen
// valiendo: ?hierba=sinlod, ?sombras=todas, ?personas=todas, ?suelo=v2. Aparte, ?q=low (menos calidad) y
// ?relieve-max=N (cuántos bloques del relieve se guardan), que no son volver a lo de antes.
// También en los hilos: cada uno lee la dirección con la que se creó (terrain.js le pasa al del suelo lo que le toca)
const RAW = (() => { try { return new URLSearchParams(globalThis.location?.search || ''); } catch { return new URLSearchParams(); } })();
// (cada parte, con el valor que tenía antes para lo mismo)
export const PARTES = { hierba: 'sinlod', impostores: null, relieve: null, contacto: null, sombras: 'todas', personas: 'todas', suelo: 'v2' };

// El valor tal cual (o null)
export const opcion = k => RAW.get(k);
// ¿Está esta parte como antes?
export const apagada = parte => { const v = RAW.get(parte); return v !== null && (v === '0' || v === PARTES[parte]); };
// Las que están como antes (para F3 y el banco)
export const apagadas = () => Object.keys(PARTES).filter(apagada);
// Lo que hay que pasarle a un hilo para que vea lo mismo: '&parte=0' por cada una de las que le tocan
export const paraHilo = partes => partes.filter(apagada).map(p => `&${p}=0`).join('');
