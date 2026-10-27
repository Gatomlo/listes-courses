// Menu : planning des repas (jours x creneaux ; grille semaine sur PC), ajout d'un plat
// avec ingredients en reserve, fiche repas, export / impression, lien d'affichage.
import { esc, eur, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, isPc, localDay } from './ui.js';
import { get, post, put, patch, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadHouse } from './state.js';
import { SLOT, tagChips, allTags, loadDishes, newDishFrom, chosenOf, dishIngredients, tile, ppShort } from './plats.js';
import { I, btnI } from './icons.js';
import { ruleText, copyRules } from './modeles.js';

const SLOTS = ['pdj', 'midi', 'soir', 'coll'];
const today = () => localDay();
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Repas affiches (choix de l'appareil) ; ancien reglage « p.-dej. / collation » repris.
const SHOW_ORDER = ['pdj', 'midi', 'coll', 'soir'];
function slotsShown() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem('cabas-menu-slots')); } catch { /* ignore */ }
  if (!Array.isArray(v) || !v.length) {
    let extra = false;
    try { extra = localStorage.getItem('cabas-menu-extra') === '1'; } catch { /* ignore */ }
    v = extra ? SLOTS : ['midi', 'soir'];
  }
  return SHOW_ORDER.filter((s) => v.includes(s));
}

let menu = null; // { from, to, period: { id, start, end, saved }, meals, lists }
export async function loadMenu() {
  [menu, S.wishes] = await Promise.all([get(hp(`/menu?at=${S.menuAt || today()}`)), get(hp('/wishes')).catch(() => S.wishes || [])]);
  if (!S.dishes) await loadDishes();
  // Retour apres creation d'un plat depuis le menu : on reprend l'ajout du repas.
  const r = S.dishReturn;
  S.dishReturn = null;
  if (r && r.dish_id) { pm = { date: r.date, slot: r.slot, dish_id: r.dish_id, persons: 4, skip: [] }; setTimeout(stockSheet); }
}
const mealAt = (d, s) => menu.meals.find((m) => m.date === d && m.slot === s && !m.suggestion) || menu.meals.find((m) => m.date === d && m.slot === s);
const shopDay = (d) => menu.lists.some((l) => l.date === d);
const outAt = (d, s) => (menu.outings || []).find((o) => o.date === d && o.slot === s);

function mealBtn(m, label) {
  const drag = isManager() && !m.suggestion ? `${isPc() ? ' draggable="true"' : ''} data-drag="${m.id}"` : '';
  return `<button class="meal${m.suggestion ? ' pending' : ''}"${drag} data-a="meal-open" data-id="${m.id}" data-date="${m.date}">${label ? `<span class="sl">${SLOT[m.slot]}</span>` : ''}<span class="nm">${m.parts?.length ? I('puzzle', 's') + ' ' : ''}${esc(m.dish)}</span>${m.suggestion ? '<span class="pill p-carrot">suggéré</span>' : m.persons !== 4 ? `<span class="pill">${m.persons} p.</span>` : ''}</button>`;
}
// Repas a l'exterieur : mention a la place d'un plat (fiche : note, retirer).
export const outLabel = (o) => (o.rest ? `Restes${o.dish ? ` · ${o.dish}` : ''}` : 'À l’extérieur');
const outBtn = (o, label) => `<button class="meal out${o.rest ? ' rest' : ''}"${isManager() ? `${isPc() ? ' draggable="true"' : ''} data-drag="o${o.id}"` : ''} data-a="out-open" data-date="${o.date}" data-slot="${o.slot}">${label ? `<span class="sl">${SLOT[o.slot]}</span>` : ''}<span class="nm">${I(o.rest ? 'repeat' : 'pin', 's')} ${esc(outLabel(o))}${o.note ? `<span class="muted small block">${esc(o.note)}</span>` : ''}</span></button>`;
const cell = (d, s, label) => { const o = outAt(d, s), m = mealAt(d, s); return o ? outBtn(o, label) : m ? mealBtn(m, label) : addBtn(d, s, label); };
const addBtn = (d, s, label) => `<button class="add" data-a="meal-add" data-date="${d}" data-slot="${s}" aria-label="Ajouter un plat">${I('plus', 's')}${label ? ` ${SLOT[s]}` : ''}</button>`;

