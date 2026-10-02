// Menu : planning des repas (jours x creneaux ; grille semaine sur PC), ajout d'un plat
// avec ingredients en reserve, fiche repas, export / impression, lien d'affichage.
import { esc, fmtDate, on, sheet, closeSheet, confirmSheet, toast, isPc } from './ui.js';
import { get, post, patch, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadHouse } from './state.js';
import { SLOT, loadDishes, recipeSheet, newDishFrom, chosenOf, dishIngredients } from './plats.js';

const SLOTS = ['pdj', 'midi', 'soir', 'coll'];
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const extra = () => { try { return localStorage.getItem('cabas-menu-extra') === '1'; } catch { return false; } };
const slotsShown = () => SLOTS.filter((s) => extra() || s === 'midi' || s === 'soir');

let menu = null; // { from, to, period: { id, start, end, saved }, meals, lists }
export async function loadMenu() {
  menu = await get(hp(`/menu?at=${S.menuAt || today()}`));
  if (!S.dishes) await loadDishes();
  // Retour apres creation d'un plat depuis le menu : on reprend l'ajout du repas.
  const r = S.dishReturn;
  S.dishReturn = null;
  if (r && r.dish_id) { pm = { date: r.date, slot: r.slot, dish_id: r.dish_id, persons: 4, skip: [] }; setTimeout(stockSheet); }
}
const mealAt = (d, s) => menu.meals.find((m) => m.date === d && m.slot === s && !m.suggestion) || menu.meals.find((m) => m.date === d && m.slot === s);
const shopDay = (d) => menu.lists.some((l) => l.date === d);

function mealBtn(m) {
  const drag = isManager() && !m.suggestion ? `${isPc() ? ' draggable="true"' : ''} data-drag="${m.id}"` : '';
  return `<button class="meal${m.suggestion ? ' pending' : ''}"${drag} data-a="meal-open" data-id="${m.id}" data-date="${m.date}">${m.has_recipe ? '📖 ' : ''}${esc(m.dish)}${m.persons !== 4 ? ` · ${m.persons} p.` : ''}${m.suggestion ? ' <span class="pill p-carrot">suggéré</span>' : ''}</button>`;
}
const addBtn = (d, s) => `<button class="add" data-a="meal-add" data-date="${d}" data-slot="${s}" aria-label="Ajouter un plat">＋</button>`;

