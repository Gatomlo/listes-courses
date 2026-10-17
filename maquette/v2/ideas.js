// Le Cabas · maquette v2 : idées d'ergonomie (recherche globale, ajout de plusieurs articles / dictée,
// « peut-être à racheter », parcours du magasin appris, glisser une envie sur un créneau).

// ---------- Recherche globale ----------
const gsRows = (q) => {
  const n = norm(q).trim();
  if (!n) return `<p class="sub" style="margin:10px 2px">Cherchez un produit, un plat, un ingrédient ou une liste. Essayez « lait », « curry », « mezze ».</p>`;
  const prods = Object.values(P).filter((p) => norm(p.n).includes(n)).slice(0, 5);
  const dishes = Object.keys(DISHES).filter((k) => norm(DISHES[k].n).includes(n) || DISHES[k].ings.some(([pid]) => norm(P[pid].n).includes(n))).slice(0, 5);
  const lists = LISTS.filter((l) => l.items.some((i) => norm(P[i.pid].n).includes(n)));
  const sec = (t, rows) => (rows ? `<div class="sh"><span>${t}</span></div><div class="group">${rows}</div>` : '');
  const out = sec('Produits', prods.map((p) => `<button class="row tap" data-a="go" data-v="product" data-id="${p.id}"><span class="ico">${I('tag')}</span><span class="grow"><b>${p.n}</b><span class="sub" style="display:block">${catLabel(p)} · ${p.u}</span></span>${I('chev', 's chev')}</button>`).join(''))
    + sec('Plats', dishes.map((k) => `<button class="row tap" data-a="go" data-v="dish" data-id="${k}"><span class="ico plum">${I('bowl')}</span><span class="grow"><b>${DISHES[k].n}</b><span class="sub" style="display:block">${DISHES[k].ings.some(([pid]) => norm(P[pid].n).includes(n)) && !norm(DISHES[k].n).includes(n) ? 'contient ' + DISHES[k].ings.filter(([pid]) => norm(P[pid].n).includes(n)).map(([pid]) => P[pid].n).join(', ') : ppShort(k) ? ppShort(k) + ' / pers.' : ''}</span></span>${I('chev', 's chev')}</button>`).join(''))
    + sec('Dans vos listes', lists.map((l) => { const i = l.items.find((x) => norm(P[x.pid].n).includes(n)); return `<button class="row tap" data-a="go" data-v="list" data-id="${l.id}"><span class="ico">${I('basket')}</span><span class="grow"><b>${P[i.pid].n}</b><span class="sub" style="display:block">${listName(l)}${l.status === 'closed' ? ' · clôturée' : ''}</span></span>${I('chev', 's chev')}</button>`; }).join(''));
  return out || `<p class="empty">Rien pour « ${esc(q)} ».</p>`;
};
A.gsearch = () => {
  topSheet(`<div class="th"><div class="search grow" style="margin:0">${I('search')}<input class="in" id="gs-q" placeholder="Rechercher partout…" data-in="gs" autocomplete="off"></div><button class="ib x" data-a="close" aria-label="Fermer">${I('x')}</button></div>
    <div class="gs-res" id="gs-res">${gsRows('')}</div><div class="handle"></div>`);
  setTimeout(() => $('gs-q') && $('gs-q').focus(), 60);
};
IN.gs = (el) => { $('gs-res').innerHTML = gsRows(el.value); };

// ---------- Ajout de plusieurs articles (virgules ou dictée) ----------
const SEP = /[,;\n]| et /i;
const sing = (w) => w.replace(/(aux|s|x)$/, '').replace(/œ/g, 'oe');
const parseMulti = (text) => text.split(SEP).map((t) => t.trim()).filter(Boolean).map((raw) => {
  let q = 1, name = raw;
  let m = raw.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s*(.+)$/i) || raw.match(/^(.+?)\s*(?:x|×)\s*(\d+)$/i);
  if (m) { if (/^\d/.test(m[1])) { q = Number(m[1].replace(',', '.')); name = m[2]; } else { name = m[1]; q = Number(m[2]); } }
  const n = norm(name).replace(/œ/g, 'oe'), sn = sing(n);
  const p = Object.values(P).find((x) => norm(x.n).replace(/œ/g, 'oe') === n) || Object.values(P).find((x) => { const t = norm(x.n).replace(/œ/g, 'oe'); return sn.length > 2 && (t.startsWith(sn) || t.includes(sn)); });
  return { raw, name: name.charAt(0).toUpperCase() + name.slice(1), q, p: p ? p.id : null, on: true };
});
A['add-multi'] = (el) => {
  const text = el.value || '';
  if (!SEP.test(text)) { const f = Object.values(P).find((p) => norm(p.n).includes(norm(text).trim())); if (f && norm(text).trim()) A['add-pid']({ dataset: { id: S.q.addL, pid: f.id } }); return; }
  S.q.mu = parseMulti(text);
  live(muHtml);
};
const muHtml = () => `<h3>${plural(S.q.mu.filter((x) => x.on).length, 'article')} à ajouter</h3><p class="lead">${S.q.addL === 'ap' ? 'À « À prévoir »' : 'À la liste'} · décochez ce que vous ne voulez pas.</p>
  <div class="group">${S.q.mu.map((x, k) => `<button class="row tap" data-a="mu-t" data-k="${k}"><span class="ck sq ${x.on ? 'on' : ''}">${I('check')}</span><span class="grow"><b>${x.p ? P[x.p].n : x.name}</b>${x.q !== 1 ? ` <span class="faint">× ${x.q}</span>` : ''}<span class="sub" style="display:block">${x.p ? catLabel(P[x.p]) + ' · ' + P[x.p].u : 'nouveau produit, sera créé (rayon Épicerie)'}</span></span>${x.p ? '' : '<span class="pill warn">à créer</span>'}</button>`).join('')}</div>
  <div class="foot"><button class="btn sec" data-a="close">Annuler</button><button class="btn" data-a="mu-ok">Ajouter</button></div>`;