// Budget estime de la periode affichee (repas valides : personnes, variantes, produits en reserve).
// Pas dans l'export ni l'impression.
function budgetCard() {
  const c = menu.cost, ms = menu.meals.filter((m) => !m.suggestion && m.cost != null);
  if (!c || !menu.meals.some((m) => !m.suggestion)) return '';
  const persons = ms.reduce((n, m) => n + m.persons, 0);
  const note = c.partial ? ` · estimation partielle${c.unknown ? ` (${c.unknown} repas sans prix)` : ' (des ingrédients sans prix)'}` : '';
  // Sous-totaux par semaine (tranches de 7 jours depuis le debut de la periode) : chaque repas compte pour ses personnes.
  const weeks = [];
  for (const m of ms) {
    const k = Math.floor((Date.parse(m.date) - Date.parse(menu.from)) / 86400000 / 7);
    weeks[k] = (weeks[k] || 0) + m.cost;
  }
  const wk = weeks.length > 1 && S.q.budgetOpen ? `<div class="small" style="margin-top:8px;display:grid;gap:2px">${weeks.map((t, k) => (t == null ? '' : `<div class="row"><span class="grow muted">Semaine du ${esc(fmtDate(addDays(menu.from, 7 * k), { day: 'numeric', month: 'short' }))}</span><b class="price">${eur(t)}</b></div>`)).join('')}</div>` : '';
  return `<div class="card" style="margin:8px 0"><button class="row" style="gap:10px;width:100%;background:none;border:0;padding:0;text-align:left;color:inherit" data-a="budget-toggle" ${weeks.length > 1 ? '' : 'disabled'}><span class="ico leaf">${I('tag')}</span><span class="grow"><b>Budget estimé : ${c.partial ? 'dès ' : '≈ '}${eur(c.total)}</b>
    <span class="muted small block">${persons ? `≈ ${eur(Math.round(c.total / persons))} par personne et par repas` : ''}${note}</span></span>${weeks.length > 1 ? I(S.q.budgetOpen ? 'up' : 'down', 's') : ''}</button>${wk}</div>`;
}
on('click', 'budget-toggle', () => { S.q.budgetOpen = !S.q.budgetOpen; render(); });
export function menuView() {
  const days = []; for (let d = menu.from; d <= menu.to; d = addDays(d, 1)) days.push(d);
  const slots = slotsShown(), p = menu.period, mgr = isManager();
  let body;
  if (isPc()) {
    // Tableaux de 7 jours depuis le premier jour du menu ; derniere ligne completee.
    const weeks = []; for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    const pad = (w, tag) => `<${tag} class="off"></${tag}>`.repeat(7 - w.length);
    body = weeks.map((w) => `<table class="wk"><tr><th></th>${w.map((d) => `<th class="${d === today() ? 'today' : ''}">${esc(fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }))}${shopDay(d) ? ` <span class="shopday">${I('cart', 's')}</span>` : ''}</th>`).join('')}${pad(w, 'th')}</tr>
      ${slots.map((s) => `<tr><td class="sl">${SLOT[s]}</td>${w.map((d) => `<td data-drop="${d}" data-slot="${s}">${cell(d, s)}</td>`).join('')}${pad(w, 'td')}</tr>`).join('')}</table>`).join('')
      + (mgr ? '<p class="muted small">Glissez un repas vers un autre jour ou créneau pour le déplacer (si la case est occupée, les deux repas s’échangent).</p>' : '');
  } else {
    body = `<div class="agenda">${days.map((d) => `<div class="day${d === today() ? ' today' : ''}${d < today() ? ' past' : ''}"><div class="d"><span>${esc(fmtDate(d, { weekday: 'short' }).replace('.', ''))}</span><b>${new Date(d + 'T12:00').getDate()}</b></div>
      <div class="slots">${shopDay(d) ? `<span class="shopday">${I('cart', 's')} Courses</span>` : ''}${slots.map((s) => `<div class="slot" data-drop="${d}" data-slot="${s}">${cell(d, s, true)}</div>`).join('')}</div></div>`).join('')}</div>`;
    if (mgr) body += '<p class="muted small">Appui long sur un repas, puis glissez-le vers un autre créneau (si la case est occupée, les deux repas s’échangent).</p>';
  }
  const range = `${esc(fmtDate(menu.from, { weekday: 'short', day: 'numeric', month: 'short' }))} → ${esc(fmtDate(menu.to, { weekday: 'short', day: 'numeric', month: 'short' }))}`;
  return {
    title: 'Menu', sub: `${range} · ${p.saved ? 'menu enregistré' : 'période proposée'}`, large: true,
    // PC : actions dans la barre ; telephone : un bouton d'options.
    right: isPc() ? menuActions().map(([a, t, ic]) => `<button class="btn sm sec2" data-a="${a}">${I(ic, 's')} ${t}</button>`).join('') : `${mgr && menu.to >= today() ? `<button class="ib" data-a="menu-gen" aria-label="Générer le menu" title="Générer le menu">${I('spark')}</button>` : ''}<button class="ib" data-a="menu-export" aria-label="Exporter et partager">${I('share')}</button><button class="ib" data-a="menu-more" aria-label="Options du menu">${I('sliders')}</button>`,
    body: `<div class="row"><button class="btn sm sec2" data-a="menu-nav" data-d="${addDays(menu.from, -1)}" aria-label="Menu précédent">${I('back', 's')}</button>
      <div class="grow c"><b>${range}</b><span class="muted small block">${days.length} jours</span></div>
      <button class="btn sm sec2" data-a="menu-nav" data-d="${addDays(menu.to, 1)}" aria-label="Menu suivant">${I('chev', 's')}</button></div>
      ${budgetCard()}
      <div class="row end wrap" style="margin:6px 0 4px">${!days.includes(today()) ? '<button class="btn sm sec2" data-a="menu-nav" data-d="">Aujourd’hui</button>' : ''}</div>
      ${body}
      ${wishesHtml()}
      ${mgr ? acc('menu_notes', { icon: I('note'), title: 'Remarques', sum: menu.note ? ' · notées' : ' · aucune', def: 'closed', body: `<textarea class="txt" rows="3" maxlength="2000" placeholder="Remarques sur ce menu (imprimées avec l’export)" data-ch="menu-note">${esc(menu.note || '')}</textarea>` })
        : menu.note ? acc('menu_notes', { icon: I('note'), title: 'Remarques', def: 'closed', body: `<div class="card pre">${esc(menu.note)}</div>` }) : ''}`,
  };
}
// ---------- Envies de plats (sans date) ----------
function wishCard(w) {
  const mgr = isManager(), mine = w.created_by === S.me.id;
  const acts = [];
  if (mgr && w.status === 'pending' && !w.draft) acts.push(btnI('check', 'Valider l’envie', `data-a="wish-ok" data-id="${w.id}"`));
  if (w.draft && (mgr || w.draft_by === S.me.id)) acts.push(btnI('edit', mgr ? 'Créer la fiche (valide l’envie)' : 'Compléter la fiche', `href="#/plats/${w.dish_id}" data-a="dish-open-edit" data-id="${w.dish_id}"`, 'sec2', 'a'));
  else acts.push(btnI('book', 'Fiche du plat', `href="#/plats/${w.dish_id}"`, 'sec2', 'a'));
  acts.push(btnI('calendar', mgr ? 'Mettre au menu' : 'Suggérer au menu', `data-a="plan-dish" data-id="${w.dish_id}"`, ''));
  if (mgr || (mine && w.status === 'pending')) acts.push(btnI('x', mgr && w.status === 'pending' ? 'Refuser l’envie' : 'Retirer l’envie', `data-a="wish-del" data-id="${w.id}"`, 'sec2 danger-t'));
  // Gestionnaire : l'envie se glisse sur un creneau libre (souris, ou appui long sur telephone).
  const drag = mgr && !w.draft ? `${isPc() ? ' draggable="true"' : ''} data-drag="w${w.dish_id}"` : '';
  return `<div class="card wish"${drag}>${tile(w.name, w.status === 'pending' ? '<span class="pill">à valider</span>' : '', '', w.photo)}
    <b>${w.draft ? I('edit', 's') + ' ' : ''}${esc(w.name)}</b><span class="muted small">${w.created_by === S.me.id ? 'Votre envie' : `Envie de ${esc(w.created_by_name || '?')}`}</span>${wishCost(w)}
    <div class="btn-row icons">${acts.join('')}</div></div>`;
}
const wishCost = (w) => { const d = (S.dishes || []).find((x) => x.id === w.dish_id); return d && d.cost_pp != null ? `<span class="price small">${esc(ppShort(d))} / pers.</span>` : ''; };
function wishesHtml() {
  const ws = S.wishes || [];
  return `<div class="sec">Envies de plats <button data-a="wish-add">＋ Proposer</button></div>
    ${ws.length ? `<div class="hscroll wishes">${ws.map(wishCard).join('')}</div>` : '<p class="muted small" style="margin:0 4px">Aucune envie pour l’instant. Proposez des plats pour les prochains menus.</p>'}`;
}
let wq = '';
function wishSheet() {
  const q = norm(wq.trim()), taken = new Set((S.wishes || []).map((w) => w.dish_id));
  const list = S.dishes.filter((d) => !taken.has(d.id) && (!q || norm(d.name).includes(q))).slice(0, 30);
  const exact = S.dishes.some((d) => norm(d.name) === q);
  sheet(`<h3>Envie de plat</h3><p class="muted small">Sans date : un gestionnaire la mettra au menu. Un nom nouveau crée une fiche à compléter.</p>
    <div class="search">${I('search')}<input class="txt" id="wish-q" placeholder="Plat existant ou nouveau nom…" value="${esc(wq)}" data-in="wish-q" autofocus></div>
    ${wq.trim() && !exact ? `<button class="btn full" data-a="wish-name">＋ Proposer « ${esc(wq.trim())} »</button>` : ''}
    <div class="pick">${list.map((d) => `<button class="card click" data-a="wish-pick" data-id="${d.id}"><b>${esc(d.name)}</b>${d.last_date ? `<span class="muted block">dernière fois le ${esc(fmtDate(d.last_date))}</span>` : ''}${d.cost_pp != null ? `<span class="price small block">${esc(ppShort(d))} / pers.</span>` : ''}</button>`).join('') || '<p class="muted">Aucun plat existant ne correspond.</p>'}</div>`);
}
const afterWish = async (w, msg) => {
  if (!w) return;
  S.wishes = w;
  toast(msg);
  S.dishes = null;
  await Promise.all([loadHouse(), loadDishes()]);
  render();
};
const addWish = async (body) => { closeSheet(); afterWish(await attempt(() => post(hp('/wishes'), body)), isManager() ? 'Envie ajoutée' : 'Envie proposée'); };
on('click', 'wish-add', async () => { wq = ''; if (!S.dishes) await loadDishes(); wishSheet(); });
on('input', 'wish-q', (el) => { wq = el.value; wishSheet(); const i = document.getElementById('wish-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
on('click', 'wish-pick', (el) => addWish({ dish_id: Number(el.dataset.id) }));
on('click', 'wish-name', () => addWish({ name: wq.trim() }));
on('click', 'wish-ok', async (el) => afterWish(await attempt(() => post(hp(`/wishes/${el.dataset.id}/accept`))), 'Envie validée'));
on('click', 'wish-del', async (el) => afterWish(await attempt(() => del(hp(`/wishes/${el.dataset.id}`))), 'Envie retirée'));

on('change', 'menu-note', async (el) => {
  const r = await attempt(() => put(hp('/menu-note'), { start: menu.from, note: el.value }));
  if (r) { menu.note = r.note; toast('Remarques enregistrées'); }
});
on('click', 'menu-nav', async (el) => { S.menuAt = el.dataset.d || null; await loadMenu(); render(); });

// ---------- Generation du menu (gestionnaire) ----------
// Remplit les creneaux libres de la periode affichee (a partir d'aujourd'hui) : repas
// demandes, delai depuis la derniere fois (reglage du foyer, modifiable ici), tags
// (tous, sinon au moins un, sinon aucun), envies d'abord. Apercu avant d'enregistrer.
const gen = { slots: null, gap: null, tags: [], persons: 4, res: null, model: 'none', rules: [] };
const genFrom = () => (menu.from < today() ? today() : menu.from);
on('click', 'menu-gen', () => {
  if (!gen.slots) gen.slots = slotsShown();
  if (gen.gap == null) gen.gap = S.house.household.menu_gap_days;
  gen.tags = gen.tags.filter((t) => allTags().includes(t));
  const ms = S.house.models || [];
  // Modele choisi la fois precedente s'il existe encore, sinon aucun.
  if (!ms.some((m) => String(m.id) === gen.model)) gen.model = 'none';
  gen.rules = copyRules((ms.find((m) => String(m.id) === gen.model) || {}).rules);
  gen.res = null;
  genSheet();
});
function genSheet() {
  const tags = allTags();
  sheet(`<h3>${I('spark', 's')} Générer le menu</h3>
    <p class="muted small">Du ${esc(fmtDate(genFrom(), { weekday: 'short', day: 'numeric', month: 'short' }))} au ${esc(fmtDate(menu.to, { weekday: 'short', day: 'numeric', month: 'short' }))} (menu affiché) : seuls les créneaux libres sont remplis. Aperçu avant d’enregistrer.</p>
    <div class="sec">Repas à remplir</div><div class="opt">${SHOW_ORDER.map((k) => `<button class="${gen.slots.includes(k) ? 'on' : ''}" data-a="gen-slot" data-s="${k}">${SLOT[k]}</button>`).join('')}</div>
    <label class="row line"><span class="grow"><b>Délai</b><span class="muted block">Jours sans un plat avant de le reproposer</span></span><input class="txt w5" type="number" min="0" max="365" value="${gen.gap}" data-ch="gen-gap"></label>
    <div class="row line"><span class="grow"><b>Personnes</b></span><button class="btn sm sec2" data-a="gen-p" data-d="-1">−</button><b class="w3 c" id="gen-persons">${gen.persons}</b><button class="btn sm sec2" data-a="gen-p" data-d="1">＋</button></div>
    <div class="sec">Tags${gen.tags.length ? ` · ${gen.tags.length}` : ''}</div>
    ${tags.length ? `<div class="opt tags">${tags.map((t) => `<button class="${gen.tags.includes(t) ? 'on' : ''}" data-a="gen-tag" data-t="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
      <p class="muted small">D’abord les plats qui ont tous les tags choisis, puis ceux qui en ont au moins un, sinon les autres (le délai est toujours respecté).</p>` : '<p class="muted small">Aucun tag : ajoutez-en sur les fiches des plats.</p>'}
    <div class="sec">Modèle de semaine</div>
    <select class="txt" data-ch="gen-model"><option value="none" ${gen.model === 'none' ? 'selected' : ''}>Aucun modèle (repas libres)</option>${(S.house.models || []).map((m) => `<option value="${m.id}" ${String(m.id) === gen.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <p class="muted small">${gen.model !== 'none' ? (gen.rules.length ? `Par semaine : ${gen.rules.map(ruleText).join(' · ')}.` : 'Ce modèle n’a pas de règle.') : 'Seuls le délai et les tags guident le choix.'} Les modèles se créent et se modifient dans Foyer → Modèles de semaine.</p>
    <p class="muted small">${I('bulb', 's')} Les envies passent en premier, même sans tag ni type (seuls le repas, le délai et les règles du modèle comptent). Un plat n’est proposé que pour ses repas possibles (fiche du plat ; par défaut midi et soir).</p>
    <div class="row end"><button class="btn" data-a="gen-go">${I('spark', 's')} Proposer</button></div>`);
}
function genResult() {
  const r = gen.res, byDay = new Map();
  r.meals.forEach((m, k) => { if (!byDay.has(m.date)) byDay.set(m.date, []); byDay.get(m.date).push([m, k]); });
  const why = (m) => (m.types || []).map((t) => `<span class="pill">${esc(t)}</span>`).join('') + (m.wish ? `<span class="pill p-carrot">${I('bulb', 's')} envie</span>` : '') + (gen.tags.length && m.tier ? `<span class="pill p-grey">${m.tier === 1 ? 'une partie des tags' : 'sans ces tags'}</span>` : '');
  sheet(`<h3>${I('spark', 's')} Proposition</h3>
    <p class="muted small">${r.meals.length} repas proposé${r.meals.length > 1 ? 's' : ''}${r.empty.length ? ` · ${r.empty.length} créneau${r.empty.length > 1 ? 'x' : ''} sans plat (aucun plat ne respecte le délai de ${r.gap_days} j pour ce repas)` : ''}. Retirez ce qui ne convient pas, ou demandez une autre proposition.</p>
    ${(r.unmet || []).length ? `<div class="card" style="border-color:var(--carrot)"><b>Règles non tenues</b> <span class="muted small">(pas assez de plats de ce type qui respectent le délai et le repas)</span>
      ${r.unmet.map((u) => `<div class="small">${esc(u.type)}${u.slot ? ` (${SLOT[u.slot].toLowerCase()})` : ''} : ${u.got} sur ${u.want} · semaine du ${esc(fmtDate(u.week, { day: 'numeric', month: 'short' }))}</div>`).join('')}</div>` : ''}
    ${(r.wishes_skipped || []).length ? `<div class="card"><b>${I('bulb', 's')} Envies non placées</b>
      ${r.wishes_skipped.map((w) => `<div class="small"><b>${esc(w.dish)}</b> : ${esc(w.reason)}</div>`).join('')}</div>` : ''}
    ${r.meals.length ? [...byDay].map(([d, ms]) => `<div class="sec">${esc(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      ${ms.map(([m, k]) => `<div class="row line"><span class="muted w6">${SLOT[m.slot]}</span><span class="grow"><b>${esc(m.dish)}</b> ${why(m)}</span><button class="ib" data-a="gen-x" data-k="${k}" aria-label="Retirer">${I('x', 's')}</button></div>`).join('')}`).join('')
      : '<div class="empty">Aucun plat ne convient. Réduisez le délai, choisissez d’autres repas ou indiquez les repas possibles sur les fiches des plats.</div>'}
    <div class="btn-row" style="margin-top:12px">${btnI('sliders', 'Critères', 'data-a="gen-back"')}${btnI('repeat', 'Autre proposition', 'data-a="gen-go"')}${r.meals.length ? btnI('check', `Ajouter au menu (${r.meals.length})`, 'data-a="gen-apply"', '') : ''}</div>`);
}
on('click', 'gen-slot', (el) => {
  const k = el.dataset.s;
  gen.slots = gen.slots.includes(k) ? gen.slots.filter((x) => x !== k) : [...gen.slots, k];
  genSheet();
});
on('click', 'gen-tag', (el) => { const t = el.dataset.t; gen.tags = gen.tags.includes(t) ? gen.tags.filter((x) => x !== t) : [...gen.tags, t]; genSheet(); });
on('change', 'gen-gap', (el) => { const n = parseInt(el.value, 10); gen.gap = Number.isFinite(n) ? Math.min(365, Math.max(0, n)) : gen.gap; });
on('click', 'gen-p', (el) => { gen.persons = Math.max(1, Math.min(50, gen.persons + Number(el.dataset.d))); document.getElementById('gen-persons').textContent = gen.persons; });
on('change', 'gen-model', (el) => { gen.model = el.value; gen.rules = copyRules(((S.house.models || []).find((m) => String(m.id) === gen.model) || {}).rules); genSheet(); });
on('click', 'gen-back', () => { gen.res = null; genSheet(); });
on('click', 'gen-go', async () => {
  if (!gen.slots.length) { toast('Choisissez au moins un repas'); return; }
  const gap = document.querySelector('.sheet [data-ch="gen-gap"]');
  if (gap) { const n = parseInt(gap.value, 10); if (Number.isFinite(n)) gen.gap = Math.min(365, Math.max(0, n)); }
  const r = await attempt(() => post(hp('/menu/generate'), { from: menu.from, to: menu.to, slots: gen.slots, gap_days: gen.gap, tags: gen.tags, rules: gen.rules }));
  if (r) { gen.res = r; genResult(); }
});
on('click', 'gen-x', (el) => { gen.res.meals.splice(Number(el.dataset.k), 1); genResult(); });
on('click', 'gen-apply', async () => {
  const r = await attempt(() => post(hp('/menu/generate/apply'), { meals: gen.res.meals.map(({ date, slot, dish_id }) => ({ date, slot, dish_id })), persons: gen.persons }));
  if (!r) return;
  closeSheet();
  gen.res = null;
  toast(`${r.added} repas ajouté${r.added > 1 ? 's' : ''} · ingrédients ajoutés aux listes`);
  await afterChange();
});

// Dates du menu (gestionnaire) : fixer une periode proposee, modifier ou supprimer un menu.
const nDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
function datesSheet(start, end) {
  const n = start && end ? nDays(start, end) : 0;
  sheet(`<h3>Dates du menu</h3>
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

// Glisser-deposer d'un repas (gestionnaire) : souris sur PC, appui long sur telephone.
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
  await dropOn(id, td.dataset.drop, td.dataset.slot);
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
  await dropOn(id, cell.dataset.drop, cell.dataset.slot);
});
document.addEventListener('touchcancel', touchEnd);
// Apres un glisser, le « clic » qui suit le lacher n'ouvre pas la fiche du repas.
document.addEventListener('click', (e) => { if (touch.swallow) { touch.swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('[data-drag]') && !isPc()) e.preventDefault(); });

// Lacher : repas deplace (id numerique) ou envie posee sur un creneau libre (id « w<plat> »).
async function dropOn(id, date, slot) {
  if (String(id).startsWith('w')) {
    if (mealAt(date, slot) || outAt(date, slot)) { toast('Ce créneau est déjà pris : glissez l’envie sur un créneau libre.', true); return; }
    const dish_id = Number(String(id).slice(1)), w = (S.wishes || []).find((x) => x.dish_id === dish_id);
    if (await attempt(() => post(hp('/meals'), { date, slot, dish_id, persons: 4 }))) { toast(`${w ? w.name : 'Plat'} au menu`); afterChange(); }
    return;
  }
  if (String(id).startsWith('o')) {
    const o = (menu.outings || []).find((x) => x.id === Number(String(id).slice(1)));
    if (o && (o.date !== date || o.slot !== slot) && await attempt(() => patch(hp(`/outings/${o.id}`), { date, slot }))) { toast('Déplacé'); afterChange(); }
    return;
  }
  const m = menu.meals.find((x) => x.id === Number(id));
  if (m && (m.date !== date || m.slot !== slot)) await moveMeal(id, date, slot);
}
async function moveMeal(id, date, slot) {
  const inMenu = menu && date >= menu.from && date <= menu.to;
  const other = inMenu ? menu.meals.find((x) => x.date === date && x.slot === slot && !x.suggestion && x.id !== Number(id)) : null;
  const out = inMenu && outAt(date, slot);
  if (await attempt(() => patch(hp(`/meals/${id}`), { date, slot }))) {
    toast(other ? `Échangé avec « ${other.dish} »` : out ? 'Échangé avec « À l’extérieur »' : 'Repas déplacé');
    afterChange();
  }
}
function menuActions() {
  return [
    ...(isManager() && menu.to >= today() ? [['menu-gen', 'Générer le menu', 'spark']] : []),
    ...(isManager() ? [['menu-dates', menu.period.saved ? 'Modifier les dates' : 'Fixer les dates', 'calendar']] : []),
    ['menu-slots', 'Repas affichés', 'eye'],
    ['menu-export', 'Exporter et partager', 'doc'],
  ];
}
on('click', 'menu-more', () => sheet(`<h3>Menu</h3><div class="menu-pop">${menuActions().map(([a, t, ic]) => `<button data-a="${a}"><span class="ico">${I(ic)}</span>${t}</button>`).join('')}</div>`));
on('click', 'menu-export', () => { closeSheet(); go('#/menu/export'); });
on('click', 'menu-slots', () => {
  const shown = slotsShown();
  sheet(`<h3>Repas affichés</h3>${SHOW_ORDER.map((s) => `<label class="row line"><input type="checkbox" class="cb" data-slot="${s}" ${shown.includes(s) ? 'checked' : ''}><span class="grow">${SLOT[s]}</span></label>`).join('')}
    <div class="row end"><button class="btn" data-a="menu-slots-ok">Appliquer</button></div>`);
});
on('click', 'menu-slots-ok', () => {
  const v = [...document.querySelectorAll('.sheet [data-slot]')].filter((c) => c.checked).map((c) => c.dataset.slot);
  if (!v.length) { toast('Cochez au moins un repas'); return; }
  try { localStorage.setItem('cabas-menu-slots', JSON.stringify(v)); } catch { /* ignore */ }
  closeSheet();
  render();
});

// ---------- Ajouter un repas ----------
let pm = null; // repas en preparation : { id?, date, slot, dish_id, persons, skip: [], options: [] }
function pickSheet() {
  const q = norm(pm.q || '');
  const wished = new Set((S.wishes || []).map((w) => w.dish_id));
  const list = S.dishes.filter((d) => (!q || norm(d.name).includes(q) || d.tags.some((t) => norm(t).includes(q))) && (!pm.tag || d.tags.includes(pm.tag)))
    .sort((a, b) => wished.has(b.id) - wished.has(a.id));
  sheet(`<h3>${esc(fmtDate(pm.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[pm.slot]}</h3>
    <input class="txt" id="pick-q" placeholder="Rechercher un plat…" value="${esc(pm.q || '')}" data-in="pick-q">
    ${tagChips('pick-tag', pm.tag)}
    <div class="pick">${list.map((d) => `<button class="card click" data-a="pick-dish" data-id="${d.id}"><b>${wished.has(d.id) ? `${I('bulb', 's')} ` : ''}${d.draft ? `${I('edit', 's')} ` : ''}${esc(d.name)}</b><span class="muted block">${d.parts ? `${I('puzzle', 's')} ${esc((d.part_names || []).join(', '))}` : d.ingredients ? `${d.ingredients} ingrédient${d.ingredients > 1 ? 's' : ''}` : 'rappel seulement'}${d.last_date ? ` · dernière fois le ${esc(fmtDate(d.last_date))}` : ''}</span>${d.cost_pp != null ? `<span class="price small">${esc(ppShort(d))} / pers.</span>` : ''}</button>`).join('') || '<p class="muted">Aucun plat.</p>'}</div>
    ${isManager() ? `<button class="btn sec2 full" data-a="pick-new">＋ Nouveau plat${pm.q ? ` « ${esc(pm.q)} »` : ''}</button>
      <button class="btn sec2 full" style="margin-top:8px" data-a="out-set">${I('pin', 's')} Repas à l’extérieur</button>
      <button class="btn sec2 full" style="margin-top:8px" data-a="rest-set">${I('repeat', 's')} Restes</button>` : ''}`);
}
on('click', 'meal-add', (el) => { pm = { date: el.dataset.date, slot: el.dataset.slot, persons: 4, skip: [], q: '' }; pickSheet(); });
on('input', 'pick-q', (el) => { pm.q = el.value; pickSheet(); const i = document.getElementById('pick-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
on('click', 'pick-tag', (el) => { pm.tag = pm.tag === el.dataset.t ? '' : el.dataset.t; pickSheet(); });
on('click', 'pick-dish', (el) => { pm.dish_id = Number(el.dataset.id); pm.part_skip = []; stockSheet(); });
on('click', 'pick-new', () => { closeSheet(); newDishFrom(pm.q, { date: pm.date, slot: pm.slot }); });
on('click', 'close-nav', (el) => { closeSheet(); go(el.getAttribute('href')); });

// Depuis la fiche d'un plat : choix du jour et du creneau.
on('click', 'plan-dish', async (el) => {
  if (!menu) await loadMenu();
  pm = { dish_id: Number(el.dataset.id), date: today(), slot: 'soir', persons: 4, skip: [] };
  planSheet();
});
function planSheet() {
  sheet(`<h3>${I('calendar', 's')} Ajouter au menu</h3><label class="muted">Date</label><input class="txt" type="date" value="${pm.date}" min="${today()}" data-ch="pm-date">
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
  d.parts = d.parts || [];
  pm.options = chosenOf(d, pm.options);
  pm.part_skip = pm.part_skip || [];
  const ing = mealIngredients(d, pm);
  sheet(`<h3>${esc(d.name)}</h3><p class="muted">${esc(fmtDate(pm.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[pm.slot]}</p>
    ${d.groups.map((g) => `<div class="sec">${esc(g.name)}</div><div class="opt">${g.options.map((o) => `<button class="${pm.options.includes(o.id) ? 'on' : ''}" data-a="pm-opt" data-id="${o.id}">${esc(o.name)}</button>`).join('')}</div>`).join('')}
    ${d.parts.length ? `<div class="sec">Recettes</div><p class="muted small">Décocher une recette pour ne pas la faire cette fois.</p>
      ${d.parts.map((x) => `<label class="row line"><input type="checkbox" class="cb" data-ch="pm-part" data-id="${x.dish_id}" ${pm.part_skip.includes(x.dish_id) ? '' : 'checked'}><span class="grow">${I('puzzle', 's')} ${esc(x.name)}</span></label>`).join('')}` : ''}
    <div class="row"><span class="grow">Personnes</span><button class="btn sm sec2" data-a="pm-p" data-d="-1">−</button><b class="w3 c" id="pm-persons">${pm.persons}</b><button class="btn sm sec2" data-a="pm-p" data-d="1">＋</button></div>
    ${ing.length ? `<div class="sec">Ingrédients à acheter</div><div class="row"><p class="muted small grow">Décocher ce qui est encore en réserve.</p>
      <button class="btn sm sec2" data-a="pm-all" data-on="${ing.every((i) => !pm.skip.includes(i.product_id)) ? '' : '1'}">${ing.every((i) => !pm.skip.includes(i.product_id)) ? 'Tout décocher' : 'Tout cocher'}</button></div>
      ${ing.map((i) => `<label class="row line"><input type="checkbox" class="cb" data-ch="pm-skip" data-pid="${i.product_id}" ${pm.skip.includes(i.product_id) ? '' : 'checked'}><span class="grow">${esc(i.name)}</span></label>`).join('')}`
      : '<p class="muted">Plat sans ingrédients détaillés : simple rappel dans la liste.</p>'}
    <div class="row end"><button class="btn" data-a="pm-save">${pm.id ? 'Enregistrer' : isManager() ? 'Ajouter au menu' : 'Suggérer ce plat'}</button></div>`);
}
// Ingredients a acheter : plat (variantes) + recettes non ecartees, un par produit.
function mealIngredients(d, m) {
  const all = [...dishIngredients(d, m.options), ...d.parts.filter((x) => !m.part_skip.includes(x.dish_id)).flatMap((x) => x.ingredients)];
  return all.filter((i, k) => !i.is_base && all.findIndex((x) => x.product_id === i.product_id) === k);
}
on('change', 'pm-part', (el) => {
  const id = Number(el.dataset.id);
  pm.part_skip = el.checked ? pm.part_skip.filter((x) => x !== id) : [...pm.part_skip, id];
  stockSheet();
});
on('click', 'pm-opt', (el) => {
  const id = Number(el.dataset.id), g = pm.dish.groups.find((x) => x.options.some((o) => o.id === id));
  pm.options = [...pm.options.filter((o) => !g.options.some((x) => x.id === o)), id];
  stockSheet();
});
// Tout cocher (rien en reserve) / tout decocher (tout en reserve).
on('click', 'pm-all', (el) => {
  const ids = mealIngredients(pm.dish, pm).map((i) => i.product_id);
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
  const body = { date: pm.date, slot: pm.slot, dish_id: pm.dish_id, persons: pm.persons, skip: pm.skip, options: pm.options, part_skip: pm.part_skip };
  const r = await attempt(() => (pm.id ? patch(hp(`/meals/${pm.id}`), { persons: pm.persons, skip: pm.skip, options: pm.options, part_skip: pm.part_skip }) : post(hp('/meals'), body)));
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

// ---------- Repas a l'exterieur (gestionnaire) ----------
function outSheet(date, slot) {
  const o = outAt(date, slot), m = !o && mealAt(date, slot), mgr = isManager();
  if (o && o.rest) { restSheet(date, slot); return; }
  sheet(`<h3>${I('pin', 's')} Repas à l’extérieur</h3><p class="muted">${esc(fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[slot]}</p>
    ${mgr ? `<input class="txt" id="out-note" maxlength="200" placeholder="Où ? (restaurant, chez…) — facultatif" value="${esc(o?.note || '')}" data-enter="out-save" data-date="${date}" data-slot="${slot}">
      ${m && !m.suggestion ? `<p class="muted small">« ${esc(m.dish)} » sera retiré du menu (ingrédients retirés de la liste).</p>` : ''}
      <div class="row end" style="margin-top:12px">${o ? `<button class="btn sec2 danger-t" data-a="out-del" data-id="${o.id}">Retirer la mention</button><button class="btn sec2" data-a="meal-add" data-date="${date}" data-slot="${slot}">Mettre un plat</button>` : ''}
      <button class="btn" data-a="out-save" data-date="${date}" data-slot="${slot}">Enregistrer</button></div>`
      : o?.note ? `<p>${esc(o.note)}</p>` : '<p class="muted">Pas de repas à préparer pour ce créneau.</p>'}`);
}
// ---------- Restes : repas sans achat (plat deja cuisine les 6 jours d'avant, ou restes divers) ----------
let rs = null; // { date, slot, persons, id }
function restSheet(date, slot) {
  const o = outAt(date, slot);
  if (!rs || rs.date !== date || rs.slot !== slot) rs = { date, slot, persons: (o && o.persons) || 2, id: o ? o.id : null };
  const d0 = Date.parse(date), srcs = menu.meals.filter((m) => !m.suggestion && !m.dish_deleted && Date.parse(m.date) < d0 && (d0 - Date.parse(m.date)) / 86400000 <= 6)
    .sort((a, b) => b.date.localeCompare(a.date) || b.slot.localeCompare(a.slot));
  sheet(`<h3>${I('repeat', 's')} Restes</h3><p class="muted">${esc(fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[slot]}. Aucun achat : le repas ne compte ni dans la liste ni dans le budget.</p>
    <div class="row"><span class="grow">Personnes</span><button class="btn sm sec2" data-a="rest-p" data-d="-1" aria-label="Moins">−</button><b class="c" style="min-width:26px;text-align:center">${rs.persons}</b><button class="btn sm sec2" data-a="rest-p" data-d="1" aria-label="Plus">＋</button></div>
    <input class="txt" id="rest-note" maxlength="200" style="margin-top:10px" placeholder="Restes variés, frigo… (facultatif)" value="${esc(o?.note || '')}" data-enter="rest-ok" data-id="">
    <div class="sec">Restes de…</div>
    ${srcs.map((m) => `<button class="item click" data-a="rest-ok" data-id="${m.dish_id}"><span class="grow"><b>${esc(m.dish_name || m.dish)}</b><span class="muted block">${esc(fmtDate(m.date, { weekday: 'long', day: 'numeric' }))} · ${SLOT[m.slot]} · ${m.persons} pers.</span></span>${I('chev', 's chev')}</button>`).join('') || '<p class="muted small">Aucun repas des 6 derniers jours.</p>'}
    <div class="row end" style="margin-top:12px">${o ? `<button class="btn sec2 danger-t" data-a="out-del" data-id="${o.id}">Retirer</button>` : ''}<button class="btn" data-a="rest-ok" data-id="">Sans plat précis</button></div>`);
}
on('click', 'rest-set', () => { rs = null; restSheet(pm.date, pm.slot); });
on('click', 'rest-p', (el) => { const note = document.getElementById('rest-note')?.value || ''; rs.persons = Math.max(1, rs.persons + Number(el.dataset.d)); restSheet(rs.date, rs.slot); document.getElementById('rest-note').value = note; });
on('click', 'rest-ok', async (el) => {
  const note = document.getElementById('rest-note')?.value || '';
  if (!(await attempt(() => put(hp('/outings'), { date: rs.date, slot: rs.slot, rest: true, dish_id: Number(el.dataset.id) || null, persons: rs.persons, note })))) return;
  rs = null; closeSheet(); toast('Restes notés'); afterChange();
});
on('click', 'out-open', (el) => outSheet(el.dataset.date, el.dataset.slot));
on('click', 'out-set', () => outSheet(pm.date, pm.slot));
const saveOuting = async (date, slot) => {
  const note = document.getElementById('out-note')?.value || '';
  if (!(await attempt(() => put(hp('/outings'), { date, slot, note })))) return;
  closeSheet(); toast('Repas à l’extérieur noté'); afterChange();
};
on('click', 'out-save', (el) => saveOuting(el.dataset.date, el.dataset.slot));
on('click', 'out-del', async (el) => {
  if (await attempt(() => del(hp(`/outings/${el.dataset.id}`)))) { closeSheet(); toast('Mention retirée'); afterChange(); }
});

// ---------- Fiche repas ----------
on('click', 'meal-open', async (el) => {
  const r = await attempt(() => get(hp(`/menu?from=${el.dataset.date}&days=1`)));
  const m = r && r.meals.find((x) => x.id === Number(el.dataset.id));
  if (m) mealSheet(m);
});
async function mealSheet(m) {
  m = { parts: [], part_skip: [], ...m };
  const mgr = isManager();
  const lists = (await get(hp('/lists')).catch(() => ({ upcoming: [] }))).upcoming;
  sheet(`<h3>${esc(m.dish)}</h3><p class="muted">${esc(fmtDate(m.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${SLOT[m.slot]}${m.suggestion ? ` · suggéré par ${esc(m.suggested_by_name || '?')}` : ''}</p>
    <div class="row"><span class="grow">Personnes</span><b>${m.persons}</b></div>
    ${m.cost != null ? `<div class="row"><span class="grow">Coût estimé</span><b>${m.cost_partial ? 'dès ' : '≈ '}${eur(m.cost)}</b><span class="muted small">· ${eur(Math.round(m.cost / m.persons))} / pers.</span></div>` : ''}
    ${m.parts.length ? `<div class="sec">Recettes</div>${m.parts.map((x) => `<a class="item click${x.skipped ? ' skipped' : ''}" href="#/plats/${x.dish_id}" data-a="close-nav"><span class="ico plum">${I('puzzle')}</span><span class="grow">${esc(x.name)}${x.skipped ? ' <span class="muted small">· pas cette fois</span>' : ''}</span>${I('chev', 's chev')}</a>`).join('')}` : ''}
    ${m.skip.length ? `<p class="muted small">${I('box', 's')} ${m.skip.length} ingrédient${m.skip.length > 1 ? 's' : ''} en réserve (non acheté${m.skip.length > 1 ? 's' : ''})</p>` : ''}
    ${mgr && !m.suggestion ? `<label class="row line"><span>Liste</span><select class="txt grow" data-ch="meal-list" data-id="${m.id}">
      <option value="">Automatique (période)</option>${lists.map((l) => `<option value="${l.id}" ${m.list_id === l.id ? 'selected' : ''}>Liste du ${esc(fmtDate(l.date))}</option>`).join('')}</select></label>` : ''}
    <a class="btn full" style="margin-top:12px" href="#/plats/${m.dish_id}" data-a="close-nav">${I('book', 's')} Fiche du plat</a>
    <div class="btn-row" style="margin-top:8px">
      ${m.suggestion && mgr ? btnI('check', 'Accepter', `data-a="meal-accept" data-id="${m.id}"`, '') : ''}
      ${mgr && !m.suggestion ? `${btnI('sliders', m.variant || m.parts.length ? (m.parts.length ? 'Recettes, personnes…' : 'Variantes, personnes…') : 'Personnes et réserve', `data-a="meal-edit" data-id="${m.id}" data-date="${m.date}"`)}${btnI('repeat', 'Changer de plat', `data-a="meal-change" data-id="${m.id}" data-date="${m.date}" data-slot="${m.slot}"`)}${btnI('bulb', 'Remettre en envie', `data-a="meal-wish" data-id="${m.id}"`, 'sec2')}` : ''}
      ${mgr || (m.suggestion && m.suggested_by === S.me.id) ? btnI('trash', m.suggestion ? 'Refuser / retirer' : 'Retirer du menu', `data-a="meal-del" data-id="${m.id}"`, 'sec2 danger-t') : ''}
    </div>`);
}
on('change', 'meal-list', async (el) => {
  if (await attempt(() => patch(hp(`/meals/${el.dataset.id}`), { list_id: el.value }))) { toast('Repas rattaché · ingrédients déplacés'); closeSheet(); afterChange(); }
});
on('click', 'meal-wish', async (el) => {
  const w = await attempt(() => post(hp(`/meals/${el.dataset.id}/wish`)));
  if (!w) return;
  S.wishes = w; closeSheet(); toast('Repas retiré · plat remis en envie'); afterChange();
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
  pm = { id: m.id, date: m.date, slot: m.slot, dish_id: m.dish_id, persons: m.persons, skip: [...m.skip], options: [...m.options], part_skip: [...m.part_skip] };
  stockSheet();
});
on('click', 'meal-change', (el) => {
  // Le nouveau plat remplace celui du creneau (ajout par un gestionnaire).
  pm = { date: el.dataset.date, slot: el.dataset.slot, persons: 4, skip: [], q: '' };
  if (!S.dishes) loadDishes().then(pickSheet); else pickSheet();
});

// ---------- Export / impression ----------
const ex = { range: 'menu', slots: { midi: true, soir: true }, persons: false, shop: true, notes: true };
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
const noteBox = (note) => `<div class="pm-note"><b>Remarques</b>${note ? `<div class="txt-n">${esc(note)}</div>` : ''}</div>`;
function sheetHtml(d, household) {
  const days = []; for (let x = d.from; x <= d.to; x = addDays(x, 1)) days.push(x);
  const slots = SLOTS.filter((s) => ex.slots[s]);
  const shop = new Set((d.lists || []).map((l) => l.date).concat(d.shoppingDays || []));
  const meals = d.meals.filter((m) => !m.suggestion), outs = d.outings || [];
  const weeks = []; for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  // Toujours 7 colonnes de meme largeur : la derniere semaine incomplete est completee de cases vides.
  const pad = (w, tag) => `<${tag} class="off"></${tag}>`.repeat(7 - w.length);
  return `<div class="pm"><h1>Menu du ${esc(fmtDate(d.from, { day: 'numeric', month: 'long' }))} au ${esc(fmtDate(d.to, { day: 'numeric', month: 'long' }))}</h1>
    <div class="meta">${esc(household)}${ex.shop ? ` · ${I('cart', 's')} = jour de courses` : ''}</div>
    ${weeks.map((w) => `<table><colgroup><col class="c-sl">${'<col>'.repeat(7)}</colgroup><tr><th class="sl"></th>${w.map((x) => `<th>${esc(fmtDate(x, { weekday: 'short', day: 'numeric', month: 'short' }))}${ex.shop && shop.has(x) ? ` ${I('cart', 's')}` : ''}</th>`).join('')}${pad(w, 'th')}</tr>
      ${slots.map((s) => `<tr><td class="sl"><span>${SLOT[s]}</span></td>${w.map((x) => {
        const o = outs.find((y) => y.date === x && y.slot === s), m = meals.find((y) => y.date === x && y.slot === s);
        return `<td>${o ? `<i class="out">${esc(outLabel(o))}${o.note ? ` <span class="np">(${esc(o.note)})</span>` : ''}</i>` : m ? esc(m.dish) + (ex.persons ? ` <span class="np">(${m.persons} p.)</span>` : '') : ''}</td>`;
      }).join('')}${pad(w, 'td')}</tr>`).join('')}</table>`).join('')}
    ${ex.notes ? noteBox(d.note) : ''}
    <div class="foot"><span>Le Cabas</span><span>Imprimé le ${new Date().toLocaleDateString('fr-BE')}</span></div></div>`;
}
export function exportView() {
  const mgr = isManager(), token = S.house.menuToken;
  const link = token ? new URL(`#/affichage/${token}`, document.baseURI).href : null;
  return {
    title: 'Exporter le menu', back: '#/menu', sub: 'A4 paysage',
    body: `<div class="sec">Période</div><div class="opt">${[['menu', 'Menu affiché'], ['week', '7 jours'], ['list', 'Période de la prochaine liste']].map(([k, t]) => `<button class="${ex.range === k ? 'on' : ''}" data-a="ex-range" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="sec">Créneaux</div><div class="opt">${SLOTS.map((s) => `<button class="${ex.slots[s] ? 'on' : ''}" data-a="ex-slot" data-s="${s}">${SLOT[s]}</button>`).join('')}</div>
      <div class="sec">Options</div><div class="opt"><button class="${ex.persons ? 'on' : ''}" data-a="ex-opt" data-k="persons">Nb de personnes</button><button class="${ex.shop ? 'on' : ''}" data-a="ex-opt" data-k="shop">Jours de courses</button><button class="${ex.notes ? 'on' : ''}" data-a="ex-opt" data-k="notes">Remarques</button></div>
      ${ex.notes ? `<div class="sec">Remarques</div>${mgr ? `<textarea class="txt" rows="3" maxlength="2000" placeholder="Laisser vide pour imprimer un cadre à compléter à la main" data-in="ex-note" data-ch="ex-note-save">${esc(exData.note || '')}</textarea>` : `<p class="muted small">${exData.note ? esc(exData.note) : 'Aucune remarque : un cadre vide sera imprimé.'}</p>`}` : ''}
      <div class="sec">Aperçu</div><div id="print-src">${sheetHtml(exData, S.house.household.name)}</div>
      <div class="row end"><button class="btn" data-a="ex-print">${I('doc', 's')} Imprimer</button><button class="btn" data-a="ex-print" data-pdf="1">⬇ PDF</button></div>
      <div class="sec">Lien d'affichage</div><div class="card"><p class="muted small">Page en lecture seule, sans connexion, qui se met à jour toute seule (tablette de cuisine). Révocable.</p>
        ${link ? `<input class="txt" readonly value="${esc(link)}" id="share-url"><div class="row end"><button class="btn sec2" data-a="share-copy">${I('link', 's')} Copier</button><a class="btn sec2" href="${esc(link)}" target="_blank" rel="noopener">Ouvrir</a>${mgr ? '<button class="btn sec2 danger-t" data-a="share" data-act="revoke">Révoquer</button>' : ''}</div>`
        : mgr ? '<button class="btn sec2" data-a="share">Créer le lien d’affichage</button>' : '<p class="muted">Aucun lien (à créer par un gestionnaire).</p>'}</div>`,
  };
}
on('click', 'ex-range', async (el) => { ex.range = el.dataset.k; await loadExport(); render(); });
on('click', 'ex-slot', (el) => { ex.slots[el.dataset.s] = !ex.slots[el.dataset.s]; render(); });
on('click', 'ex-opt', (el) => { ex[el.dataset.k] = !ex[el.dataset.k]; render(); });
// Apercu mis a jour a la frappe (sans re-rendu, pour garder le curseur) ; enregistre en quittant le champ.
on('input', 'ex-note', (el) => { const b = document.querySelector('#print-src .pm-note'); if (b) b.outerHTML = noteBox(el.value.trim()); });
on('change', 'ex-note-save', async (el) => {
  const r = await attempt(() => put(hp('/menu-note'), { start: exData.from, note: el.value }));
  if (r) { exData.note = r.note; toast('Remarques enregistrées'); }
});
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
  Object.assign(ex, { slots: Object.fromEntries(SLOTS.map((s) => [s, slotsShown().includes(s)])), persons: true, shop: true, notes: !!pub.note });
  const html = sheetHtml(pub, pub.household);
  Object.assign(ex, saved);
  return { noNav: true, wide: true, title: `Menu · ${pub.household}`, sub: 'Affichage en lecture seule · mis à jour toutes les 5 minutes', body: html };
}

export const resetMenu = () => { menu = null; };
