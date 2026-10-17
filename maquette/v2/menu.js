// ---------- Budget : coût par personne ----------
// Prix de l'emballage = moyenne la plus basse des magasins actifs ; quantités en emballages
// fractionnaires ; produits de base exclus ; produit sans prix = coût partiel (« dès »).
const baseQ = (q, u) => ({ g: [q, 'g'], kg: [q * 1000, 'g'], ml: [q, 'ml'], cl: [q * 10, 'ml'], l: [q * 1000, 'ml'], pc: [q, 'pc'], cc: [q * 5, 'ml'], cs: [q * 15, 'ml'] }[u]);
const pkgSize = (p) => {
  const t = p.u; let m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|cl|ml|l)\b/i);
  if (m) { const n = Number(m[1].replace(',', '.')); return baseQ(n, m[2].toLowerCase()); }
  if (t === 'kg') return [1000, 'g'];
  if (/litre/.test(t)) return [1000, 'ml'];
  m = t.match(/de (\d+)/); if (m) return [Number(m[1]), 'pc'];
  return /pièce|botte/.test(t) ? [1, 'pc'] : null;
};
const refPrice = (pid) => { const xs = activeStores().map((s) => P[pid].avg[s]).filter((x) => x != null); return xs.length ? Math.min(...xs) : null; };
const ingPk = ([pid, q, u]) => { if (q == null) return 1; if (!u) return q; const sz = pkgSize(P[pid]), b = baseQ(q, u); return sz && b && (b[1] === sz[1] || (b[1] !== 'pc' && sz[1] !== 'pc')) ? b[0] / sz[0] : 1; };
const costOfIngs = (ings, f = 1) => ings.filter(([pid]) => !P[pid].base).reduce((r, g) => { const pr = refPrice(g[0]); if (pr == null) r.missing++; else r.c += ingPk(g) * pr * f; r.n++; return r; }, { c: 0, missing: 0, n: 0 });
const ingCostOf = (g) => { if (P[g[0]].base) return null; const pr = refPrice(g[0]); return pr == null ? null : Math.round(ingPk(g) * pr); };
// Cout d'un plat (portions du plat) : ingredients propres + composants au prorata, variantes par defaut.
function dishCost(k) {
  const d = DISHES[k];
  const own = [...d.ings, ...(d.groups || []).flatMap((g) => g.o[0][1])];
  let r = costOfIngs(own);
  (d.parts || []).forEach(([p, por]) => { const dd = DISHES[p], x = costOfIngs([...dd.ings, ...(dd.groups || []).flatMap((g) => g.o[0][1])], por / dd.p); r = { c: r.c + x.c, missing: r.missing + x.missing, n: r.n + x.n }; });
  return { pp: r.n - r.missing > 0 ? Math.round(r.c / d.p) : null, partial: r.missing > 0, missing: r.missing };
}
const ppShort = (k) => { const c = dishCost(k); return c.pp == null ? '' : `${c.partial ? 'dès ' : '≈ '}${eur(c.pp)}`; };
// Tag « Économique » : automatique, coût complet sous le palier des réglages (HOUSE.eco, centimes par personne).
const isEco = (k) => { const c = dishCost(k); return !!HOUSE.eco && c.pp != null && !c.partial && c.pp < HOUSE.eco; };
const tagsOf = (k) => [...DISHES[k].tags, ...(isEco(k) ? ['économique'] : [])];
// Cout d'un repas : personnes, variantes choisies, recettes ecartees, ingredients en reserve exclus.
function mealCost(m) {
  if (m.rest) return { cost: 0, partial: false };
  const d = DISHES[m.dish], opts = m.opts || {}, sk = m.skip || [], rs = m.res || [];
  const f = m.p / d.p;
  let r = costOfIngs([...d.ings, ...(d.groups || []).flatMap((g) => (g.o.find((o) => o[0] === opts[g.g]) || g.o[0])[1])].filter(([pid]) => !rs.includes(pid)), f);
  (d.parts || []).filter(([p]) => !sk.includes(p)).forEach(([p, por]) => { const dd = DISHES[p], x = costOfIngs(dd.ings.filter(([pid]) => !rs.includes(pid)), f * por / dd.p); r = { c: r.c + x.c, missing: r.missing + x.missing, n: r.n + x.n }; });
  return { cost: r.n - r.missing > 0 ? Math.round(r.c) : null, partial: r.missing > 0 };
}
// Total du menu : chaque repas compte pour ses personnes ; sous-totaux par semaine (tranches de 7 jours depuis le debut).
const menuCost = () => { let total = 0, unknown = 0, partial = false, persons = 0; const weeks = []; MEALS.filter((m) => !m.sugg && !m.rest).forEach((m) => { const c = mealCost(m); if (c.cost == null) unknown++; else { total += c.cost; persons += m.p; const k = Math.floor(dayDiff(MENU.start, m.date) / 7); weeks[k] = (weeks[k] || 0) + c.cost; } if (c.partial) partial = true; }); return { total, unknown, partial: partial || unknown > 0, persons, weeks }; };
const PRICES = [['2', '≤ 2 €'], ['3', '≤ 3 €'], ['4', '≤ 4 €'], ['5', '≤ 5 €'], ['over', '> 5 €'], ['unk', 'Sans prix']];
const priceOk = (k, f) => { if (!f) return true; const { pp } = dishCost(k); return f === 'unk' ? pp == null : f === 'over' ? pp != null && pp > 500 : pp != null && pp <= Number(f) * 100; };

// Le Cabas · maquette v2 : onglets Menu (agenda / grille, repas, envies, export, affichage) et Plats.
S.slots = { midi: true, soir: true };
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const tile = (k, cls = '', pills = '') => { const d = DISHES[k]; return `<div class="tile ${cls}" style="--h:${hue(d.n)}"><span class="mono">${d.n[0]}</span><div class="tb">${pills}</div></div>`; };
const dishLabel = (m) => { const d = DISHES[m.dish], v = Object.values(m.opts || {}); return m.rest ? `Restes · ${d.n}` : v.length ? `${d.n} · ${v.join(', ')}` : d.n; };
// Repas à l'extérieur (case sans plat, note facultative) et restes (repas sans achat, hors budget et hors listes).
const OUTINGS = [{ id: 1, date: '2026-10-19', slot: 'midi', note: 'chez Marie' }];
const outAt = (d, s) => OUTINGS.find((o) => o.date === d && o.slot === s);
MEALS.push(meal('2026-10-17', 'midi', 'las', 2, { rest: true }));
const daysAgo = (iso) => dayDiff(iso, TODAY);
const shopDays = () => LISTS.filter((l) => l.type === 'dated').map((l) => l.date);
const slotsOn = () => Object.keys(SLOTS).filter((s) => S.slots[s]);