export function menuView() {
  const days = []; for (let d = menu.from; d <= menu.to; d = addDays(d, 1)) days.push(d);
  const slots = slotsShown(), p = menu.period, mgr = isManager();
  let body;
  if (isPc()) {
    // Tableaux de 7 jours depuis le premier jour du menu ; derniere ligne completee.
    const weeks = []; for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    const pad = (w, tag) => `<${tag} class="off"></${tag}>`.repeat(7 - w.length);
    body = weeks.map((w) => `<table class="wk"><tr><th></th>${w.map((d) => `<th class="${d === today() ? 'today' : ''}">${esc(fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }))}${shopDay(d) ? ' 🛒' : ''}</th>`).join('')}${pad(w, 'th')}</tr>
      ${slots.map((s) => `<tr><td class="sl">${SLOT[s]}</td>${w.map((d) => { const m = mealAt(d, s); return `<td data-drop="${d}" data-slot="${s}">${m ? mealBtn(m) : addBtn(d, s)}</td>`; }).join('')}${pad(w, 'td')}</tr>`).join('')}</table>`).join('')
      + (mgr ? '<p class="muted small">Glissez un repas vers un autre jour ou créneau pour le déplacer (si la case est occupée, les deux repas s’échangent).</p>' : '');
  } else {
    body = days.map((d) => `${shopDay(d) ? `<div class="sec">🛒 Courses du ${esc(fmtDate(d, { day: 'numeric', month: 'long' }))}</div>` : ''}
      <div class="day${d === today() ? ' today' : ''}"><div class="d"><span>${esc(fmtDate(d, { weekday: 'short' }))}</span><b>${new Date(d + 'T12:00').getDate()}</b></div>
      <div class="grow">${slots.map((s) => { const m = mealAt(d, s); return `<div class="slot" data-drop="${d}" data-slot="${s}"><span class="lbl">${SLOT[s]}</span>${m ? mealBtn(m) : addBtn(d, s)}</div>`; }).join('')}</div></div>`).join('');
    if (mgr) body = '<p class="muted small">Appui long sur un repas, puis glissez-le vers un autre créneau (si la case est occupée, les deux repas s’échangent).</p>' + body;
  }
  const range = `${esc(fmtDate(menu.from, { weekday: 'short', day: 'numeric', month: 'short' }))} → ${esc(fmtDate(menu.to, { weekday: 'short', day: 'numeric', month: 'short' }))}`;
  return {
    title: 'Menu', sub: 'Les plats alimentent la liste de leur période', right: '<a class="btn sm sec2" href="#/menu/export">🖨 Exporter</a>',
    body: `<div class="row"><button class="btn sm sec2" data-a="menu-nav" data-d="${addDays(menu.from, -1)}" aria-label="Menu précédent">‹</button>
      <div class="grow c"><b>${range}</b><span class="muted small block">${days.length} jours · ${p.saved ? 'menu enregistré' : 'période proposée'}</span></div>
      <button class="btn sm sec2" data-a="menu-nav" data-d="${addDays(menu.to, 1)}" aria-label="Menu suivant">›</button></div>
      <div class="row end wrap" style="margin:6px 0 4px">${!days.includes(today()) ? '<button class="btn sm sec2" data-a="menu-nav" data-d="">Aujourd’hui</button>' : ''}${mgr ? `<button class="btn sm sec2" data-a="menu-dates">📅 ${p.saved ? 'Modifier les dates' : 'Fixer les dates'}</button>` : ''}<button class="btn sm sec2" data-a="menu-extra">${extra() ? 'Masquer' : 'Afficher'} p.-déj. / collation</button></div>
      ${body}<a class="btn sec2 full" style="margin-top:12px" href="#/plats">📖 Tous les plats</a>`,
  };
}
on('click', 'menu-nav', async (el) => { S.menuAt = el.dataset.d || null; await loadMenu(); render(); });