A['mu-t'] = (el) => { const x = S.q.mu[Number(el.dataset.k)]; x.on = !x.on; refresh(); };
A['mu-ok'] = () => {
  const l = listById(S.q.addL); let n = 0;
  S.q.mu.filter((x) => x.on).forEach((x) => {
    let pid = x.p;
    if (!pid) { pid = 'x' + Date.now() + n; P[pid] = { id: pid, n: x.name, cat: 'ep', sub: null, u: 'paquet', avg: { im: null, co: null, al: null }, rc: 0 }; }
    const ex = l.items.find((i) => i.pid === pid && !i.sugg);
    if (ex && isM()) ex.q += x.q; else l.items.push(it(pid, x.q, { sugg: isM() ? null : 'Thomas' }));
    n++;
  });
  queued(); closeSheet(); toast(`${plural(n, 'article')} ${isM() ? 'ajouté' : 'suggéré'}${n > 1 ? 's' : ''}`); render();
};
// Dictée : la maquette simule ce que le micro du clavier renverrait.
A.dictate = () => {
  const text = 'lait, 2 beurre, œufs, riz, quinoa';
  const i = $('add-q') || $('ap-q');
  if (i) i.value = text;
  S.q.addQ = text; S.q.addL = S.q.addL || 'ap';
  toast('Dictée simulée : « ' + text + ' »');
  A['add-multi']({ value: text });
};
// Accueil : champ « À prévoir » avec plusieurs articles.
const _apQuick = A['ap-quick'];
A['ap-quick'] = (el) => { if (SEP.test(el.value || '')) { S.q.addL = 'ap'; A['add-multi'](el); } else _apQuick(el); };

// ---------- Peut-être à racheter ----------
// Produits achetés a intervalle regulier : [produit, jours habituels, jours depuis le dernier achat].
const HABITS = [['pou', 14, 16], ['beu', 21, 24], ['lai', 9, 12], ['pat', 10, 7]];
const habitsDue = () => {
  const inLists = new Set(LISTS.filter((l) => l.status !== 'closed').flatMap((l) => l.items.map((i) => i.pid)));
  return HABITS.filter(([pid, every, ago]) => ago >= every && !inLists.has(pid) && !(S.q.habitSkip || []).includes(pid));
};
function habitsHtml() {
  const hs = habitsDue();
  if (!hs.length) return '';
  return `<div class="between" style="margin-top:12px"><span class="sub">Peut-être à racheter</span><button class="xs" style="color:var(--muted)" data-a="habit-skip">Masquer</button></div>
    <div class="hstack" style="margin-top:6px">${hs.map(([pid, every, ago]) => `<button class="chip" data-a="habit-add" data-pid="${pid}" title="Habituellement tous les ${every} jours">${I('plus', 's')} ${P[pid].n} <span class="faint">· ${ago} j</span></button>`).join('')}</div>`;
}
A['habit-add'] = (el) => { const pid = el.dataset.pid, ap = listById('ap'); ap.items.push(it(pid, 1)); queued(); render(); toast(`${P[pid].n} ajouté à « À prévoir »`, () => { ap.items.splice(ap.items.findIndex((i) => i.pid === pid), 1); render(); }); };
A['habit-skip'] = () => { S.q.habitSkip = HABITS.map(([pid]) => pid); render(); };