// ---------- Menu ----------
VIEWS.menu = () => {
  const days = [...Array(dayDiff(MENU.start, MENU.end) + 1)].map((_, k) => addDays(MENU.start, k));
  const at = (d, s) => MEALS.filter((m) => m.date === d && m.slot === s);
  const mealBtn = (m) => `<button class="meal${m.sugg ? ' pending' : ''}${m.rest ? ' rest' : ''}" data-a="meal-open" data-id="${m.id}"><span class="nm">${m.rest ? I('repeat', 's') + ' ' : DISHES[m.dish].parts ? I('puzzle', 's') + ' ' : ''}${dishLabel(m)}</span>${m.sugg ? `<span class="pill warn">${m.sugg}</span>` : m.p !== 4 ? `<span class="pill">${m.p} p.</span>` : ''}</button>`;
  const outBtn = (o) => `<button class="meal out" data-a="out-open" data-id="${o.id}"><span class="nm">${I('pin', 's')} ${o.note ? esc(o.note) : 'À l’extérieur'}</span></button>`;
  const ghost = (d, s) => `<button class="meal ghost" data-a="meal-add" data-date="${d}" data-slot="${s}">${I('plus', 's')} ${SLOTS[s]}</button>`;
  const agenda = days.map((d) => `<div class="day${d === TODAY ? ' today' : ''}${d < TODAY ? ' past' : ''}"><div class="dn"><small>${fmtD(d, { weekday: 'short' }).replace('.', '')}</small><b>${dt(d).getUTCDate()}</b></div>
    <div class="slots">${shopDays().includes(d) ? `<span class="shopday">${I('cart', 's')} Courses</span>` : ''}${slotsOn().map((s) => { const ms = at(d, s); const o = outAt(d, s); if (o) return outBtn(o).replace('<span class="nm">', `<span class="sl">${SLOTS[s]}</span><span class="nm">`); return ms.length ? ms.map((m) => mealBtn(m).replace('<span class="nm">', `<span class="sl">${SLOTS[s]}</span><span class="nm">`)).join('') : ghost(d, s); }).join('')}</div></div>`).join('');
  const weeks = [days.slice(0, 7), days.slice(7, 14)].filter((w) => w.length);
  const grid = weeks.map((w) => `<div class="wgrid"><span></span>${w.map((d) => `<span class="h${d === TODAY ? ' today' : ''}">${fmtD(d)}${shopDays().includes(d) ? ` ${I('cart', 's')}` : ''}</span>`).join('')}
    ${slotsOn().map((s) => `<span class="sl">${SLOTS[s]}</span>${w.map((d) => `<div class="cell">${outAt(d, s) ? outBtn(outAt(d, s)) : at(d, s).map(mealBtn).join('') || ghost(d, s).replace(` ${SLOTS[s]}`, '')}</div>`).join('')}`).join('')}</div>`).join('');
  const wishes = WISHES.map((w) => { const d = DISHES[w.dish]; return `<div class="card wish" data-wish="${w.id}">${tile(w.dish, '', w.status === 'pending' ? `<span class="pill warn">à valider</span>` : '')}
    <b>${d.draft ? I('edit', 's') + ' ' : ''}${d.n}</b><span class="sub">${w.by === 'Thomas' ? 'Votre envie' : 'Envie de ' + w.by}${ppShort(w.dish) ? ` · ${ppShort(w.dish)} / pers.` : ''}</span>
    <div class="btn-row icons">${isM() && w.status === 'pending' ? bI('check', 'Valider l’envie', `data-a="wish-ok" data-id="${w.id}"`, 'sec sm') : ''}${bI('calendar', 'Mettre au menu', `data-a="wish-plan" data-id="${w.id}"`, 'sm')}</div></div>`; }).join('');
  return {
    title: 'Menu', sub: `${fmtD(MENU.start, { day: 'numeric', month: 'short' })} → ${fmtD(MENU.end, { day: 'numeric', month: 'short' })} · ${MENU.saved ? 'menu fixé' : 'période proposée'}`, large: true,
    actions: `<button class="ib" data-a="menu-share" aria-label="Partager">${I('share')}</button><button class="ib" data-a="menu-more" aria-label="Options">${I('sliders')}</button>`,
    body: `<div class="between" style="margin-bottom:6px"><button class="btn sm sec" data-a="menu-nav" data-d="-1">${I('back', 's')} Précédent</button><span class="small muted">14 jours</span><button class="btn sm sec" data-a="menu-nav" data-d="1">Suivant ${I('chev', 's')}</button></div>
      ${(() => { const c = menuCost(); return c.persons ? `<div class="card hstack" style="margin:6px 0 10px;gap:12px"><span class="ico acc">${I('tag')}</span><span class="grow"><b>Budget estimé : ${c.partial ? 'dès ' : '≈ '}${eur(c.total)}</b><span class="sub" style="display:block">≈ ${eur(Math.round(c.total / c.persons))} par personne et par repas${c.partial ? ` · estimation partielle${c.unknown ? ` (${plural(c.unknown, 'repas')} sans prix)` : ''}` : ''}</span></span></div>
        ${c.weeks.length > 1 ? `<div class="small" style="margin:6px 2px 10px">${c.weeks.map((t, k) => (t == null ? '' : `<div class="between"><span class="muted">Semaine du ${fmtD(addDays(MENU.start, 7 * k), { day: 'numeric', month: 'short' })}</span><b class="num">${eur(t)}</b></div>`)).join('')}</div>` : ''}` : ''; })()}
      <div class="agenda">${agenda}</div>${grid}
      <p class="sub" style="margin:8px 2px">Les repas alimentent la liste de leur période : un repas en ${I('cart', 's')} jour de courses tombe dans cette liste. Appui long sur un repas pour le déplacer.</p>
      <div class="sh"><span>Envies de plats</span><button data-a="wish-add">＋ Proposer</button></div>
      ${isM() ? '<p class="sub" style="margin:-4px 2px 8px">Glissez une envie sur un créneau libre du menu (appui long sur téléphone).</p>' : ''}
      <div class="hscroll wishes">${wishes}</div>
      <div class="sh"><span>Remarques</span></div>
      ${isM() ? `<textarea class="in" rows="3" placeholder="Remarques sur ce menu (imprimées avec l’export)" data-ch="menu-note">${esc(MENU.note)}</textarea>` : `<div class="card">${esc(MENU.note) || '<span class="muted">Aucune remarque</span>'}</div>`}`,
  };
};
CH['menu-note'] = (el) => { MENU.note = el.value; toast('Remarques enregistrées'); };
A['menu-nav'] = () => toast('Période suivante : 26 oct. → 8 nov. (proposée)');
A['menu-more'] = () => sheet(`<h3>Menu</h3><div class="menu-pop">
  <button data-a="menu-dates"><span class="ico">${I('calendar')}</span>Fixer les dates du menu</button>
  <button data-a="menu-slots"><span class="ico">${I('eye')}</span>Repas affichés</button>
  <button data-a="go" data-v="export"><span class="ico">${I('doc')}</span>Exporter en A4</button>
  <button data-a="menu-share"><span class="ico">${I('link')}</span>Lien d’affichage public</button></div>`);
