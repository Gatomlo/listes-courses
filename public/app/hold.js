// Appui long (0,5 s) sur un element [data-hold="action"] : declenche l'action avec ses data-*.
// Le clic qui suit l'appui long est ignore ; le menu contextuel du navigateur est supprime.
let h = null, swallow = false;
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-hold]');
  if (!el) return;
  h = { el, x: e.clientX, y: e.clientY, t: setTimeout(() => {
    if (!h) return;
    const b = document.createElement('button');
    for (const [k, v] of Object.entries(el.dataset)) if (k !== 'hold' && k !== 'a') b.dataset[k] = v;
    b.dataset.a = el.dataset.hold;
    b.hidden = true;
    document.body.appendChild(b);
    h = null;
    b.click(); b.remove();
    swallow = true; setTimeout(() => { swallow = false; }, 700);
    if (navigator.vibrate) navigator.vibrate(15);
  }, 500) };
});
const stop = () => { if (h) { clearTimeout(h.t); h = null; } };
document.addEventListener('pointermove', (e) => { if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) stop(); });
document.addEventListener('pointerup', stop);
document.addEventListener('pointercancel', stop);
document.addEventListener('click', (e) => { if (swallow && e.target.closest('[data-hold]')) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
