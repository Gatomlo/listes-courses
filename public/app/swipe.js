// Mode courses : balayer une ligne vers la gauche la fait glisser, « Retirer » apparait dessous.
let sw = null;
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.swipe-del')) return; // sinon la ligne se referme sur le bouton avant le clic
  const row = e.target.closest('.swipe > .item[data-swipe]');
  document.querySelectorAll('.swipe > .item.open').forEach((r) => { if (r !== row) { r.style.transform = ''; r.classList.remove('open'); } });
  if (!row) return;
  sw = { row, x: e.clientX, y: e.clientY, dx: 0, on: false, base: row.classList.contains('open') ? -96 : 0 };
});
document.addEventListener('pointermove', (e) => {
  if (!sw) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (!sw.on) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) { sw.on = true; sw.row.classList.add('dragging'); } else if (Math.abs(dy) > 10) { sw = null; return; } else return; }
  sw.dx = dx;
  sw.row.style.transform = `translateX(${Math.max(-96, Math.min(0, sw.base + dx))}px)`;
});
const endSwipe = () => {
  if (!sw) return;
  const { row, dx, base, on } = sw; sw = null;
  if (!on) return;
  row.classList.remove('dragging');
  const open = base + dx < -48;
  row.classList.toggle('open', open);
  row.style.transform = open ? 'translateX(-96px)' : '';
  row.dataset.swiped = '1'; setTimeout(() => delete row.dataset.swiped, 50);
};
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
// Un balayage ne doit pas cocher l'article.
document.addEventListener('click', (e) => { const r = e.target.closest('.swipe > .item'); if (r && r.dataset.swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