// Dates du menu (gestionnaire) : fixer une periode proposee, modifier ou supprimer un menu.
const nDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
function datesSheet(start, end) {
  const n = start && end ? nDays(start, end) : 0;
  sheet(`<h3>📅 Dates du menu</h3>
    <div class="row gap"><label class="grow"><span class="muted">Du</span><input class="txt" type="date" name="start" value="${start}" data-ch="md-start"></label>
    <label class="grow"><span class="muted">Au</span><input class="txt" type="date" name="end" value="${end}" min="${start}" data-ch="md-end"></label></div>
    <p class="muted small">${n > 0 ? `${n} jour${n > 1 ? 's' : ''} : du ${esc(fmtDate(start, { weekday: 'long', day: 'numeric', month: 'long' }))} au ${esc(fmtDate(end, { weekday: 'long', day: 'numeric', month: 'long' }))}.` : 'La fin doit suivre le début.'}
      Le menu suivant est proposé à partir du lendemain. Durée et premier jour par défaut : Foyer → Réglages.</p>
    <div class="row end">${menu.period.saved ? '<button class="btn sec2 danger-t" data-a="md-del">Supprimer ce menu</button>' : ''}<button class="btn" data-a="md-save">Enregistrer</button></div>`);
}
const mdVal = () => { const s = document.querySelector('.sheet'); return { start: s.querySelector('[name=start]').value, end: s.querySelector('[name=end]').value }; };
on('click', 'menu-dates', () => datesSheet(menu.period.start, menu.period.end));
// Changer le debut garde la duree.
on('change', 'md-start', () => { const v = mdVal(); if (v.start) datesSheet(v.start, addDays(v.start, nDays(menu.period.start, menu.period.end) - 1)); });
on('change', 'md-end', () => { const v = mdVal(); if (v.start && v.end) datesSheet(v.start, v.end); });
on('click', 'md-save', async () => {
  const v = mdVal(), p = menu.period;
  const r = await attempt(() => (p.saved ? patch(hp(`/menus/${p.id}`), v) : post(hp('/menus'), v)));
  if (r) { closeSheet(); S.menuAt = r.start; toast('Dates du menu enregistrées'); await loadMenu(); render(); }
});
on('click', 'md-del', async () => {
  if (!(await confirmSheet({ title: 'Supprimer ce menu ?', text: 'Seules ses dates sont oubliées : les repas prévus restent au planning.', ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(hp(`/menus/${menu.period.id}`)))) { toast('Menu supprimé'); await loadMenu(); render(); }
});

// Glisser-deposer d'un repas (PC, gestionnaire) ; sur telephone : « Déplacer » dans la fiche repas.
let dragId = null;
const dropCell = (e) => dragId && e.target.closest && e.target.closest('[data-drop]');
const clearDrop = () => document.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
document.addEventListener('dragstart', (e) => {
  const b = e.target.closest && e.target.closest('[data-drag]');
  if (!b) return;
  dragId = b.dataset.drag;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
document.addEventListener('dragover', (e) => {
  const td = dropCell(e);
  if (!td) return;
  e.preventDefault();
  if (!td.classList.contains('drop-on')) { clearDrop(); td.classList.add('drop-on'); }
});
document.addEventListener('dragend', () => { dragId = null; clearDrop(); });
document.addEventListener('drop', async (e) => {
  const td = dropCell(e);
  if (!td) return;
  e.preventDefault();
  const id = dragId; dragId = null; clearDrop();
  const m = menu.meals.find((x) => x.id === Number(id));
  if (m && (m.date !== td.dataset.drop || m.slot !== td.dataset.slot)) await moveMeal(id, td.dataset.drop, td.dataset.slot);
});
// Telephone : appui long sur un repas, puis glisser du doigt vers un autre creneau.
// Le repas suit le doigt ; la page defile pres des bords ; lacher hors creneau annule.
const touch = { timer: null, id: null, ghost: null, target: null, y: 0, x0: 0, y0: 0, raf: 0, swallow: false };
function touchEnd() {
  clearTimeout(touch.timer); touch.timer = null;
  cancelAnimationFrame(touch.raf);
  if (touch.ghost) touch.ghost.remove();
  document.querySelectorAll('.drag-src').forEach((x) => x.classList.remove('drag-src'));
  clearDrop();
  touch.ghost = null; touch.target = null; touch.id = null;
}
function touchScroll() {
  const edge = 70, h = window.innerHeight;
  const v = touch.y < edge ? -(edge - touch.y) / 4 : touch.y > h - edge ? (touch.y - (h - edge)) / 4 : 0;
  if (v) window.scrollBy(0, v);
  touch.raf = requestAnimationFrame(touchScroll);
}
document.addEventListener('touchstart', (e) => {
  const b = e.target.closest && e.target.closest('[data-drag]');
  if (!b || isPc() || e.touches.length > 1) return;
  const t = e.touches[0];
  touch.x0 = t.clientX; touch.y0 = t.clientY;
  touch.timer = setTimeout(() => {
    touch.timer = null; touch.id = b.dataset.drag; touch.y = touch.y0; touch.swallow = true;
    const r = b.getBoundingClientRect();
    touch.ghost = b.cloneNode(true);
    touch.ghost.className += ' drag-ghost';
    Object.assign(touch.ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
    touch.ghost.dataset.dx = touch.x0 - r.left; touch.ghost.dataset.dy = touch.y0 - r.top;
    document.body.appendChild(touch.ghost);
    b.classList.add('drag-src');
    if (navigator.vibrate) navigator.vibrate(30);
    touch.raf = requestAnimationFrame(touchScroll);
  }, 400);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (touch.timer) {
    // Le doigt bouge avant l'appui long : c'est un defilement.
    if (Math.abs(t.clientX - touch.x0) > 8 || Math.abs(t.clientY - touch.y0) > 8) touchEnd();
    return;
  }
  if (!touch.ghost) return;
  e.preventDefault();
  touch.y = t.clientY;
  touch.ghost.style.left = `${t.clientX - touch.ghost.dataset.dx}px`;
  touch.ghost.style.top = `${t.clientY - touch.ghost.dataset.dy}px`;
  const under = document.elementFromPoint(t.clientX, t.clientY);
  const cell = under && under.closest('[data-drop]');
  if (cell !== touch.target) { clearDrop(); if (cell) cell.classList.add('drop-on'); touch.target = cell; }
}, { passive: false });
document.addEventListener('touchend', async () => {
  const id = touch.id, cell = touch.target;
  touchEnd();
  if (!id || !cell) return;
  const m = menu.meals.find((x) => x.id === Number(id));
  if (m && (m.date !== cell.dataset.drop || m.slot !== cell.dataset.slot)) await moveMeal(id, cell.dataset.drop, cell.dataset.slot);
});
document.addEventListener('touchcancel', touchEnd);
// Apres un glisser, le « clic » qui suit le lacher n'ouvre pas la fiche du repas.
document.addEventListener('click', (e) => { if (touch.swallow) { touch.swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('[data-drag]') && !isPc()) e.preventDefault(); });

async function moveMeal(id, date, slot) {
  const other = menu && date >= menu.from && date <= menu.to ? menu.meals.find((x) => x.date === date && x.slot === slot && !x.suggestion && x.id !== Number(id)) : null;
  if (await attempt(() => patch(hp(`/meals/${id}`), { date, slot }))) {
    toast(other ? `Échangé avec « ${other.dish} »` : 'Repas déplacé');
    afterChange();
  }
}
on('click', 'menu-extra', () => { try { localStorage.setItem('cabas-menu-extra', extra() ? '0' : '1'); } catch { /* ignore */ } render(); });

// ---------- Ajouter un repas ----------
let pm = null; // repas en preparation : { id?, date, slot, dish_id, persons, skip: [], options: [] }
function pickSheet() {
  const q = norm(pm.q || '');
  const list = S.dishes.filter((d) => !q || norm(d.name).includes(q));
  sheet(`<h3>${esc(fmtDate(pm.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[pm.slot]}</h3>
    <input class="txt" id="pick-q" placeholder="🔍 Rechercher un plat…" value="${esc(pm.q || '')}" data-in="pick-q">
    <div class="pick">${list.map((d) => `<button class="card click" data-a="pick-dish" data-id="${d.id}"><b>${esc(d.name)}</b><span class="muted block">${d.ingredients ? `${d.ingredients} ingrédient${d.ingredients > 1 ? 's' : ''}` : 'rappel seulement'}${d.last_date ? ` · dernière fois le ${esc(fmtDate(d.last_date))}` : ''}</span></button>`).join('') || '<p class="muted">Aucun plat.</p>'}</div>
    ${isManager() ? `<button class="btn sec2 full" data-a="pick-new">＋ Nouveau plat${pm.q ? ` « ${esc(pm.q)} »` : ''}</button>` : ''}`);
}
on('click', 'meal-add', (el) => { pm = { date: el.dataset.date, slot: el.dataset.slot, persons: 4, skip: [], q: '' }; pickSheet(); });
on('input', 'pick-q', (el) => { pm.q = el.value; pickSheet(); const i = document.getElementById('pick-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
on('click', 'pick-dish', (el) => { pm.dish_id = Number(el.dataset.id); stockSheet(); });
on('click', 'pick-new', () => { closeSheet(); newDishFrom(pm.q, { date: pm.date, slot: pm.slot }); });
on('click', 'close-nav', (el) => { closeSheet(); go(el.getAttribute('href')); });

// Depuis la fiche d'un plat : choix du jour et du creneau.
on('click', 'plan-dish', async (el) => {
  if (!menu) await loadMenu();
  pm = { dish_id: Number(el.dataset.id), date: today(), slot: 'soir', persons: 4, skip: [] };
  planSheet();
});
function planSheet() {
  sheet(`<h3>📅 Ajouter au menu</h3><label class="muted">Date</label><input class="txt" type="date" value="${pm.date}" min="${today()}" data-ch="pm-date">
    <div class="sec">Créneau</div><div class="seg">${SLOTS.map((s) => `<button class="${pm.slot === s ? 'on' : ''}" data-a="pm-slot" data-s="${s}">${SLOT[s]}</button>`).join('')}</div>
    <p class="muted small" id="pm-warn"></p>
    <div class="row end"><button class="btn" data-a="pm-next">Continuer : personnes et ingrédients</button></div>`);
  warnSlot();
}
async function warnSlot() {
  const r = await get(hp(`/menu?from=${pm.date}&days=1`)).catch(() => null);
  const m = r && r.meals.find((x) => x.slot === pm.slot && !x.suggestion);
  const w = document.getElementById('pm-warn');
  if (w) w.textContent = m ? `⚠ Créneau déjà occupé par « ${m.dish} »${isManager() ? ' : il sera remplacé.' : '.'}` : '';
}
on('change', 'pm-date', (el) => { pm.date = el.value; warnSlot(); });
on('click', 'pm-slot', (el) => { pm.slot = el.dataset.s; planSheet(); });
on('click', 'pm-next', () => stockSheet());

// Variantes, personnes et ingredients a acheter (decocher ce qui est encore en reserve).
async function stockSheet() {
  const d = pm.dish && pm.dish.id === pm.dish_id ? pm.dish : await attempt(() => get(hp(`/dishes/${pm.dish_id}`)));
  if (!d) return;
  pm.dish = d;
  pm.options = chosenOf(d, pm.options);
  const ing = dishIngredients(d, pm.options).filter((i) => !i.is_base);
  sheet(`<h3>${esc(d.name)}</h3><p class="muted">${esc(fmtDate(pm.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[pm.slot]}</p>
    ${d.groups.map((g) => `<div class="sec">${esc(g.name)}</div><div class="opt">${g.options.map((o) => `<button class="${pm.options.includes(o.id) ? 'on' : ''}" data-a="pm-opt" data-id="${o.id}">${esc(o.name)}</button>`).join('')}</div>`).join('')}
    <div class="row"><span class="grow">Personnes</span><button class="btn sm sec2" data-a="pm-p" data-d="-1">−</button><b class="w3 c" id="pm-persons">${pm.persons}</b><button class="btn sm sec2" data-a="pm-p" data-d="1">＋</button></div>
    ${ing.length ? `<div class="sec">Ingrédients à acheter</div><div class="row"><p class="muted small grow">Décocher ce qui est encore en réserve.</p>
      <button class="btn sm sec2" data-a="pm-all" data-on="${ing.every((i) => !pm.skip.includes(i.product_id)) ? '' : '1'}">${ing.every((i) => !pm.skip.includes(i.product_id)) ? 'Tout décocher' : 'Tout cocher'}</button></div>
      ${ing.map((i) => `<label class="row line"><input type="checkbox" class="cb" data-ch="pm-skip" data-pid="${i.product_id}" ${pm.skip.includes(i.product_id) ? '' : 'checked'}><span class="grow">${esc(i.name)}</span></label>`).join('')}`
      : '<p class="muted">Plat sans ingrédients détaillés : simple rappel dans la liste.</p>'}
    <div class="row end"><button class="btn" data-a="pm-save">${pm.id ? 'Enregistrer' : isManager() ? 'Ajouter au menu' : 'Suggérer ce plat'}</button></div>`);
}
on('click', 'pm-opt', (el) => {
  const id = Number(el.dataset.id), g = pm.dish.groups.find((x) => x.options.some((o) => o.id === id));
  pm.options = [...pm.options.filter((o) => !g.options.some((x) => x.id === o)), id];
  stockSheet();
});
// Tout cocher (rien en reserve) / tout decocher (tout en reserve).
on('click', 'pm-all', (el) => {
  const ids = dishIngredients(pm.dish, pm.options).filter((i) => !i.is_base).map((i) => i.product_id);
  pm.skip = el.dataset.on ? pm.skip.filter((x) => !ids.includes(x)) : [...new Set([...pm.skip, ...ids])];
  stockSheet();
});
on('click', 'pm-p', (el) => { pm.persons = Math.max(1, pm.persons + Number(el.dataset.d)); document.getElementById('pm-persons').textContent = pm.persons; });
on('change', 'pm-skip', (el) => {
  const pid = Number(el.dataset.pid);
  pm.skip = el.checked ? pm.skip.filter((x) => x !== pid) : [...pm.skip, pid];
  // Bouton « tout » mis a jour sans redessiner le panneau (garde le defilement).
  const all = document.querySelector('[data-a="pm-all"]'), none = !document.querySelector('[data-ch="pm-skip"]:not(:checked)');
  if (all) { all.dataset.on = none ? '' : '1'; all.textContent = none ? 'Tout décocher' : 'Tout cocher'; }
});
on('click', 'pm-save', async () => {
  const body = { date: pm.date, slot: pm.slot, dish_id: pm.dish_id, persons: pm.persons, skip: pm.skip, options: pm.options };
  const r = await attempt(() => (pm.id ? patch(hp(`/meals/${pm.id}`), { persons: pm.persons, skip: pm.skip, options: pm.options }) : post(hp('/meals'), body)));
  if (!r) return;
  closeSheet();
  toast(pm.id ? 'Repas mis à jour · liste recalculée' : isManager() ? `${pm.dish.name} ajouté · ingrédients ajoutés à la liste de la période` : 'Plat suggéré au gestionnaire');
  await afterChange();
});
async function afterChange() {
  S.dishes = null;
  await loadHouse();
  if (S.route[0] === 'menu') await loadMenu();
  else if (S.route[0] === 'plat') await (await import('./plats.js')).loadDish(S.route[1]);
  else if (S.route[0] === 'liste') await (await import('./listes.js')).loadList(S.route[1]);
  render();
}

// ---------- Fiche repas ----------
on('click', 'meal-open', async (el) => {
  const r = await attempt(() => get(hp(`/menu?from=${el.dataset.date}&days=1`)));
  const m = r && r.meals.find((x) => x.id === Number(el.dataset.id));
  if (m) mealSheet(m);
});
async function mealSheet(m) {
  const mgr = isManager();
  const lists = (await get(hp('/lists')).catch(() => ({ upcoming: [] }))).upcoming;
  sheet(`<h3>${esc(m.dish)}</h3><p class="muted">${esc(fmtDate(m.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[m.slot]}${m.suggestion ? ` · suggéré par ${esc(m.suggested_by_name || '?')}` : ''}</p>
    <div class="row"><span class="grow">Personnes</span><b>${m.persons}</b></div>
    ${m.skip.length ? `<p class="muted small">🥫 ${m.skip.length} ingrédient${m.skip.length > 1 ? 's' : ''} en réserve (non acheté${m.skip.length > 1 ? 's' : ''})</p>` : ''}
    ${mgr && !m.suggestion ? `<label class="row line"><span>Liste</span><select class="txt grow" data-ch="meal-list" data-id="${m.id}">
      <option value="">Automatique (période)</option>${lists.map((l) => `<option value="${l.id}" ${m.list_id === l.id ? 'selected' : ''}>Liste du ${esc(fmtDate(l.date))}</option>`).join('')}</select></label>` : ''}
    ${mgr && !m.suggestion ? `<div class="mv"><input class="txt" type="date" id="mv-date" value="${m.date}"><select class="txt" id="mv-slot">${SLOTS.map((s) => `<option value="${s}" ${s === m.slot ? 'selected' : ''}>${SLOT[s]}</option>`).join('')}</select>
      <button class="btn sec2 sm" data-a="meal-move" data-id="${m.id}">Déplacer</button></div>` : ''}
    <button class="btn full" style="margin-top:10px" data-a="meal-recipe" data-dish="${m.dish_id}" data-p="${m.persons}" data-o="${m.options.join(',')}">📖 ${m.has_recipe ? 'Voir la recette' : 'Ingrédients'}</button>
    <div class="acts">
      ${m.suggestion && mgr ? `<button class="btn sm" data-a="meal-accept" data-id="${m.id}">Accepter</button>` : ''}
      ${mgr && !m.suggestion ? `<button class="btn sec2 sm" data-a="meal-edit" data-id="${m.id}" data-date="${m.date}">${m.variant ? 'Variantes, personnes…' : 'Personnes et réserve'}</button><button class="btn sec2 sm" data-a="meal-change" data-id="${m.id}" data-date="${m.date}" data-slot="${m.slot}">Changer de plat</button><a class="btn sec2 sm" href="#/plats/${m.dish_id}" data-a="close-nav">Modifier le plat</a>` : ''}
      ${mgr || (m.suggestion && m.suggested_by === S.me.id) ? `<button class="btn sec2 sm danger-t" data-a="meal-del" data-id="${m.id}">${m.suggestion ? 'Refuser / retirer' : 'Retirer du menu'}</button>` : ''}
    </div>`);
}
on('click', 'meal-move', async (el) => {
  const date = document.getElementById('mv-date').value, slot = document.getElementById('mv-slot').value;
  if (!date) return;
  closeSheet();
  await moveMeal(el.dataset.id, date, slot);
});
on('click', 'meal-recipe', (el) => recipeSheet(Number(el.dataset.dish), Number(el.dataset.p), el.dataset.o.split(',').filter(Boolean).map(Number)));
on('change', 'meal-list', async (el) => {
  if (await attempt(() => patch(hp(`/meals/${el.dataset.id}`), { list_id: el.value }))) { toast('Repas rattaché · ingrédients déplacés'); closeSheet(); afterChange(); }
});
on('click', 'meal-accept', async (el) => { if (await attempt(() => post(hp(`/meals/${el.dataset.id}/accept`)))) { closeSheet(); toast('Plat ajouté au menu'); afterChange(); } });
on('click', 'meal-del', async (el) => {
  if (!(await confirmSheet({ title: 'Retirer ce repas ?', text: 'Ses ingrédients sont retirés de la liste (sauf ce qui a été ajouté à la main).', ok: 'Retirer', danger: true }))) return;
  if (await attempt(() => del(hp(`/meals/${el.dataset.id}`)))) { toast('Repas retiré'); afterChange(); }
});
on('click', 'meal-edit', async (el) => {
  const r = await attempt(() => get(hp(`/menu?from=${el.dataset.date}&days=1`)));
  const m = r && r.meals.find((x) => x.id === Number(el.dataset.id));
  if (!m) return;
  pm = { id: m.id, date: m.date, slot: m.slot, dish_id: m.dish_id, persons: m.persons, skip: [...m.skip], options: [...m.options] };
  stockSheet();
});
on('click', 'meal-change', (el) => {
  // Le nouveau plat remplace celui du creneau (ajout par un gestionnaire).
  pm = { date: el.dataset.date, slot: el.dataset.slot, persons: 4, skip: [], q: '' };
  if (!S.dishes) loadDishes().then(pickSheet); else pickSheet();
});

// ---------- Export / impression ----------
const ex = { range: 'menu', slots: { midi: true, soir: true }, persons: false, shop: true };
let exData = null;
export async function loadExport() {
  if (!menu) await loadMenu();
  let start = menu.from, days = ex.range === 'menu' ? nDays(menu.from, menu.to) : 7;
  if (ex.range === 'list') {
    const l = (await get(hp('/lists')).catch(() => ({ upcoming: [] }))).upcoming[0];
    if (l) { start = l.date; days = S.house.household.rhythm_days; }
  }
  exData = await get(hp(`/menu?from=${start}&days=${days}`));
}
function sheetHtml(d, household) {
  const days = []; for (let x = d.from; x <= d.to; x = addDays(x, 1)) days.push(x);
  const slots = SLOTS.filter((s) => ex.slots[s]);
  const shop = new Set((d.lists || []).map((l) => l.date).concat(d.shoppingDays || []));
  const meals = d.meals.filter((m) => !m.suggestion);
  const weeks = []; for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return `<div class="pm"><h1>Menu du ${esc(fmtDate(d.from, { day: 'numeric', month: 'long' }))} au ${esc(fmtDate(d.to, { day: 'numeric', month: 'long' }))}</h1>
    <div class="meta">${esc(household)}${ex.shop ? ' · 🛒 = jour de courses' : ''}</div>
    ${weeks.map((w) => `<table><tr><th></th>${w.map((x) => `<th>${esc(fmtDate(x, { weekday: 'short', day: 'numeric', month: 'short' }))}${ex.shop && shop.has(x) ? ' 🛒' : ''}</th>`).join('')}</tr>
      ${slots.map((s) => `<tr><td class="sl">${SLOT[s]}</td>${w.map((x) => { const m = meals.find((y) => y.date === x && y.slot === s); return `<td>${m ? esc(m.dish) + (ex.persons ? ` <span class="np">(${m.persons} p.)</span>` : '') : ''}</td>`; }).join('')}</tr>`).join('')}</table>`).join('')}
    <div class="foot"><span>Le Cabas</span><span>Imprimé le ${new Date().toLocaleDateString('fr-BE')}</span></div></div>`;
}
export function exportView() {
  const mgr = isManager(), token = S.house.menuToken;
  const link = token ? new URL(`#/affichage/${token}`, document.baseURI).href : null;
  return {
    title: 'Exporter le menu', back: '#/menu', sub: 'A4 paysage',
    body: `<div class="sec">Période</div><div class="opt">${[['menu', 'Menu affiché'], ['week', '7 jours'], ['list', 'Période de la prochaine liste']].map(([k, t]) => `<button class="${ex.range === k ? 'on' : ''}" data-a="ex-range" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="sec">Créneaux</div><div class="opt">${SLOTS.map((s) => `<button class="${ex.slots[s] ? 'on' : ''}" data-a="ex-slot" data-s="${s}">${SLOT[s]}</button>`).join('')}</div>
      <div class="sec">Options</div><div class="opt"><button class="${ex.persons ? 'on' : ''}" data-a="ex-opt" data-k="persons">Nb de personnes</button><button class="${ex.shop ? 'on' : ''}" data-a="ex-opt" data-k="shop">Jours de courses 🛒</button></div>
      <div class="sec">Aperçu</div><div id="print-src">${sheetHtml(exData, S.house.household.name)}</div>
      <div class="row end"><button class="btn" data-a="ex-print">🖨 Imprimer</button><button class="btn" data-a="ex-print" data-pdf="1">⬇ PDF</button></div>
      <div class="sec">Lien d'affichage</div><div class="card"><p class="muted small">Page en lecture seule, sans connexion, qui se met à jour toute seule (tablette de cuisine). Révocable.</p>
        ${link ? `<input class="txt" readonly value="${esc(link)}" id="share-url"><div class="row end"><button class="btn sec2" data-a="share-copy">🔗 Copier</button><a class="btn sec2" href="${esc(link)}" target="_blank" rel="noopener">Ouvrir</a>${mgr ? '<button class="btn sec2 danger-t" data-a="share" data-act="revoke">Révoquer</button>' : ''}</div>`
        : mgr ? '<button class="btn sec2" data-a="share">Créer le lien d’affichage</button>' : '<p class="muted">Aucun lien (à créer par un gestionnaire).</p>'}</div>`,
  };
}
on('click', 'ex-range', async (el) => { ex.range = el.dataset.k; await loadExport(); render(); });
on('click', 'ex-slot', (el) => { ex.slots[el.dataset.s] = !ex.slots[el.dataset.s]; render(); });
on('click', 'ex-opt', (el) => { ex[el.dataset.k] = !ex[el.dataset.k]; render(); });
on('click', 'ex-print', (el) => {
  let area = document.getElementById('print-area');
  if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
  area.innerHTML = document.getElementById('print-src').innerHTML;
  if (el.dataset.pdf) toast('Choisir « Enregistrer au format PDF » comme imprimante');
  setTimeout(() => window.print(), el.dataset.pdf ? 600 : 0);
});
on('click', 'share', async (el) => {
  const r = await attempt(() => post(hp('/menu-share'), { action: el.dataset.act }));
  if (r) { await loadHouse(); toast(r.token ? 'Lien d’affichage créé' : 'Lien révoqué'); render(); }
});
on('click', 'share-copy', async () => { const i = document.getElementById('share-url'); try { await navigator.clipboard.writeText(i.value); toast('Lien copié'); } catch { i.select(); } });

// ---------- Affichage public (sans connexion) ----------
let pub = null, pubTimer = null;
export async function loadPublic(token) {
  const res = await fetch(`api/public/menu/${encodeURIComponent(token)}`);
  pub = res.ok ? await res.json() : { error: (await res.json().catch(() => ({}))).error || 'Lien inconnu.' };
  clearInterval(pubTimer);
  pubTimer = setInterval(async () => { if (location.hash.startsWith('#/affichage/')) { await loadPublic(token); render(); } else clearInterval(pubTimer); }, 5 * 60 * 1000);
}
export function publicView() {
  if (!pub || pub.error) return { noNav: true, title: 'Menu', body: `<div class="card error">${esc(pub ? pub.error : 'Chargement…')}</div>` };
  const saved = { ...ex };
  Object.assign(ex, { slots: { midi: true, soir: true, pdj: extra(), coll: extra() }, persons: true, shop: true });
  const html = sheetHtml(pub, pub.household);
  Object.assign(ex, saved);
  return { noNav: true, wide: true, title: `Menu · ${pub.household}`, sub: 'Affichage en lecture seule · mis à jour toutes les 5 minutes', body: html };
}

export const resetMenu = () => { menu = null; };
