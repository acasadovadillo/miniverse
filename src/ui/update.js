// El aviso de versión nueva: «Hay una versión nueva del juego: recarga la página», con un botón que guarda y recarga.
// Va por encima de todo (del menú y de la partida), como el aviso de index.html cuando el código no llega.
// later: si se puede dejar para luego (lo publicado, mientras se juega solo); sin él, solo se puede recargar o cerrarlo
// y quedarse en el menú. reload: lo que hace el botón (guardar y recargar)
const $ = id => document.getElementById(id);

export function showUpdateNotice({ detail = '', later = false, reload }) {
  let box = $('update-notice');
  if (!box) {
    box = document.createElement('div');
    box.id = 'update-notice';
    box.style.cssText = 'position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,8,6,.72)';
    box.innerHTML = '<div class="panel" style="max-width:460px;padding:18px 22px;text-align:center;color:var(--cream);font-size:18px">'
      + '<p style="margin:0;font-size:21px;color:var(--gold)">Hay una versión nueva del juego: recarga la página</p>'
      + '<p id="update-detail" style="margin:10px 0 0;font-size:15px;line-height:1.35;color:var(--dim)"></p>'
      + '<div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap">'
      + '<button type="button" class="btn primary" id="update-reload" style="padding:8px 18px;font-size:18px;cursor:pointer">Recargar</button>'
      + '<button type="button" class="btn" id="update-later" style="padding:8px 18px;font-size:18px;cursor:pointer"></button></div></div>';
    document.body.append(box);
  }
  $('update-detail').textContent = detail;
  $('update-detail').hidden = !detail;
  $('update-later').textContent = later ? 'Ahora no' : 'Cerrar';
  const btn = $('update-reload');
  btn.disabled = false; btn.textContent = 'Recargar';
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Guardando…';
    try { await reload?.(); } catch (e) { console.error(e); }
    location.reload();
  };
  $('update-later').onclick = () => box.remove();
  document.exitPointerLock?.();   // (en primera persona, para poder pulsar los botones)
  return box;
}
export const updateNoticeOpen = () => !!$('update-notice');