A['menu-dates'] = () => sheet(`<h3>Dates du menu</h3><p class="lead">Un menu dure au plus 62 jours et ne chevauche pas un autre. Sans menu fixé, la période est proposée par tranches de ${HOUSE.menuDays} jours.</p>
  <div class="grid2"><label class="field"><span>Du</span><input class="in" type="date" value="${MENU.start}"></label><label class="field"><span>Au</span><input class="in" type="date" value="${MENU.end}"></label></div>
  <div class="foot"><button class="btn danger" data-a="close">Retirer le menu</button><button class="btn" data-a="close">Enregistrer</button></div>`);
A['menu-slots'] = () => live(() => `<h3>Repas affichés</h3><p class="lead">Mémorisé sur cet appareil.</p><div class="group">${Object.entries(SLOTS).map(([k, v]) => `<button class="row tap" data-a="slot-t" data-k="${k}"><span class="grow">${v}</span><span class="sw ${S.slots[k] ? 'on' : ''}"></span></button>`).join('')}</div>`);
A['slot-t'] = (el) => { S.slots[el.dataset.k] = !S.slots[el.dataset.k]; if (!slotsOn().length) S.slots.soir = true; refresh(); render(); };
A['menu-share'] = () => sheet(`<h3>Lien d’affichage</h3><p class="lead">Le menu en lecture seule, sans connexion : pour la tablette de la cuisine ou la famille.</p>
  <div class="hstack"><input class="in grow" readonly value="https://exemple.be/cabas/#/affichage/k3J9-xQ2" id="share-url"><button class="btn sm" data-a="share-copy">Copier</button></div>
  <div class="foot"><button class="btn danger" data-a="close">Révoquer le lien</button><button class="btn sec" data-a="go" data-v="display">Aperçu</button></div>`);
A['share-copy'] = async () => { try { await navigator.clipboard.writeText($('share-url').value); toast('Lien copié'); } catch { $('share-url').select(); } };