// ---------- Parcours du magasin appris ----------
// Suggestion : d'apres l'ordre de cochage des dernieres courses.
const LEARN = { im: { move: 'bo', before: 'fr', n: 6 } };
const learnedCard = (id) => {
  const L = LEARN[id];
  if (!L || S.q['learn' + id] === 'done') return '';
  const o = ORDER[id];
  if (o.indexOf(L.move) < 0 || o.indexOf(L.move) < o.indexOf(L.before)) return '';
  return `<div class="card" style="margin:12px 0"><div class="hstack">${I('spark')}<b class="grow">Parcours appris</b></div>
    <p class="sub" style="margin:6px 0 10px">Sur vos ${L.n} dernières courses ici, vous prenez <b>${CATS[L.move]}</b> avant <b>${CATS[L.before]}</b>. Mettre à jour l’ordre du magasin ?</p>
    <div class="btn-row"><button class="btn sec sm" data-a="learn-no" data-id="${id}">Ignorer</button><button class="btn sm" data-a="learn-ok" data-id="${id}">Appliquer</button></div>
    <label class="row" style="padding:10px 0 0"><span class="grow small">Ajuster automatiquement à chaque course</span><button class="sw ${S.q.autoOrder ? 'on' : ''}" data-a="learn-auto" aria-label="Ajustement automatique"></button></label></div>`;
};
const _store = VIEWS.store;
VIEWS.store = (t) => { const v = _store(t); v.body = learnedCard(t.id) + v.body; return v; };
A['learn-ok'] = (el) => { const L = LEARN[el.dataset.id], o = ORDER[el.dataset.id]; o.splice(o.indexOf(L.move), 1); o.splice(o.indexOf(L.before), 0, L.move); S.q['learn' + el.dataset.id] = 'done'; toast('Parcours mis à jour'); render(); };
A['learn-no'] = (el) => { S.q['learn' + el.dataset.id] = 'done'; render(); };
A['learn-auto'] = () => { S.q.autoOrder = !S.q.autoOrder; render(); };

// ---------- Glisser une envie sur un créneau libre ----------
let drag = null;
const dropTarget = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('.meal'); };
const clearDrop = () => document.querySelectorAll('.meal.drop-on').forEach((e) => e.classList.remove('drop-on'));
function startDrag() {
  if (!drag || drag.on) return;
  drag.on = true;
  const w = WISHES.find((x) => x.id === Number(drag.id));
  const g = document.createElement('div');
  g.className = 'drag-ghost'; g.textContent = DISHES[w.dish].n;
  document.body.appendChild(g); drag.g = g;
  if (navigator.vibrate) navigator.vibrate(10);
}
// Defilement automatique pres des bords de l'ecran pendant le glisser (les envies sont en bas de page).
function autoScroll() {
  if (!drag || !drag.on) return;
  const sc = $('scroll'), r = sc.getBoundingClientRect(), edge = 90;
  const dy = drag.py < r.top + edge ? -16 : drag.py > r.bottom - edge ? 16 : 0;
  if (dy) { sc.scrollTop += dy; clearDrop(); const t = dropTarget(drag.px, drag.py); if (t && t.classList.contains('ghost')) t.classList.add('drop-on'); }
  drag.raf = requestAnimationFrame(autoScroll);
}
document.addEventListener('pointerdown', (e) => {
  const w = e.target.closest('.card.wish[data-wish]');
  if (!w || e.target.closest('button') || !isM()) return;
  drag = { id: w.dataset.wish, x: e.clientX, y: e.clientY, on: false, touch: e.pointerType === 'touch' };
  if (drag.touch) drag.t = setTimeout(startDrag, 380);
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.on) {
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (drag.touch) { if (moved > 10) { clearTimeout(drag.t); drag = null; } return; }
    if (moved > 6) startDrag(); else return;
  }
  drag.g.style.left = e.clientX + 'px'; drag.g.style.top = e.clientY + 'px';
  drag.px = e.clientX; drag.py = e.clientY;
  if (!drag.raf) drag.raf = requestAnimationFrame(autoScroll);
  clearDrop();
  const t = dropTarget(e.clientX, e.clientY);
  if (t && t.classList.contains('ghost')) t.classList.add('drop-on');
});
document.addEventListener('touchmove', (e) => { if (drag && drag.on) e.preventDefault(); }, { passive: false });
const endDrag = (e, cancel) => {
  if (!drag) return;
  clearTimeout(drag.t); cancelAnimationFrame(drag.raf);
  const d = drag; drag = null;
  if (!d.on) return;
  d.g.remove(); clearDrop();
  if (cancel) return;
  const t = dropTarget(e.clientX, e.clientY);
  if (!t) return;
  if (t.classList.contains('ghost')) { const w = WISHES.find((x) => x.id === Number(d.id)); pm = { date: t.dataset.date, slot: t.dataset.slot, p: 4, opts: {}, skip: [], res: [], q: '', tag: '' }; A['pick-dish']({ dataset: { k: w.dish } }); }
  else toast('Créneau déjà occupé : choisissez un créneau libre');
};
document.addEventListener('pointerup', (e) => endDrag(e, false));
document.addEventListener('pointercancel', (e) => endDrag(e, true));

// ---------- Balayer une ligne du mode courses pour la retirer ----------
let sw = null;
document.addEventListener('pointerdown', (e) => {
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
