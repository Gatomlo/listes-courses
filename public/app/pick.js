// Toute liste déroulante (<select>) s'ouvre en panneau avec recherche : le <select> reste dans la page
// (valeur, formulaires, gestionnaires « change » inchangés), seul son menu natif est remplacé.
import { esc } from './ui.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let ov = null;

function close() { ov?.remove(); ov = null; }

function open(sel) {
  close();
  const opts = [...sel.querySelectorAll('option')].map((o, i) => ({ i, label: o.textContent.trim(), group: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '', off: o.disabled, on: o.selected }));
  const label = sel.getAttribute('aria-label') || sel.closest('label')?.querySelector('.muted')?.textContent || '';
  const searchable = opts.length > 5;
  const rows = (q) => {
    const n = norm(q).trim();
    let last = null;
    const html = opts.filter((o) => !o.off && (!n || norm(o.label).includes(n))).map((o) => {
      const g = o.group && o.group !== last ? `<div class="sec">${esc(o.group)}</div>` : '';
      last = o.group || last;
      return `${g}<button type="button" class="item click" data-pk="${o.i}"><span class="grow">${esc(o.label) || '—'}</span>${o.on ? '✓' : ''}</button>`;
    }).join('');
    return html || '<p class="muted" style="padding:12px 14px;margin:0">Aucun résultat.</p>';
  };
  ov = document.createElement('div');
  ov.className = 'pick-ov';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    ${label ? `<h3>${esc(label)}</h3>` : ''}
    ${searchable ? '<div class="search" style="margin:10px 0"><input class="txt" placeholder="Rechercher…" autocomplete="off" data-pq></div>' : ''}
    <div class="group fs-list" data-pl>${rows('')}</div></div>`;
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pk]');
    if (b) {
      sel.selectedIndex = Number(b.dataset.pk);
      close();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (e.target === ov) close();
  });
  ov.addEventListener('input', (e) => { if (e.target.matches('[data-pq]')) ov.querySelector('[data-pl]').innerHTML = rows(e.target.value); });
  document.body.appendChild(ov);
  const inp = ov.querySelector('[data-pq]');
  if (inp && matchMedia('(min-width: 900px)').matches) inp.focus();
  else if (inp) inp.focus();
}

const target = (e) => { const s = e.target.closest?.('select'); return s && !s.disabled && !s.hidden && !s.multiple ? s : null; };
// Capture : le menu natif ne doit jamais s'ouvrir.
for (const t of ['mousedown', 'pointerdown']) document.addEventListener(t, (e) => { if (target(e)) e.preventDefault(); }, true);
document.addEventListener('click', (e) => { const s = target(e); if (s) { e.preventDefault(); open(s); } }, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ov) { close(); e.stopPropagation(); return; }
  const s = target(e);
  if (s && [' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(s); }
}, true);