// Ajout d'un repas : choix du plat puis reglages.
let pm = null;
A['meal-add'] = (el) => { pm = { date: el.dataset.date, slot: el.dataset.slot, p: 4, opts: {}, skip: [], res: [], q: '', tag: '' }; live(pickHtml); };
function pickHtml() {
  const n = norm(pm.q), wished = WISHES.map((w) => w.dish);
  const ks = Object.keys(DISHES).filter((k) => (!n || norm(DISHES[k].n).includes(n)) && (!pm.tag || tagsOf(k).includes(pm.tag)))
    .sort((a, b) => wished.includes(b) - wished.includes(a) || (DISHES[a].last || '0').localeCompare(DISHES[b].last || '0'));
  const tags = [...new Set(Object.keys(DISHES).flatMap(tagsOf))].sort();
  return `<h3>${fmtD(pm.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[pm.slot]}</h3>
    <div class="search" style="margin:10px 0 8px">${I('search')}<input class="in" id="pick-q" placeholder="Rechercher un plat…" value="${esc(pm.q)}" data-in="pick-q" autocomplete="off"></div>
    <div class="chips" style="margin-bottom:8px">${tags.map((t) => `<button class="chip ${pm.tag === t ? 'on' : ''}" data-a="pick-tag" data-t="${t}">#${t}</button>`).join('')}</div>
    <div class="group">${ks.map((k) => { const d = DISHES[k]; return `<button class="row tap" data-a="pick-dish" data-k="${k}"><span class="avatar" style="--c:hsl(${hue(d.n)} 40% 45%)">${d.n[0]}</span>
      <span class="grow"><b>${wished.includes(k) ? I('bulb', 's') + ' ' : ''}${d.n}</b><span class="sub" style="display:block">${d.parts ? `${I('puzzle', 's')} ${d.parts.map(([p]) => DISHES[p].n).join(', ')}` : d.last ? `dernière fois il y a ${daysAgo(d.last)} j` : 'jamais servi'}</span></span>${ppShort(k) ? `<span class="num small">${ppShort(k)} / pers.</span>` : ''}${I('chev', 's chev')}</button>`; }).join('')}
    ${isM() && pm.q ? `<button class="row tap" data-a="dish-new" style="color:var(--accent)"><span class="ico acc">${I('plus')}</span><b class="grow">Nouveau plat « ${esc(pm.q)} »</b></button>` : ''}</div>
    ${isM() ? `<div class="group" style="margin-top:12px"><button class="row tap" data-a="out-set"><span class="ico">${I('pin')}</span><span class="grow"><b>Repas à l’extérieur</b><span class="sub" style="display:block">Restaurant, invités… : aucun achat</span></span>${I('chev', 's chev')}</button>
      <button class="row tap" data-a="rest-set"><span class="ico">${I('repeat')}</span><span class="grow"><b>Restes</b><span class="sub" style="display:block">Un repas déjà cuisiné : aucun achat, hors budget</span></span>${I('chev', 's chev')}</button></div>` : ''}`;
}
IN['pick-q'] = (el) => { pm.q = el.value; refresh(); const i = $('pick-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
A['pick-tag'] = (el) => { pm.tag = pm.tag === el.dataset.t ? '' : el.dataset.t; refresh(); };
A['pick-dish'] = (el) => { pm.dish = el.dataset.k; pm.skip = []; pm.opts = Object.fromEntries((DISHES[pm.dish].groups || []).map((g) => [g.g, g.o[0][0]])); live(cfgHtml); };
const ingsOfMeal = (k, opts, skip = []) => {
  const d = DISHES[k];
  const own = [...d.ings, ...(d.groups || []).flatMap((g) => (g.o.find((o) => o[0] === opts[g.g]) || g.o[0])[1])];
  const parts = (d.parts || []).filter(([p]) => !skip.includes(p)).flatMap(([p]) => DISHES[p].ings);
  const all = [...own, ...parts].filter(([pid]) => !P[pid].base);
  return all.filter(([pid], k2) => all.findIndex(([x]) => x === pid) === k2);
};
function cfgHtml() {
  const d = DISHES[pm.dish], ings = ingsOfMeal(pm.dish, pm.opts, pm.skip);
  return `<h3>${d.n}</h3><p class="lead">${fmtD(pm.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[pm.slot]}</p>
    <div class="group"><div class="row"><span class="grow">Personnes</span><span class="stepper"><button data-a="pm-p" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${pm.p}</b><button data-a="pm-p" data-d="1" aria-label="Plus">${I('plus')}</button></span></div></div>
    ${(d.groups || []).map((g) => `<div class="sh"><span>${g.g}</span></div><div class="seg">${g.o.map(([o]) => `<button class="${pm.opts[g.g] === o ? 'on' : ''}" data-a="pm-opt" data-g="${g.g}" data-o="${o}">${o}</button>`).join('')}</div>`).join('')}
    ${d.parts ? `<div class="sh"><span>Recettes</span><span class="xs" style="text-transform:none;letter-spacing:0">décocher : pas cette fois</span></div><div class="group">${d.parts.map(([p]) => `<button class="row tap" data-a="pm-part" data-k="${p}"><span class="ck sq ${pm.skip.includes(p) ? '' : 'on'}">${I('check')}</span><span class="grow">${DISHES[p].n}</span><span class="sub">${DISHES[p].ings.length} ingr.</span></button>`).join('')}</div>` : ''}
    ${ings.length ? `<div class="sh"><span>À acheter</span><span class="xs" style="text-transform:none;letter-spacing:0">décocher ce qui est en réserve</span></div>
      <div class="group">${ings.map(([pid]) => `<button class="row tap" data-a="pm-res" data-pid="${pid}"><span class="ck sq ${pm.res.includes(pid) ? '' : 'on'}">${I('check')}</span><span class="grow">${P[pid].n}</span>${pm.res.includes(pid) ? '<span class="pill">en réserve</span>' : ''}</button>`).join('')}</div>` : '<p class="sub">Plat sans ingrédients détaillés : simple rappel.</p>'}
    <div class="sh"><span>Liste</span></div><select class="in"><option>Automatique : courses du ${fmtD(LISTS.filter((l) => l.type === 'dated' && l.date <= pm.date).map((l) => l.date).sort().pop() || '2026-10-13', { day: 'numeric', month: 'short' })}</option>${dated().map((l) => `<option>Liste du ${fmtD(l.date, { day: 'numeric', month: 'short' })}</option>`).join('')}</select>
    <div class="foot"><button class="btn sec" data-a="pm-back">Changer de plat</button><button class="btn" data-a="pm-save">${isM() ? 'Ajouter au menu' : 'Suggérer'}</button></div>`;
}
A['pm-p'] = (el) => { pm.p = Math.max(1, pm.p + Number(el.dataset.d)); refresh(); };
A['pm-opt'] = (el) => { pm.opts[el.dataset.g] = el.dataset.o; refresh(); };
A['pm-part'] = (el) => { const k = el.dataset.k; pm.skip = pm.skip.includes(k) ? pm.skip.filter((x) => x !== k) : [...pm.skip, k]; refresh(); };
A['pm-res'] = (el) => { const k = el.dataset.pid; pm.res = pm.res.includes(k) ? pm.res.filter((x) => x !== k) : [...pm.res, k]; refresh(); };
A['pm-back'] = () => live(pickHtml);
// Repas à l'extérieur : remplace les repas du créneau ; note facultative.
const dropSlot = (d, s) => { for (let k = MEALS.length - 1; k >= 0; k--) if (MEALS[k].date === d && MEALS[k].slot === s) MEALS.splice(k, 1); const k = OUTINGS.findIndex((o) => o.date === d && o.slot === s); if (k >= 0) OUTINGS.splice(k, 1); };
A['out-set'] = () => sheet(`<h3>${I('pin', 's')} Repas à l’extérieur</h3><p class="lead">${fmtD(pm.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[pm.slot]}. Aucun achat pour ce repas.</p>
  <label class="field"><span>Où ? (facultatif)</span><input class="in" id="out-note" placeholder="chez Marie, restaurant…" data-enter="out-ok"></label>
  <div class="foot"><button class="btn sec" data-a="close">Annuler</button><button class="btn" data-a="out-ok">Enregistrer</button></div>`);
A['out-ok'] = () => { const note = ($('out-note') || {}).value || ''; dropSlot(pm.date, pm.slot); OUTINGS.push({ id: Date.now(), date: pm.date, slot: pm.slot, note: note.trim() }); closeSheet(); toast('Repas à l’extérieur ajouté'); render(); };
A['out-open'] = (el) => { const o = OUTINGS.find((x) => x.id === Number(el.dataset.id)); sheet(`<h3>${I('pin', 's')} Repas à l’extérieur</h3><p class="lead">${fmtD(o.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[o.slot]}${o.note ? ' · ' + esc(o.note) : ''}</p>
  <div class="foot"><button class="btn danger" data-a="out-del" data-id="${o.id}">Retirer</button><button class="btn" data-a="close">Fermer</button></div>`); };
A['out-del'] = (el) => { OUTINGS.splice(OUTINGS.findIndex((o) => o.id === Number(el.dataset.id)), 1); closeSheet(); toast('Créneau libéré'); render(); };
// Restes : repas de reste d'un plat deja prevu les jours d'avant ; aucun achat, hors budget et hors listes.
A['rest-set'] = () => { S.q.restP = S.q.restP || 2; live(restHtml); };
const restSources = () => MEALS.filter((m) => !m.sugg && !m.rest && m.date < pm.date && dayDiff(m.date, pm.date) <= 6).sort((a, b) => b.date.localeCompare(a.date) || a.slot.localeCompare(b.slot));
const restHtml = () => `<h3>${I('repeat', 's')} Restes</h3><p class="lead">${fmtD(pm.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[pm.slot]}. Aucun achat : le repas ne compte ni dans la liste ni dans le budget.</p>
  <div class="group"><div class="row"><span class="grow">Personnes</span><span class="stepper"><button data-a="rest-p" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${S.q.restP}</b><button data-a="rest-p" data-d="1" aria-label="Plus">${I('plus')}</button></span></div></div>
  <div class="sh"><span>Restes de…</span></div>
  <div class="group">${restSources().map((m) => `<button class="row tap" data-a="rest-ok" data-id="${m.id}"><span class="grow"><b>${DISHES[m.dish].n}</b><span class="sub" style="display:block">${fmtD(m.date, { weekday: 'long', day: 'numeric' })} · ${SLOTS[m.slot]} · ${m.p} pers.</span></span>${I('chev', 's chev')}</button>`).join('') || '<p class="empty">Aucun repas des 6 derniers jours.</p>'}</div>`;
A['rest-p'] = (el) => { S.q.restP = Math.max(1, S.q.restP + Number(el.dataset.d)); refresh(); };
A['rest-ok'] = (el) => { const src = MEALS.find((m) => m.id === Number(el.dataset.id)); dropSlot(pm.date, pm.slot); MEALS.push(meal(pm.date, pm.slot, src.dish, S.q.restP, { rest: true })); closeSheet(); toast(`Restes · ${DISHES[src.dish].n} ajouté`); render(); };
A['pm-save'] = () => {
  if (!needNet()) return;
  if (pm.id) { Object.assign(MEALS.find((m) => m.id === pm.id), { dish: pm.dish, p: pm.p, opts: pm.opts, skip: pm.skip }); closeSheet(); toast('Repas mis à jour · liste recalculée'); render(); return; }
  if (isM()) { for (let k = MEALS.length - 1; k >= 0; k--) if (MEALS[k].date === pm.date && MEALS[k].slot === pm.slot && !MEALS[k].sugg) MEALS.splice(k, 1); }
  MEALS.push(meal(pm.date, pm.slot, pm.dish, pm.p, { opts: pm.opts, skip: pm.skip, sugg: isM() ? null : 'Thomas' }));
  const w = WISHES.findIndex((x) => x.dish === pm.dish); if (w >= 0 && isM()) WISHES.splice(w, 1);
  closeSheet(); toast(isM() ? `${DISHES[pm.dish].n} au menu · ingrédients ajoutés à la liste` : 'Repas suggéré au gestionnaire'); render();
};

// Fiche repas
A['meal-open'] = (el) => {
  const m = MEALS.find((x) => x.id === Number(el.dataset.id));
  if (!m) return;
  const d = DISHES[m.dish];
  if (m.rest) { sheet(`<h3>${I('repeat', 's')} ${dishLabel(m)}</h3><p class="lead">${fmtD(m.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[m.slot]} · ${m.p} personnes</p>
    <p class="sub">Restes d’un repas déjà cuisiné : aucun achat, ce repas n’alimente pas la liste et n’entre pas dans le budget.</p>
    <div class="btn-row" style="margin-top:14px">${bI('book', 'Fiche du plat', `data-a="go" data-v="dish" data-id="${m.dish}"`, 'sec')}${isM() ? bI('trash', 'Retirer', `data-a="meal-del" data-id="${m.id}"`, 'sec danger-t') : ''}</div>`); return; }
  sheet(`<h3>${dishLabel(m)}</h3><p class="lead">${fmtD(m.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[m.slot]} · ${m.p} personnes${m.sugg ? ` · suggéré par ${m.sugg}` : ''}</p>
    ${tile(m.dish, '', tagsOf(m.dish).map((t) => `<span class="pill">#${t}</span>`).join(''))}
    ${(() => { const c = mealCost(m); return c.cost != null ? `<div class="between" style="margin:10px 2px 0"><span class="muted">Coût estimé${c.partial ? ' (partiel)' : ''}</span><span><b class="num">${c.partial ? 'dès ' : '≈ '}${eur(c.cost)}</b> <span class="sub">· ${eur(Math.round(c.cost / m.p))} / pers.</span></span></div>` : ''; })()}
    ${d.parts ? `<div class="sh"><span>Recettes</span></div><div class="group">${d.parts.map(([p]) => `<button class="row tap" data-a="go" data-v="dish" data-id="${p}"><span class="ico plum">${I('puzzle')}</span><span class="grow ${m.skip.includes(p) ? 'faint' : ''}" ${m.skip.includes(p) ? 'style="text-decoration:line-through"' : ''}><b>${DISHES[p].n}</b>${m.skip.includes(p) ? ' · pas cette fois' : ''}</span>${I('chev', 's chev')}</button>`).join('')}</div>` : ''}
    <div class="btn-row" style="margin-top:14px">${bI('book', d.parts ? 'Voir les recettes' : 'Voir la recette', `data-a="go" data-v="cook" data-id="${m.dish}" data-p="${m.p}"`, '')}${isM() && !m.sugg ? `${bI('sliders', 'Personnes, recettes…', `data-a="meal-edit" data-id="${m.id}"`)}${bI('repeat', 'Changer de plat', `data-a="meal-edit" data-id="${m.id}"`)}${bI('edit', 'Modifier le plat', `data-a="go" data-v="dish" data-id="${m.dish}"`)}${bI('trash', 'Retirer du menu', `data-a="meal-del" data-id="${m.id}"`, 'danger')}` : ''}</div>
    ${isM() && !m.sugg ? `<div class="sh"><span>Déplacer</span></div><div class="hstack"><input class="in" type="date" value="${m.date}" style="flex:1;min-width:0"><select class="in" style="width:120px">${Object.entries(SLOTS).map(([k, v]) => `<option ${k === m.slot ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="btn sec sm" data-a="meal-move" data-id="${m.id}">${I('move', 's')}</button></div><p class="sub">Vers un créneau occupé : les deux repas échangent leur place.</p>` : ''}
    ${m.sugg && isM() ? `<div class="foot"><button class="btn danger" data-a="meal-del" data-id="${m.id}">Refuser</button><button class="btn" data-a="meal-accept" data-id="${m.id}">Accepter</button></div>` : ''}`);
};
A['meal-accept'] = (el) => { if (!needNet()) return; const m = MEALS.find((x) => x.id === Number(el.dataset.id)); m.sugg = null; closeSheet(); toast('Repas accepté'); render(); };
A['meal-del'] = (el) => { if (!needNet()) return; const k = MEALS.findIndex((x) => x.id === Number(el.dataset.id)), m = MEALS[k]; MEALS.splice(k, 1); closeSheet(); toast('Repas retiré · ingrédients retirés de la liste', () => { MEALS.splice(k, 0, m); render(); }); render(); };
A['meal-move'] = () => { closeSheet(); toast('Repas déplacé'); };
A['meal-edit'] = (el) => { const m = MEALS.find((x) => x.id === Number(el.dataset.id)); pm = { id: m.id, date: m.date, slot: m.slot, dish: m.dish, p: m.p, opts: { ...m.opts }, skip: [...m.skip], res: [], q: '' }; live(cfgHtml); };

// Envies
A['wish-add'] = () => { pm = { q: '' }; live(() => `<h3>Envie de plat</h3><p class="lead">Sans date : un gestionnaire la mettra au menu. Un nom nouveau crée une fiche brouillon que vous pouvez compléter.</p>
  <div class="search">${I('search')}<input class="in" id="wish-q" placeholder="Un plat existant ou un nouveau nom…" value="${esc(pm.q)}" data-in="wish-q"></div>
  <div class="group" style="margin-top:10px">${Object.keys(DISHES).filter((k) => pm.q && norm(DISHES[k].n).includes(norm(pm.q))).map((k) => `<button class="row tap" data-a="wish-pick" data-k="${k}"><span class="grow">${DISHES[k].n}</span>${I('plus')}</button>`).join('')}
  ${pm.q ? `<button class="row tap" data-a="wish-new" style="color:var(--accent)"><span class="ico acc">${I('plus')}</span><b class="grow">« ${esc(pm.q)} » (nouveau)</b></button>` : ''}</div>`); };
IN['wish-q'] = (el) => { pm.q = el.value; refresh(); const i = $('wish-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
A['wish-pick'] = (el) => { WISHES.push({ id: Date.now(), dish: el.dataset.k, by: 'Thomas', status: isM() ? 'ok' : 'pending' }); closeSheet(); toast('Envie ajoutée'); render(); };
A['wish-new'] = () => { const k = 'w' + Date.now(); DISHES[k] = { n: pm.q, p: 4, tags: [], ings: [], draft: isM() ? null : 'Thomas' }; WISHES.push({ id: Date.now(), dish: k, by: 'Thomas', status: isM() ? 'ok' : 'pending' }); closeSheet(); toast(isM() ? 'Envie ajoutée · fiche créée' : 'Envie proposée · fiche brouillon créée'); render(); };
A['wish-ok'] = (el) => { WISHES.find((w) => w.id === Number(el.dataset.id)).status = 'ok'; toast('Envie validée'); render(); };
A['wish-plan'] = (el) => { const w = WISHES.find((x) => x.id === Number(el.dataset.id)); pm = { date: '2026-10-23', slot: 'soir', p: 4, opts: {}, skip: [], res: [], q: '' }; A['pick-dish']({ dataset: { k: w.dish } }); };

// Export A4 et affichage public
VIEWS.export = () => ({
  title: 'Export A4', sub: 'Aperçu ; dans l’app : Imprimer ou enregistrer en PDF depuis le navigateur',
  body: `<div class="chips" style="margin-bottom:10px"><button class="chip on">Ce menu</button><button class="chip">2 semaines</button><button class="chip on">Midi</button><button class="chip on">Soir</button><button class="chip">Personnes</button><button class="chip on">Jours de courses</button><button class="chip on">Remarques</button></div>
    <div class="a4wrap"><div class="a4"><h2>Menu du 12 au 25 octobre</h2>
    ${[0, 7].map((o) => `<table style="margin-bottom:10px"><tr><th style="width:44px"></th>${[...Array(7)].map((_, k) => `<th>${fmtD(addDays(MENU.start, o + k))}${shopDays().includes(addDays(MENU.start, o + k)) ? ' 🛒' : ''}</th>`).join('')}</tr>
      ${['midi', 'soir'].map((s) => `<tr><th>${SLOTS[s]}</th>${[...Array(7)].map((_, k) => `<td>${MEALS.filter((m) => !m.sugg && m.date === addDays(MENU.start, o + k) && m.slot === s).map(dishLabel).join('<br>')}</td>`).join('')}</tr>`).join('')}</table>`).join('')}
    <div class="note"><b>Remarques</b><br>${esc(MENU.note)}</div></div></div>`,
});
VIEWS.display = () => ({
  title: 'Menu de la semaine', noTabs: true, sub: `${HOUSE.name} · lien d’affichage en lecture seule`,
  body: `<div class="disp">${[...Array(7)].map((_, k) => { const d = addDays(TODAY, k); const ms = MEALS.filter((m) => !m.sugg && m.date === d); return `<div class="d"><b>${fmtD(d, { weekday: 'short', day: 'numeric' })}</b><span>${ms.map((m) => `<span class="faint xs">${SLOTS[m.slot]}</span> ${dishLabel(m)}`).join('<br>') || '<span class="faint">—</span>'}</span></div>`; }).join('')}</div>`,
});

// ---------- Plats ----------
const DFILTERS = [['all', 'Tous'], ['recipe', 'Avec recette'], ['parts', 'Composés'], ['planned', 'Au menu'], ['memo', 'Sans détail'], ['draft', 'Suggestions']];
const nextOf = (k) => MEALS.filter((m) => !m.sugg && m.date >= TODAY && (m.dish === k || (DISHES[m.dish].parts || []).some(([p]) => p === k && !m.skip.includes(p)))).map((m) => m.date).sort()[0];
const hasRecipe = (d) => !!(d.url || d.steps || d.notes);
VIEWS.dishes = () => {
  const f = S.q.df || 'all', tg = S.q.dt || '', n = norm(S.q.dq);
  const ks = Object.keys(DISHES).filter((k) => { const d = DISHES[k];
    return (!n || norm(d.n).includes(n) || d.ings.some(([pid]) => norm(P[pid].n).includes(n)) || (d.parts || []).some(([p]) => norm(DISHES[p].n).includes(n)))
      && (!tg || tagsOf(k).includes(tg)) && priceOk(k, S.q.dp) && (f === 'all' || (f === 'recipe' && hasRecipe(d)) || (f === 'parts' && d.parts) || (f === 'planned' && nextOf(k)) || (f === 'memo' && !d.ings.length && !d.parts) || (f === 'draft' && d.draft)); })
    .sort((a, b) => DISHES[a].n.localeCompare(DISHES[b].n, 'fr'));
  const tags = [...new Set(Object.keys(DISHES).flatMap(tagsOf))].sort();
  return {
    title: 'Plats', sub: `${plural(Object.keys(DISHES).length, 'plat')} du foyer`, large: true,
    actions: isM() ? `<button class="ib" data-a="dish-new" aria-label="Nouveau plat">${I('plus')}</button>` : '',
    body: `<div class="search" style="margin-bottom:10px">${I('search')}<input class="in" id="dq" placeholder="Plat, ingrédient, recette…" value="${esc(S.q.dq || '')}" data-in="dq"></div>
      <div class="chips">${DFILTERS.map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-a="df" data-f="${k}">${t}</button>`).join('')}</div>
      <div class="chips" style="margin:6px -16px 14px">${tags.map((t) => `<button class="chip ${tg === t ? 'on' : ''}" data-a="dt" data-t="${t}" style="height:30px;font-size:12.5px">#${t}</button>`).join('')}</div>
      <div class="chips" style="margin:0 -16px 14px"><span class="muted small" style="align-self:center;padding-left:16px;white-space:nowrap">Prix / pers.</span>${PRICES.map(([k, t]) => `<button class="chip ${S.q.dp === k ? 'on' : ''}" data-a="dp" data-k="${k}" style="height:30px;font-size:12.5px">${t}</button>`).join('')}</div>
      <div class="dgrid">${ks.map((k) => { const d = DISHES[k], nx = nextOf(k);
        return `<button class="dcard" data-a="go" data-v="dish" data-id="${k}">${tile(k, '', `${ppShort(k) ? `<span class="pill">${ppShort(k)}</span>` : ''}${d.parts ? `<span class="pill">${I('puzzle', 's')} ${d.parts.length}</span>` : ''}${hasRecipe(d) ? `<span class="pill">${I('book', 's')}</span>` : ''}${d.draft ? `<span class="pill">${I('edit', 's')}</span>` : ''}`)}
          <div><h4>${d.n}</h4><div class="sub">${nx ? `<span style="color:var(--accent);font-weight:600">prévu ${fmtD(nx, { weekday: 'short', day: 'numeric' })}</span>` : d.last ? `il y a ${daysAgo(d.last)} j` : 'jamais servi'}</div></div></button>`; }).join('')}</div>
      ${!ks.length ? `<div class="empty">Aucun plat trouvé.${isM() && S.q.dq ? `<br><button class="btn" style="margin-top:10px" data-a="dish-new">Créer « ${esc(S.q.dq)} »</button>` : ''}</div>` : ''}`,
  };
};
IN.dq = (el) => { S.q.dq = el.value; render(); const i = $('dq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
A.df = (el) => { S.q.df = el.dataset.f; render(); };
A.dp = (el) => { S.q.dp = S.q.dp === el.dataset.k ? '' : el.dataset.k; render(); };
A.dt = (el) => { S.q.dt = S.q.dt === el.dataset.t ? '' : el.dataset.t; render(); };
A['dish-new'] = () => { closeSheet(); const k = 'n' + Date.now(); DISHES[k] = { n: (pm && pm.q) || S.q.dq || 'Nouveau plat', p: 4, tags: [], ings: [], isNew: true }; go('dish', { id: k, edit: true }); };

const fmtQ = (q) => String(Math.round(q * 10) / 10).replace('.', ',');
const UNITS = { g: 'g', ml: 'ml', cc: 'CC', cs: 'CS', pc: 'pièce' };
const ingText = ([pid, q, u], f = 1) => (q == null ? 'selon goût' : u ? (u === 'g' && q * f >= 1000 ? `${fmtQ((q * f) / 1000)} kg` : `${fmtQ(q * f)} ${UNITS[u]}${u === 'pc' && q * f > 1 ? 's' : ''}`) : `${fmtQ(q * f)} × ${P[pid].u}`);
VIEWS.dish = (t) => {
  const k = t.id, d = DISHES[k], tabK = S.q['dtab' + k] || (d.parts ? 'parts' : 'ing');
  const canEdit = isM() || (d.draft === 'Thomas');
  const used = Object.keys(DISHES).filter((x) => (DISHES[x].parts || []).some(([p]) => p === k));
  const tabs = [['ing', 'Ingrédients'], ['rec', 'Recette'], ...(used.length ? [] : [['parts', 'Composition']]), ['hist', 'Historique']];
  const ingRow = (g, del) => `<div class="ing"><span class="grow">${P[g[0]].n}${P[g[0]].base ? ' <span class="pill">de base</span>' : ''}</span><span class="q">${ingText(g)}</span>${!t.edit && ingCostOf(g) != null ? `<span class="sub" style="min-width:52px;text-align:right">≈ ${eur(ingCostOf(g))}</span>` : ''}${del && t.edit ? `<button class="ib" data-a="noop" aria-label="Retirer">${I('x', 's')}</button>` : ''}</div>`;
  const body = {
    ing: `<div class="card">${d.ings.map((g) => ingRow(g, true)).join('') || `<p class="muted" style="margin:6px 0">${d.parts ? 'Rien en plus des recettes.' : 'Aucun ingrédient : simple rappel dans la liste.'}</p>`}
        ${t.edit ? `<div class="search" style="margin-top:8px">${I('plus')}<input class="in" placeholder="Ajouter un ingrédient (produit)…" style="background:var(--raised);box-shadow:none"></div>` : ''}</div>
      ${(d.groups || []).map((g) => `<div class="sh"><span>Variante · ${g.g}</span><span class="xs" style="text-transform:none;letter-spacing:0">un choix au menu</span></div><div class="card">${g.o.map(([o, xs]) => `<div class="ing"><b class="grow">${o}</b><span class="sub">${xs.map(([pid]) => P[pid].n).join(', ') || 'rien en plus'}</span></div>`).join('')}</div>`).join('')}
      ${t.edit ? `<button class="btn ghost" style="margin-top:8px" data-a="noop">${I('plus')} Groupe de variantes</button>` : ''}`,
    rec: `${d.url || t.edit ? `<div class="card hstack" style="margin-bottom:10px">${I('link')}<span class="grow ellip small">${d.url || '<span class="faint">Lien vers une recette en ligne</span>'}</span>${t.edit ? `<button class="btn sm" data-a="rec-import">Importer</button>` : `<a class="btn sm sec" href="${d.url}" target="_blank" rel="noopener">Ouvrir</a>`}</div>` : ''}
      ${d.steps ? `<div class="card"><ol class="steps">${d.steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>` : `<div class="empty">Pas d’étapes${t.edit ? '' : ' renseignées'}.</div>`}
      ${d.notes ? `<div class="sh"><span>Notes</span></div><div class="card">${d.notes}</div>` : ''}`,
    parts: `<p class="sub" style="margin:0 2px 10px">Plusieurs recettes pour un même plat : leurs ingrédients s’additionnent dans les courses.</p>
      <div class="group">${(d.parts || []).map(([p, por]) => `<div class="row"><span class="ico plum">${I('puzzle')}</span><button class="grow" style="text-align:left" data-a="go" data-v="dish" data-id="${p}"><b>${DISHES[p].n}</b><span class="sub" style="display:block">${por} portions sur ${DISHES[p].p} · ${hasRecipe(DISHES[p]) ? 'recette' : 'à compléter'}</span></button>${t.edit ? `<span class="stepper"><button data-a="noop">${I('minus', 's')}</button><b>${por}</b><button data-a="noop">${I('plus', 's')}</button></span>` : I('chev', 's chev')}</div>`).join('') || '<p class="empty">Plat simple : aucune recette rattachée.</p>'}</div>
      ${t.edit || isM() ? `<button class="btn sec full" style="margin-top:10px" data-a="part-add" data-id="${k}">${I('plus')} Ajouter une recette</button>` : ''}`,
    hist: `<div class="grid2"><div class="card"><div class="big num">${d.times || 0}</div><div class="sub">fois servi</div></div><div class="card"><div class="big num">${d.last ? daysAgo(d.last) + ' j' : '—'}</div><div class="sub">depuis la dernière</div></div></div>
      <div class="sh"><span>À venir</span></div><div class="group">${MEALS.filter((m) => m.date >= TODAY && (m.dish === k || (DISHES[m.dish].parts || []).some(([p]) => p === k))).map((m) => `<button class="row tap" data-a="meal-open" data-id="${m.id}"><span class="grow"><b>${fmtD(m.date)}</b> · ${SLOTS[m.slot]} · ${m.p} pers.${m.dish !== k ? ` <span class="pill plum">${I('puzzle', 's')} ${DISHES[m.dish].n}</span>` : ''}</span>${I('chev', 's chev')}</button>`).join('') || '<p class="empty">Pas prévu au menu.</p>'}</div>
      <div class="sh"><span>5 dernières fois</span></div><div class="group">${[...Array(Math.min(d.times || 0, 5))].map((_, j) => `<div class="row"><span class="grow">${fmtD(addDays(d.last, -j * 23), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><span class="sub">Soir · 4 pers.</span></div>`).join('') || '<p class="empty">Jamais servi.</p>'}</div>`,
  }[tabK];
  return {
    title: d.n, sub: '',
    actions: canEdit ? (t.edit ? `<button class="btn sm" data-a="dish-save" data-id="${k}">${d.draft && isM() ? 'Valider' : 'Enregistrer'}</button>` : `<button class="ib" data-a="dish-edit" data-id="${k}" aria-label="Modifier">${I('edit')}</button><button class="ib" data-a="dish-menu" data-id="${k}" aria-label="Actions">${I('more')}</button>`) : '',
    body: `${d.draft ? `<div class="banner">${I('edit')}<span class="grow">Proposé par ${d.draft} · à valider par un gestionnaire</span></div>` : ''}
      <div class="cols"><div>${tile(k, 'dhero', `${d.parts ? `<span class="pill">${I('puzzle', 's')} plat composé</span>` : ''}${tagsOf(k).map((x) => `<span class="pill">#${x}</span>`).join('')}`)}
      ${t.edit ? `<div class="stack" style="margin-top:14px"><label class="field"><span>Nom</span><input class="in" value="${esc(d.n)}" data-ch="dish-name" data-id="${k}"></label>
        <div class="grid2"><label class="field"><span>Portions</span><input class="in" type="number" value="${d.p}"></label><label class="field"><span>Temps</span><input class="in" value="${d.t || ''}" placeholder="45 min"></label></div>
        <label class="field"><span>Tags</span><input class="in" value="${d.tags.join(', ')}" placeholder="rapide, végé, hiver…"><span class="sub">« Économique » est automatique : coût par personne sous le palier des réglages${isEco(k) ? ' (ce plat l’a)' : ''}.</span></label></div>`
      : `<h1 class="mid" style="font-size:26px;margin:14px 2px 4px">${d.n}</h1><div class="hstack small muted" style="margin:0 2px 4px">${I('people', 's')} ${d.p} pers.${dishCost(k).pp != null ? ` · <b>${ppShort(k)} / pers.</b>${dishCost(k).partial ? ` (${plural(dishCost(k).missing, 'ingrédient')} sans prix)` : ''}` : ''}${d.t ? ` · ${I('clock', 's')} ${d.t}` : ''}${used.length ? ` · dans ${used.map((x) => `<button style="color:var(--plum);font-weight:650" data-a="go" data-v="dish" data-id="${x}">${DISHES[x].n}</button>`).join(', ')}` : ''}</div>`}
      </div><div>
      <div class="seg" style="margin:14px 0 12px">${tabs.map(([x, n]) => `<button class="${tabK === x ? 'on' : ''}" data-a="dtab" data-id="${k}" data-k="${x}">${n}</button>`).join('')}</div>
      ${body}</div></div>`,
    dock: t.edit ? null : `<div class="btn-row" style="flex:1">${bI('book', 'Cuisiner', `data-a="go" data-v="cook" data-id="${k}" data-p="${d.p}"`)}${bI('calendar', isM() ? 'Ajouter au menu' : 'Suggérer au menu', `data-a="dish-plan" data-id="${k}"`, '')}</div>`,
  };
};
A.dtab = (el) => { S.q['dtab' + el.dataset.id] = el.dataset.k; render(); };
A['dish-edit'] = (el) => replace('dish', { id: el.dataset.id, edit: true });
CH['dish-name'] = (el) => { DISHES[el.dataset.id].n = el.value; };
A['dish-save'] = (el) => { if (!needNet()) return; const d = DISHES[el.dataset.id], wasDraft = d.draft; if (isM()) d.draft = null; delete d.isNew; replace('dish', { id: el.dataset.id }); toast(wasDraft && isM() ? 'Fiche validée' : 'Plat enregistré · listes recalculées'); };
A['dish-menu'] = (el) => sheet(`<h3>${DISHES[el.dataset.id].n}</h3><div class="menu-pop">
  <button data-a="dish-edit" data-id="${el.dataset.id}"><span class="ico">${I('edit')}</span>Modifier la fiche</button>
  <button data-a="noop"><span class="ico">${I('repeat')}</span>Dupliquer</button>
  <button class="danger" data-a="dish-del" data-id="${el.dataset.id}"><span class="ico">${I('trash')}</span>Supprimer</button></div>`);
A['dish-del'] = (el) => confirmSheet(`Supprimer « ${DISHES[el.dataset.id].n} » ?`, 'Les repas à venir sont retirés du menu et leurs ingrédients des listes. Les menus passés gardent son nom.', 'Supprimer', () => { delete DISHES[el.dataset.id]; back(); toast('Plat supprimé'); });
A['dish-plan'] = (el) => { pm = { date: '2026-10-23', slot: 'soir', p: 4, opts: {}, skip: [], res: [], q: '' }; A['pick-dish']({ dataset: { k: el.dataset.id } }); };
A['part-add'] = (el) => { const k = el.dataset.id; sheet(`<h3>Ajouter une recette</h3><p class="lead">Un plat existant (pas un autre plat composé), ou un nouveau plat à compléter.</p>
  <div class="search">${I('search')}<input class="in" placeholder="Rechercher un plat…"></div>
  <div class="group" style="margin-top:10px">${Object.keys(DISHES).filter((x) => x !== k && !DISHES[x].parts && !(DISHES[k].parts || []).some(([p]) => p === x)).slice(0, 6).map((x) => `<button class="row tap" data-a="part-ok" data-id="${k}" data-p="${x}"><span class="grow">${DISHES[x].n}</span><span class="sub">${DISHES[x].p} p.</span>${I('plus')}</button>`).join('')}</div>`); };
A['part-ok'] = (el) => { const d = DISHES[el.dataset.id]; d.parts = [...(d.parts || []), [el.dataset.p, DISHES[el.dataset.p].p]]; closeSheet(); toast(`${DISHES[el.dataset.p].n} ajouté à la composition`); render(); };
A['rec-import'] = () => {
  sheet(`<h3>Lecture de la recette…</h3><p class="lead">Données de la page (schema.org/Recipe).</p><div class="prog"><i style="width:60%"></i></div>`);
  setTimeout(() => sheet(`<h3>Recette trouvée</h3><p class="lead">Cocher ce qu’il faut reprendre.</p>
    <div class="group">${[['Nom', 'Houmous express'], ['Portions', '4 personnes'], ['Temps', '15 min'], ['Étapes', '4 étapes']].map(([a, b]) => `<label class="row"><span class="ck sq on">${I('check')}</span><span class="grow"><b>${a}</b> · ${b}</span></label>`).join('')}</div>
    <div class="sh"><span>Ingrédients</span></div><div class="group">${[['400 g de pois chiches', 'Pois chiches'], ['2 c. à s. de tahini', 'Tahini'], ['1 citron', 'Citrons'], ['1 gousse d’ail', '＋ créer « Ail »']].map(([a, b]) => `<label class="row"><span class="ck sq on">${I('check')}</span><span class="grow"><span class="sub">« ${a} »</span><br>→ <b>${b}</b></span></label>`).join('')}</div>
    <div class="foot"><button class="btn" data-a="close">Appliquer au plat</button></div>`), 900);
};

// Mode cuisine : plein ecran, quantites ajustees, recettes enchainees.
VIEWS.cook = (t) => {
  const k = t.id, d = DISHES[k], p = Number(S.q['cp' + k] || t.p || d.p), f = p / d.p;
  const block = (x, ff, title) => { const dd = DISHES[x]; return `<div class="${title ? 'part' : ''}" style="margin-top:${title ? 22 : 8}px">${title ? `<div class="mid">${dd.n}</div><p class="sub">${dd.t ? dd.t + ' · ' : ''}${fmtQ(ff * dd.p)} portions</p>` : ''}
    ${dd.ings.length ? `<div class="card">${dd.ings.map((g) => `<div class="ing"><span class="grow">${P[g[0]].n}</span><span class="q">${ingText(g, ff)}</span></div>`).join('')}</div>` : ''}
    ${dd.steps ? `<div class="card" style="margin-top:10px"><ol class="steps">${dd.steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>` : ''}${dd.notes ? `<p class="sub">${dd.notes}</p>` : ''}</div>`; };
  return {
    title: d.n, noTabs: true,
    actions: `<button class="ib" data-a="noop" aria-label="Garder l’écran allumé">${I('eye')}</button>`,
    body: `<div class="card between" style="margin-top:4px"><span class="grow"><b>Pour ${p} personnes</b><span class="sub" style="display:block">quantités ajustées</span></span><span class="stepper"><button data-a="cook-p" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${p}</b><button data-a="cook-p" data-d="1" aria-label="Plus">${I('plus')}</button></span></div>
      ${block(k, f, false)}${(d.parts || []).map(([x, por]) => block(x, (f * por) / DISHES[x].p, true)).join('')}`,
  };
};
A['cook-p'] = (el) => { const t = topV(), k = 'cp' + t.id; S.q[k] = Math.max(1, Number(S.q[k] || t.p || DISHES[t.id].p) + Number(el.dataset.d)); render(); };
