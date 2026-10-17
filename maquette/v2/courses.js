// Le Cabas · maquette v2 : onglet Courses (accueil, liste, article, mode courses, ticket, promos, historique).
const listName = (l) => (l.type === 'backlog' ? 'À prévoir' : fmtD(l.date, { weekday: 'long', day: 'numeric', month: 'long' }));
const STATUS = { prep: ['En préparation', ''], cours: ['En cours', 'acc'], closed: ['Clôturée', ''] };
const statusPill = (l) => (l.type === 'backlog' ? '' : `<span class="pill ${STATUS[l.status][1]}">${STATUS[l.status][0]}</span>`);
const dated = () => LISTS.filter((l) => l.type === 'dated' && l.status !== 'closed').sort((a, b) => a.date.localeCompare(b.date));
const nextDate = () => addDays(LISTS.filter((l) => l.type === 'dated').map((l) => l.date).sort().pop(), HOUSE.rhythm);
const qtyText = (i) => `${qtyOf(i)} × ${P[i.pid].u}`;

// ---------- Accueil ----------
// Au quotidien : les repas du jour, la prochaine liste et « À prévoir ». Les autres listes
// (2 ou 3 par an) vivent dans l'onglet Listes, repliees.
const dayMeals = () => ['midi', 'soir'].map((s) => MEALS.find((m) => m.date === TODAY && m.slot === s && !m.sugg)).filter(Boolean);
const heroCard = (cur) => {
  const sc = scenarios(cur), done = counted(cur).filter((i) => i.done).length, heroStores = sc.split ? sc.used : [sc.all[0].st];
  return `<div class="card hero tap" data-a="go" data-v="list" data-id="${cur.id}">
      <div class="between"><span class="sub">Prochaine liste</span>${statusPill(cur)}</div>
      <div class="mid" style="margin:4px 0 12px">${listName(cur)}</div>
      <div class="between small"><span class="muted">${done} / ${counted(cur).length} dans le caddie</span><b class="num">≈ ${eur(sc.split ? sc.plan.total : sc.all[0].total)}</b></div>
      <div class="prog" style="margin:6px 0 14px"><i style="width:${Math.round((done / counted(cur).length) * 100)}%"></i></div>
      <div class="card" style="background:var(--raised);padding:12px 14px">
        <div class="hstack">${heroStores.map((s) => sp(s, `${STORES[s].n} · ${sc.plan.by[s] || counted(cur).length}`)).join('')}</div>
        <div class="small" style="margin-top:6px">${sc.split ? `Faire les deux magasins fait économiser <b>${eur(sc.saving)}</b> par rapport à tout chez ${STORES[sc.all[0].st].n}.` : `Tout chez ${STORES[sc.all[0].st].n} : l’économie d’un 2e magasin reste sous le seuil.`}</div>
      </div>
      <div class="btn-row" style="margin-top:14px">${bI('basket', 'Ouvrir la liste', `data-a="go" data-v="list" data-id="${cur.id}"`)}${bI('plus', 'Ajouter un article', `data-a="qa" data-k="item"`)}${bI('cart', 'Mode courses', `data-a="shop-pick" data-id="${cur.id}"`, '')}</div>
    </div>`;
};
const noNext = () => `<div class="card"><div class="mid">Pas de prochaine liste</div><p class="sub" style="margin:4px 0 12px">Elle reprend les récurrents et « À prévoir ».</p>${isM() ? `<button class="btn" data-a="new-list">${I('plus')} Créer la prochaine liste</button>` : ''}</div>`;
const backlogCard = () => {
  const ap = listById('ap');
  return `<button class="card tap" style="width:100%;text-align:left" data-a="go" data-v="list" data-id="ap">
      <div class="between"><b>${plural(ap.items.length, 'article')} en attente</b>${I('chev', 's chev')}</div>
      <div class="hstack" style="margin-top:8px">${ap.items.map((i) => `<span class="pill">${P[i.pid].n}</span>`).join('') || '<span class="muted">Rien en attente</span>'}</div>
      <div class="sub" style="margin-top:8px">Articles sans date : à importer dans une prochaine liste.</div></button>`;
};
VIEWS.home = () => {
  const cur = dated()[0], meals = dayMeals();
  const sugg = LISTS.flatMap((l) => l.items.filter((i) => i.sugg).map((i) => ({ ...i, l })));
  const promos = PROMOS.filter((p) => p.until >= TODAY);
  return {
    title: 'Accueil', sub: `${HOUSE.name} · ${fmtD(TODAY, { weekday: 'long', day: 'numeric', month: 'long' })}`, large: true,
    body: `${sugg.length && isM() ? `<button class="banner" data-a="sugg-sheet" style="width:100%">${I('bulb')}<span class="grow" style="text-align:left">${plural(sugg.length, 'suggestion')} de ${[...new Set(sugg.map((s) => s.sugg))].join(', ')} à valider</span>${I('chev', 's')}</button>` : ''}
      <div class="home-grid"><div>
      ${meals.length ? `<div class="sh"><span>Aujourd’hui au menu</span><button data-a="tab" data-t="menu">Menu</button></div>
        <div class="group">${meals.map((m) => `<button class="row tap" data-a="meal-open" data-id="${m.id}"><span class="ico">${I('bowl')}</span><span class="grow"><span class="sub" style="display:block">${SLOTS[m.slot]} · ${m.p} pers.</span><b>${DISHES[m.dish].n}</b></span>${I('chev', 's chev')}</button>`).join('')}</div>` : ''}
      <div class="sh"><span>Prochaine liste</span></div>
      ${cur ? heroCard(cur).replace('<span class="sub">Prochaine liste</span>', '<span class="sub">Courses</span>') : noNext()}
      <div class="sh"><span>À prévoir</span><button data-a="go" data-v="list" data-id="ap">Voir</button></div>
      ${backlogCard()}
      </div><div>
      <div class="sh"><span>Promos en cours</span><button data-a="go" data-v="promos">Toutes</button></div>
      <div class="hscroll">${promos.map((p) => `<button class="card tap" style="width:180px;text-align:left" data-a="go" data-v="product" data-id="${p.pid}">
        ${sp(p.st)}<div class="b" style="margin:8px 0 2px">${P[p.pid].n}</div>
        <div class="hstack"><span class="mid num" style="color:var(--warn)">${eur(p.price)}</span><s class="faint small num">${eur(P[p.pid].avg[p.st])}</s></div>
        <div class="sub">jusqu’au ${fmtD(p.until, { day: 'numeric', month: 'short' })}</div></button>`).join('')}
        <button class="card tap" style="width:140px;display:grid;place-items:center;gap:6px;color:var(--accent)" data-a="promo-add">${I('tag', 'l')}<b class="small">Signaler une promo</b></button></div>
      </div></div>`,
  };
};

// ---------- Listes ----------
// « À prévoir » et la prochaine liste en grand ; les autres listes a venir et l'historique
// sont repliés (usage rare, quelques fois par an).
VIEWS.lists = () => {
  const [cur, ...later] = dated(), closed = LISTS.filter((l) => l.status === 'closed').sort((a, b) => b.date.localeCompare(a.date));
  const open = S.q.otherOpen;
  const row = (l) => `<button class="row tap" data-a="go" data-v="list" data-id="${l.id}"><div class="ico ${l.status === 'cours' ? 'acc' : ''}">${I(l.status === 'closed' ? 'check' : 'basket')}</div>
    <span class="grow"><b>${listName(l)}</b><span class="sub" style="display:block">${plural(counted(l).length, 'article')}${l.status === 'closed' ? '' : ` · ≈ ${eur(scenarios(l).plan.total)}`}</span></span>${statusPill(l)}${I('chev', 's chev')}</button>`;
  return {
    title: 'Listes', sub: 'À prévoir et prochaine liste', large: true,
    body: `<div class="home-grid"><div>
        <div class="sh"><span>À prévoir</span><button data-a="go" data-v="list" data-id="ap">Ouvrir</button></div>
        ${backlogCard()}
        <div class="btn-row" style="margin-top:10px">${bI('plus', 'Ajouter à « À prévoir »', `data-a="add-sheet" data-id="ap"`)}</div>
      </div><div>
        <div class="sh"><span>Prochaine liste</span></div>
        ${cur ? heroCard(cur).replace('<span class="sub">Prochaine liste</span>', '<span class="sub">Courses</span>') : noNext()}
      </div></div>
      <div class="rare">
        <button class="fold" data-a="other-toggle">${I(open ? 'up' : 'down', 's')}<span>Autres listes</span><span class="n">${later.length ? `${plural(later.length, 'à venir', 'à venir')} · ` : ''}${plural(closed.length, 'clôturée')}</span></button>
        ${open ? `${later.length ? `<div class="group">${later.map(row).join('')}</div>` : ''}
          <div class="group" style="margin-top:10px"><button class="row tap" data-a="go" data-v="history"><span class="ico">${I('clock')}</span><span class="grow"><b>Historique</b><span class="sub" style="display:block">${plural(closed.length, 'liste clôturée', 'listes clôturées')}, en lecture seule</span></span>${I('chev', 's chev')}</button></div>
          ${isM() ? `<button class="btn sec" style="margin-top:12px" data-a="new-list">${I('plus')} Nouvelle liste datée</button>` : ''}` : ''}
      </div>`,
  };
};
A['other-toggle'] = () => { S.q.otherOpen = !S.q.otherOpen; render(); };
A['new-list'] = () => {
  if (!needNet()) return;
  const d = nextDate();
  live(() => `<h3>Nouvelle liste</h3><p class="lead">Date proposée : dernière liste + ${HOUSE.rhythm} jours.</p>
    <label class="field"><span>Date des courses</span><input class="in" type="date" id="nl-date" value="${d}"></label>
    <div class="group" style="margin-top:14px">
      <label class="row"><span class="grow">Importer les récurrents dus<span class="sub" style="display:block">Lait, bananes, eau pétillante</span></span><span class="sw on"></span></label>
      <label class="row"><span class="grow">Reprendre « À prévoir »<span class="sub" style="display:block">${listById('ap').items.map((i) => P[i.pid].n).join(', ')}</span></span><span class="sw"></span></label>
    </div>
    <div class="foot"><button class="btn" data-a="new-list-ok">Créer la liste</button></div>`);
};
A['new-list-ok'] = () => {
  const date = $('nl-date').value;
  const l = { id: 'n' + date, type: 'dated', date, status: 'prep', items: [it('lai', 6), it('ban', 2), it('eau', 2)] };
  LISTS.push(l); closeSheet(); go('list', { id: l.id }); toast('Liste créée · 3 récurrents importés');
};
A['sugg-sheet'] = () => live(() => {
  const s = LISTS.flatMap((l) => l.items.filter((i) => i.sugg).map((i) => ({ i, l })));
  const ms = MEALS.filter((m) => m.sugg);
  return `<h3>Suggestions à valider</h3><p class="lead">Proposées par les membres du foyer.</p>
    <div class="group">${s.map(({ i, l }) => `<div class="row">${avatar(member(i.sugg), 's')}<span class="grow"><b>${P[i.pid].n}</b> × ${i.q}<span class="sub" style="display:block">${listName(l)}</span></span>
      <button class="ib" data-a="sugg-no" data-id="${i.id}" aria-label="Refuser">${I('x')}</button><button class="ib solid" style="color:var(--accent)" data-a="sugg-ok" data-id="${i.id}" aria-label="Accepter">${I('check')}</button></div>`).join('')}
    ${ms.map((m) => `<div class="row">${avatar(member(m.sugg), 's')}<span class="grow"><b>${DISHES[m.dish].n}</b><span class="sub" style="display:block">Repas · ${fmtD(m.date)} ${SLOTS[m.slot].toLowerCase()}</span></span><button class="btn sm sec" data-a="meal-open" data-id="${m.id}">Voir</button></div>`).join('')}</div>
    ${!s.length && !ms.length ? '<p class="empty">Tout est validé.</p>' : ''}`;
});
const findItem = (id) => { for (const l of LISTS) { const i = l.items.find((x) => x.id === Number(id)); if (i) return { i, l }; } return {}; };
A['sugg-ok'] = (el) => { if (!needNet()) return; findItem(el.dataset.id).i.sugg = null; toast('Suggestion ajoutée à la liste'); refresh(); render(); };
A['sugg-no'] = (el) => { if (!needNet()) return; const { i, l } = findItem(el.dataset.id); l.items.splice(l.items.indexOf(i), 1); toast('Suggestion refusée'); refresh(); render(); };

// ---------- Liste ----------
VIEWS.list = (t) => {
  const l = listById(t.id), ro = l.status === 'closed';
  const f = S.q['ls' + l.id] || 'all';
  const sc = l.type === 'dated' ? scenarios(l) : null;
  const items = l.items.filter((i) => f === 'all' || storeOf(i) === f);
  const order = f === 'all' ? Object.keys(CATS) : ORDER[f];
  const todo = items.filter((i) => !i.done && !i.unav), cart = items.filter((i) => i.done), unav = items.filter((i) => i.unav);
  const byCat = order.map((c) => [c, todo.filter((i) => P[i.pid].cat === c)]).filter(([, xs]) => xs.length);
  const meals = l.type === 'dated' ? MEALS.filter((m) => !m.sugg && m.date >= l.date && m.date < (LISTS.filter((x) => x.type === 'dated' && x.date > l.date).map((x) => x.date).sort()[0] || addDays(l.date, HOUSE.rhythm))) : [];
  const segs = l.type === 'dated' ? `<div class="chips" style="position:sticky;top:0;z-index:1;background:var(--bg);padding-block:6px">
      <button class="chip ${f === 'all' ? 'on' : ''}" data-a="lfilter" data-id="${l.id}" data-f="all">Tous <span class="n">${l.items.length}</span></button>
      ${activeStores().map((s) => `<button class="chip ${f === s ? 'on' : ''}" data-a="lfilter" data-id="${l.id}" data-f="${s}">${dotS(s)} ${STORES[s].n} <span class="n">${l.items.filter((i) => storeOf(i) === s).length}</span></button>`).join('')}</div>` : '';
  const scen = sc && !ro ? `<button class="card tap" style="width:100%;text-align:left;margin-bottom:6px" data-a="scen" data-id="${l.id}">
      <div class="between"><span class="sub">Estimation · ${sc.split ? 'conseil : 2 magasins' : 'conseil : 1 magasin'}</span>${I('chev', 's chev')}</div>
      <div class="between" style="margin-top:4px"><span class="big num">${eur(sc.split ? sc.plan.total : sc.all[0].total)}</span>${sc.saving > 0 ? `<span class="pill ${sc.split ? 'acc' : ''}">−${eur(sc.saving)} vs ${STORES[sc.all[0].st].n}</span>` : ''}</div>
      <div class="pricebar" style="margin-top:10px">${sc.all.map((a) => `<span class="small">${STORES[a.st].n}</span><i style="--c:${STORES[a.st].c};width:${Math.round((a.total / sc.all[sc.all.length - 1].total) * 100)}%"></i><b class="num small">${eur(a.total)}</b>`).join('')}</div></button>` : '';
  const presence = l.status === 'cours' ? `<div class="hstack small muted" style="margin:0 2px 10px">${avatar(MEMBERS[1], 's')} Léa regarde aussi cette liste</div>` : '';
  return {
    title: l.type === 'backlog' ? 'À prévoir' : fmtD(l.date, { weekday: 'short', day: 'numeric', month: 'long' }),
    sub: l.type === 'backlog' ? 'Articles sans date, à importer dans une liste' : `${STATUS[l.status][0]} · ${plural(counted(l).length, 'article')}${ro ? ' · lecture seule' : ''}`,
    actions: `<button class="ib" data-a="list-menu" data-id="${l.id}" aria-label="Actions">${I('more')}</button>`,
    body: `${presence}<div class="cols"><div>${segs}
      ${byCat.map(([c, xs]) => `<div class="rayon">${CATS[c]}<span class="n">${xs.length}</span></div><div class="group">${xs.map((i) => itemRow(i, l, ro)).join('')}</div>`).join('')}
      ${!todo.length && !cart.length ? `<div class="empty">${I('basket', 'l')}<p>Rien à acheter${f === 'all' ? '' : ' dans ce magasin'}.</p></div>` : ''}
      ${unav.length ? `<div class="rayon">Indisponibles<span class="n">${unav.length}</span></div><div class="group">${unav.map((i) => itemRow(i, l, ro)).join('')}</div>` : ''}
      ${cart.length ? `<button class="rayon" style="width:100%" data-a="cart-toggle" data-id="${l.id}">${I('cart', 's')} Dans le caddie<span class="n">${cart.length} ${I(S.q['cart' + l.id] ? 'up' : 'down', 's')}</span></button>
        ${S.q['cart' + l.id] ? `<div class="group">${cart.map((i) => itemRow(i, l, ro)).join('')}</div>` : ''}` : ''}
      </div><div class="side-col">${scen}
      ${meals.length ? `<div class="sh"><span>Repas couverts</span><button data-a="tab" data-t="menu">Menu</button></div>
        <div class="hscroll">${meals.map((m) => `<button class="card tap" style="width:150px;text-align:left;padding:12px" data-a="meal-open" data-id="${m.id}"><span class="sub">${fmtD(m.date, { weekday: 'short', day: 'numeric' })} · ${SLOTS[m.slot]}</span><div class="b" style="line-height:1.25;margin-top:2px">${DISHES[m.dish].n}</div></button>`).join('')}</div>
        <div class="card" style="margin-top:8px"><div class="b small">Ingrédients de base à vérifier</div><div class="sub" style="margin:2px 0 8px">Sel, huile, épices : pas ajoutés d’office.</div>
        <div class="hstack">${['hui', 'cum', 'sel'].map((pid) => `<button class="chip" data-a="add-pid" data-id="${l.id}" data-pid="${pid}">${I('plus', 's')} ${P[pid].n}</button>`).join('')}</div></div>` : ''}
      </div></div>`,
    dock: ro ? null : `<button class="addbar" data-a="add-sheet" data-id="${l.id}">${I('plus')} <span class="grow">${isM() ? 'Ajouter un article' : 'Suggérer un article'}</span>${I('search', 's')}</button>
      ${l.type === 'dated' ? `<button class="btn" data-a="shop-pick" data-id="${l.id}" aria-label="Mode courses">${I('cart')}</button>` : ''}`,
  };
};
function itemRow(i, l, ro) {
  const p = P[i.pid], st = storeOf(i), pr = price(i.pid, st), promo = promoOf(i.pid, st);
  const meta = [
    i.from.length ? `<span>${I('bowl', 's')} ${i.from.length > 1 ? `${i.from[0]} +${i.from.length - 1}` : i.from[0]}</span>` : '',
    i.need ? `<span>${i.need}</span>` : '',
    i.note ? `<span>${I('note', 's')} ${esc(i.note)}</span>` : '',
    p.rec ? `<span>${I('repeat', 's')} récurrent</span>` : '',
    i.sugg ? `<span style="color:var(--warn)">${I('bulb', 's')} suggéré par ${i.sugg}</span>` : '',
    i.unav ? `<span>${I('ban', 's')} indisponible</span>` : '',
  ].join('');
  const right = l.type === 'backlog' ? '' : `<span class="px"><b class="num small" ${promo ? 'style="color:var(--warn)"' : ''}>${eur(pr == null ? null : pr * qtyOf(i))}</b><button class="sp" style="--c:${STORES[st].c};--cs:${STORES[st].cs}" data-a="store-pick" data-id="${i.id}">${STORES[st].n}${i.st ? ' ✓' : ''}</button></span>`;
  const ck = i.sugg && isM() ? `<button class="ib solid" style="color:var(--accent)" data-a="sugg-ok-row" data-id="${i.id}" aria-label="Accepter">${I('check')}</button>`
    : `<button class="ck ${i.done ? 'on' : ''}" data-a="check" data-id="${i.id}" ${ro || i.sugg ? 'disabled' : ''} aria-label="Acheté">${I('check')}</button>`;
  return `<div class="item ${i.done ? 'done' : ''} ${i.sugg ? 'sugg' : ''} ${i.unav ? 'unav' : ''}" id="it${i.id}">${ck}
    <button class="grow" style="text-align:left" data-a="item-open" data-id="${i.id}"><div class="nm">${p.n} <span class="faint small" style="font-weight:500">${qtyOf(i) > 1 ? '× ' + qtyOf(i) : ''}</span></div><div class="meta">${meta || `<span>${p.u}</span>`}</div></button>${right}</div>`;
}
A.lfilter = (el) => { S.q['ls' + el.dataset.id] = el.dataset.f; render(); };
A['cart-toggle'] = (el) => { S.q['cart' + el.dataset.id] = !S.q['cart' + el.dataset.id]; render(); };
A.check = (el) => {
  const { i } = findItem(el.dataset.id);
  i.done = !i.done; queued();
  if (i.done) toast(`${P[i.pid].n} dans le caddie`, () => { i.done = false; render(); });
  render();
};
A['sugg-ok-row'] = A['sugg-ok'];
A['store-pick'] = (el) => {
  const { i } = findItem(el.dataset.id);
  live(() => `<h3>${P[i.pid].n}</h3><p class="lead">Où l’acheter ? Le conseil suit le prix (promo comprise) ou le magasin imposé du produit.</p>
    <div class="group">${activeStores().map((s) => { const pr = price(i.pid, s), cur = storeOf(i) === s; return `<button class="row tap" data-a="store-set" data-id="${i.id}" data-st="${s}">${dotS(s)}<span class="grow"><b>${STORES[s].n}</b>${advised(i.pid) === s ? ' <span class="pill acc">conseillé</span>' : ''}${promoOf(i.pid, s) ? ' <span class="pill warn">promo</span>' : ''}</span><span class="num">${pr == null ? 'prix inconnu' : eur(pr)}</span>${cur ? I('check') : ''}</button>`; }).join('')}</div>
    ${i.st ? `<button class="btn ghost full" style="margin-top:8px" data-a="store-set" data-id="${i.id}" data-st="">Revenir au conseil</button>` : ''}`);
};
A['store-set'] = (el) => { const { i } = findItem(el.dataset.id); i.st = el.dataset.st || null; closeSheet(); toast(i.st ? `${P[i.pid].n} : chez ${STORES[i.st].n}` : 'Retour au conseil'); render(); };
A.scen = (el) => {
  const l = listById(el.dataset.id), sc = scenarios(l);
  sheet(`<h3>Scénarios comparés</h3><p class="lead">Prix effectifs : promo valable, sinon moyenne des ${HOUSE.records} derniers relevés (6 mois).</p>
    <div class="group">
      <div class="row"><div class="ico acc">${I('spark')}</div><span class="grow"><b>Conseil</b><span class="sub" style="display:block">${sc.used.map((s) => `${STORES[s].n} ${sc.plan.by[s]}`).join(' · ')}${sc.plan.unknown ? ` · ${sc.plan.unknown} non estimé` : ''}</span></span><b class="num">${eur(sc.plan.total)}</b></div>
      ${sc.all.map((a) => `<div class="row">${dotS(a.st)}<span class="grow"><b>Tout chez ${STORES[a.st].n}</b>${a.unknown ? `<span class="sub" style="display:block">${a.unknown} prix inconnu${a.unknown > 1 ? 's' : ''} (meilleur prix ailleurs)</span>` : ''}</span><b class="num">${eur(a.total)}</b>${isM() ? `<button class="btn sm sec" data-a="all-at" data-id="${l.id}" data-st="${a.st}">Choisir</button>` : ''}</div>`).join('')}
    </div>
    <div class="banner ${sc.split ? 'info' : ''}" style="margin-top:12px">${I(sc.split ? 'check' : 'store')}<span>${sc.split ? `Deux magasins : ${eur(sc.saving)} d’économie, au-dessus du seuil de ${eur(HOUSE.threshold)}.` : `Économie sous le seuil de ${eur(HOUSE.threshold)} : un seul magasin suffit.`}</span></div>`);
};
A['all-at'] = (el) => { if (!needNet()) return; listById(el.dataset.id).items.forEach((i) => { i.st = el.dataset.st; }); closeSheet(); toast(`Tout chez ${STORES[el.dataset.st].n}`, () => { listById(el.dataset.id).items.forEach((i) => { i.st = null; }); render(); }); render(); };
A['list-menu'] = (el) => {
  const l = listById(el.dataset.id);
  const opts = l.type === 'backlog' ? [['import-ap', 'move', 'Importer dans une liste datée']]
    : l.status === 'closed' ? [['copy-ap', 'repeat', 'Copier vers « À prévoir »'], ['del-list', 'trash', 'Supprimer la liste', 'danger']]
      : [['list-date', 'calendar', 'Changer la date'], ['list-status', 'flame', l.status === 'prep' ? 'Passer « en cours »' : 'Repasser « en préparation »'], ['close-list', 'check', 'Clôturer la liste'], ['share-list', 'share', 'Copier la liste en texte'], ['del-list', 'trash', 'Supprimer la liste', 'danger']];
  sheet(`<h3>${l.type === 'backlog' ? 'À prévoir' : 'Liste du ' + fmtD(l.date, { day: 'numeric', month: 'long' })}</h3>
    <div class="menu-pop">${opts.map(([a, ic, t, c]) => `<button class="${c || ''}" data-a="${isM() || a === 'share-list' ? a : 'mgr-only'}" data-id="${l.id}"><span class="ico">${I(ic)}</span>${t}</button>`).join('')}</div>`);
};
A['mgr-only'] = () => toast('Réservé aux gestionnaires du foyer');
A['list-status'] = (el) => { const l = listById(el.dataset.id); l.status = l.status === 'prep' ? 'cours' : 'prep'; closeSheet(); render(); };
A['list-date'] = (el) => { const l = listById(el.dataset.id); sheet(`<h3>Date des courses</h3><input class="in" type="date" id="ld" value="${l.date}"><p class="lead small" style="margin-top:8px">Les repas suivent : la liste couvre les repas jusqu’à la veille de la suivante.</p><div class="foot"><button class="btn" data-a="list-date-ok" data-id="${l.id}">Enregistrer</button></div>`); };
A['list-date-ok'] = (el) => { listById(el.dataset.id).date = $('ld').value; closeSheet(); toast('Date changée · repas réattribués'); render(); };
A['share-list'] = () => { closeSheet(); toast('Liste copiée'); };
A['import-ap'] = () => { closeSheet(); toast('3 articles importés dans la liste du 13 oct.'); };
A['copy-ap'] = () => { closeSheet(); toast('Articles copiés vers « À prévoir »'); };
A['del-list'] = (el) => confirmSheet('Supprimer la liste ?', 'Les articles manuels non achetés repartent dans « À prévoir ». Les relevés de prix sont gardés.', 'Supprimer', () => { LISTS.splice(LISTS.indexOf(listById(el.dataset.id)), 1); back(); toast('Liste supprimée'); });
A['close-list'] = (el) => {
  const l = listById(el.dataset.id), left = counted(l).filter((i) => !i.done);
  S.q.carry = S.q.carry || {};
  live(() => `<h3>Clôturer la liste</h3><p class="lead">${plural(left.length, 'article')} non acheté${left.length > 1 ? 's' : ''} : choisir où ${left.length > 1 ? 'ils vont' : 'il va'}.</p>
    <div class="seg" style="margin-bottom:12px">${[['next', 'Liste suivante'], ['ap', 'À prévoir'], ['drop', 'Abandon']].map(([k, t]) => `<button class="${(S.q.carryAll || 'next') === k ? 'on' : ''}" data-a="carry-all" data-k="${k}">${t}</button>`).join('')}</div>
    <div class="group">${left.map((i) => `<div class="row"><span class="grow">${P[i.pid].n}</span><select class="in" style="width:150px;height:38px" aria-label="Destination"><option>Liste suivante</option><option ${S.q.carryAll === 'ap' ? 'selected' : ''}>À prévoir</option><option ${S.q.carryAll === 'drop' ? 'selected' : ''}>Abandon</option></select></div>`).join('')}</div>
    <p class="sub" style="margin-top:10px">Les suggestions encore en attente sont abandonnées.</p>
    <div class="foot"><button class="btn sec" data-a="go" data-v="scan" data-id="${l.id}" data-st="co">${I('camera')} Scanner le ticket</button><button class="btn" data-a="close-ok" data-id="${l.id}">Clôturer</button></div>`);
};
A['carry-all'] = (el) => { S.q.carryAll = el.dataset.k; refresh(); };
A['close-ok'] = (el) => { if (!needNet()) return; listById(el.dataset.id).status = 'closed'; closeSheet(); tab('lists'); toast('Liste clôturée · articles reportés'); };

// Fiche article
A['item-open'] = (el) => {
  const { i, l } = findItem(el.dataset.id), p = P[i.pid];
  live(() => `<h3>${p.n}</h3><p class="lead">${CATS[p.cat]} · ${p.u}${i.need ? ` · besoin ${i.need}` : ''}</p>
    ${i.sugg ? `<div class="banner">${I('bulb')}<span class="grow">Suggéré par ${i.sugg}</span>${isM() ? `<button class="btn sm" data-a="sugg-ok" data-id="${i.id}">Accepter</button>` : ''}</div>` : ''}
    <div class="group">
      <div class="row"><span class="grow">Quantité${i.mq ? `<span class="sub" style="display:block">dont ${i.mq} pour les repas</span>` : ''}</span><span class="stepper"><button data-a="qty" data-id="${i.id}" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${qtyOf(i)}</b><button data-a="qty" data-id="${i.id}" data-d="1" aria-label="Plus">${I('plus')}</button></span></div>
      <label class="row"><span class="grow">Note</span><input class="in" style="width:60%;height:38px" value="${esc(i.note)}" placeholder="ex. marque, taille…" data-ch="item-note" data-id="${i.id}"></label>
      ${l.type === 'dated' ? `<button class="row tap" data-a="store-pick" data-id="${i.id}"><span class="grow">Magasin</span>${sp(storeOf(i))}${I('chev', 's chev')}</button>` : ''}
      <button class="row tap" data-a="item-toggle" data-k="unav" data-id="${i.id}"><span class="grow">Indisponible en magasin</span><span class="sw ${i.unav ? 'on' : ''}"></span></button>
      <button class="row tap" data-a="item-rec" data-id="${i.id}"><span class="grow">Récurrent<span class="sub" style="display:block">${p.rec ? `toutes les ${p.rec > 1 ? p.rec + ' listes' : 'listes'}` : 'non'}</span></span>${I('chev', 's chev')}</button>
    </div>
    ${i.from.length ? `<div class="sh"><span>Pour les repas</span></div><div class="group">${i.from.map((d) => `<div class="row">${I('bowl')}<span class="grow">${d}</span></div>`).join('')}
      <button class="row tap" data-a="in-stock" data-id="${i.id}"><span class="ico">${I('box')}</span><span class="grow"><b>Déjà en réserve</b><span class="sub" style="display:block">Retiré des repas, il ne reviendra pas</span></span></button></div>` : ''}
    <div class="sh"><span>Prix</span><button data-a="go" data-v="product" data-id="${p.id}">Fiche produit</button></div>
    <div class="cmp">${activeStores().map((s) => `<div style="--c:${STORES[s].c};--cs:${STORES[s].cs}" class="${advised(p.id) === s ? 'best' : ''}"><div class="small b">${STORES[s].n}</div><div class="big num" style="margin-top:4px">${eur(price(p.id, s))}</div>${promoOf(p.id, s) ? '<div class="xs b">promo</div>' : ''}</div>`).join('')}</div>
    <div class="foot btn-row">${bI('doc', 'Fiche produit', `data-a="go" data-v="product" data-id="${p.id}"`)}${bI('tag', 'Promo', 'data-a="promo-add"')}${bI('move', 'Déplacer', `data-a="item-move" data-id="${i.id}"`)}${bI('trash', 'Retirer', `data-a="item-del" data-id="${i.id}"`, 'danger')}</div>`);
};
A.qty = (el) => { const { i } = findItem(el.dataset.id); i.q = Math.max(0, i.q + Number(el.dataset.d)); if (qtyOf(i) < 1) i.q = 1 - i.mq > 0 ? 1 - i.mq : 0; queued(); refresh(); render(); };
CH['item-note'] = (el) => { findItem(el.dataset.id).i.note = el.value; queued(); render(); };
A['item-toggle'] = (el) => { const { i } = findItem(el.dataset.id); i[el.dataset.k] = !i[el.dataset.k]; queued(); refresh(); render(); };
A['item-rec'] = (el) => { const { i } = findItem(el.dataset.id); sheet(`<h3>Récurrence</h3><p class="lead">Proposé à chaque nouvelle liste s’il manque depuis n listes.</p><div class="seg">${[0, 1, 2, 3, 4].map((n) => `<button class="${(P[i.pid].rec || 0) === n ? 'on' : ''}" data-a="rec-set" data-pid="${i.pid}" data-n="${n}">${n ? (n === 1 ? 'Chaque' : '1 / ' + n) : 'Jamais'}</button>`).join('')}</div>`); };
A['rec-set'] = (el) => { P[el.dataset.pid].rec = Number(el.dataset.n); closeSheet(); toast('Récurrence enregistrée'); render(); };
A['in-stock'] = (el) => { if (!needNet()) return; const { i, l } = findItem(el.dataset.id); l.items.splice(l.items.indexOf(i), 1); closeSheet(); toast(`${P[i.pid].n} : en réserve pour ces repas`); render(); };
A['item-del'] = (el) => { if (!needNet()) return; const { i, l } = findItem(el.dataset.id), k = l.items.indexOf(i); l.items.splice(k, 1); closeSheet(); toast(`${P[i.pid].n} retiré`, () => { l.items.splice(k, 0, i); render(); }); render(); };
A['item-move'] = (el) => { const { i, l } = findItem(el.dataset.id); sheet(`<h3>Déplacer vers…</h3><div class="group">${LISTS.filter((x) => x !== l && x.status !== 'closed').map((x) => `<button class="row tap" data-a="item-move-ok" data-id="${i.id}" data-to="${x.id}"><span class="grow">${listName(x)}</span>${I('chev', 's chev')}</button>`).join('')}</div>`); };
A['item-move-ok'] = (el) => { const { i, l } = findItem(el.dataset.id); l.items.splice(l.items.indexOf(i), 1); listById(el.dataset.to).items.push(i); closeSheet(); toast(`Déplacé vers ${listName(listById(el.dataset.to))}`); render(); };

// Ajout d'article : recherche, creation de produit, quantite.
A['add-sheet'] = (el) => { S.q.addL = el.dataset.id; S.q.addQ = ''; live(addHtml); setTimeout(() => $('add-q')?.focus(), 50); };
function addHtml() {
  const l = listById(S.q.addL), n = norm(S.q.addQ).trim();
  const res = n ? Object.values(P).filter((p) => norm(p.n).includes(n)).slice(0, 7) : [];
  const recent = ['tom', 'yao', 'pat', 'beu', 'vai'];
  return `<h3>${isM() ? 'Ajouter' : 'Suggérer'} à ${l.type === 'backlog' ? '« À prévoir »' : 'la liste'}</h3>
    ${isM() ? '' : '<p class="lead">Un gestionnaire validera votre suggestion.</p>'}
    <div class="search" style="margin:8px 0 12px">${I('search')}<input class="in" id="add-q" placeholder="Produit…" value="${esc(S.q.addQ)}" data-in="add-q" autocomplete="off"></div>
    ${n ? `<div class="group">${res.map((p) => { const inL = l.items.find((i) => i.pid === p.id); return `<button class="row tap" data-a="add-pid" data-id="${l.id}" data-pid="${p.id}"><span class="grow"><b>${p.n}</b><span class="sub" style="display:block">${CATS[p.cat]} · ${p.u}${inL ? ` · déjà × ${qtyOf(inL)} (s’ajoute)` : ''}</span></span>${sp(advised(p.id), eur(price(p.id, advised(p.id))))}</button>`; }).join('')}
      ${res.some((p) => norm(p.n) === n) ? '' : `<button class="row tap" data-a="prod-new" style="color:var(--accent)"><span class="ico acc">${I('plus')}</span><b class="grow">Créer « ${esc(S.q.addQ)} »</b></button>`}</div>`
    : `<div class="sh"><span>Souvent achetés</span></div><div class="hstack">${recent.map((pid) => `<button class="chip" data-a="add-pid" data-id="${l.id}" data-pid="${pid}">${I('plus', 's')} ${P[pid].n}</button>`).join('')}</div>`}`;
}
IN['add-q'] = (el) => { S.q.addQ = el.value; refresh(); const i = $('add-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
A['add-pid'] = (el) => {
  const l = listById(el.dataset.id), pid = el.dataset.pid, ex = l.items.find((i) => i.pid === pid && !i.sugg);
  if (ex && isM()) ex.q += 1; else l.items.push(it(pid, 1, { sugg: isM() ? null : 'Thomas' }));
  queued();
  toast(isM() ? (ex ? `${P[pid].n} : quantité cumulée` : `${P[pid].n} ajouté`) : `${P[pid].n} suggéré`);
  S.q.addQ = ''; if (sheetFn) refresh(); render();
  const r = $('it' + (ex ? ex.id : IID)); if (r) { r.classList.add('flash'); r.scrollIntoView({ block: 'nearest' }); }
};
A['prod-new'] = () => {
  const name = S.q.addQ.trim();
  live(() => `<h3>Nouveau produit</h3><p class="lead">Ajouté aux produits du foyer puis à la liste.</p>
    <div class="stack"><label class="field"><span>Nom</span><input class="in" id="np-n" value="${esc(name.charAt(0).toUpperCase() + name.slice(1))}"></label>
    <div class="grid2"><label class="field"><span>Rayon</span><select class="in" id="np-c">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="field"><span>Emballage</span><select class="in"><option>paquet</option><option>pièce</option><option>kg</option><option>bouteille</option><option>boîte</option></select></label></div>
    <div class="grid2"><label class="field"><span>Contenance</span><input class="in" placeholder="500" inputmode="decimal"></label><label class="field"><span>Unité</span><select class="in"><option>g</option><option>kg</option><option>ml</option><option>cl</option><option>L</option><option>pièces</option></select></label></div>
    <label class="row" style="padding:0"><span class="grow">Ingrédient de base (sel, huile, épices)</span><span class="sw"></span></label></div>
    <div class="foot"><button class="btn" data-a="prod-new-ok">Créer et ajouter</button></div>`);
};
A['prod-new-ok'] = () => {
  const id = 'x' + Date.now(), n = $('np-n').value.trim() || 'Produit';
  P[id] = { id, n, cat: $('np-c').value, u: 'paquet', avg: { im: null, co: null, al: null }, rc: 0 };
  A['add-pid']({ dataset: { id: S.q.addL, pid: id } }); closeSheet();
};

// ---------- Mode courses ----------
// Mode courses : un magasin (ses articles, dans l'ordre de ses rayons) ou tous les magasins
// ensemble (st = 'all' : toute la liste, rayons dans l'ordre general, magasin indique par article).
const inShop = (i, st) => st === 'all' || storeOf(i) === st;
const shopName = (st) => (st === 'all' ? 'Tous les magasins' : STORES[st].n);
const shopColor = (st) => (st === 'all' ? 'var(--accent)' : STORES[st].c);
A['shop-pick'] = (el) => {
  const l = listById(el.dataset.id), sw = el.dataset.sw;
  const all = counted(l).filter((i) => !i.done).length;
  sheet(`<h3>Mode courses</h3><p class="lead">Un magasin à la fois, ou toute la liste sans séparation. Fonctionne hors-ligne.</p>
    <div class="group"><button class="row tap" data-a="shop-go" data-id="${l.id}" data-st="all" data-sw="${sw || ''}"><span class="ico acc">${I('cart')}</span><span class="grow"><b>Tous les magasins</b><span class="sub" style="display:block">${plural(all, 'article')} · toute la liste, sans séparation</span></span>${I('arrowR')}</button>
    ${activeStores().map((s) => { const n = counted(l).filter((i) => storeOf(i) === s && !i.done).length; return `<button class="row tap" data-a="shop-go" data-id="${l.id}" data-st="${s}" data-sw="${sw || ''}">${dotS(s)}<span class="grow"><b>${STORES[s].n}</b><span class="sub" style="display:block">${plural(n, 'article')} à prendre</span></span>${I('arrowR')}</button>`; }).join('')}</div>`);
};
A['shop-go'] = (el) => { closeSheet(); (el.dataset.sw ? replace : go)('shop', { id: el.dataset.id, st: el.dataset.st }); };
VIEWS.shop = (t) => {
  const l = listById(t.id), st = t.st, mine = counted(l).filter((i) => inShop(i, st)), col = shopColor(st);
  const todo = mine.filter((i) => !i.done), cart = mine.filter((i) => i.done);
  const pct = mine.length ? Math.round((cart.length / mine.length) * 100) : 0;
  return {
    title: shopName(st), cls: 'shop', noTabs: true,
    actions: `<button class="ib" data-a="shop-pick" data-id="${l.id}" data-sw="1" aria-label="Changer de magasin">${I('store')}</button>`,
    body: `<div class="card" style="--c:${col};margin-bottom:6px;overflow:hidden;padding:0"><div class="shopbar"></div><div style="padding:14px 16px">
      <div class="between"><span class="mid">${cart.length} / ${mine.length}</span><span class="muted small">${listName(l)}</span></div>
      <div class="prog" style="margin-top:10px"><i style="width:${pct}%;background:${col}"></i></div>
      <div class="hstack small muted" style="margin-top:10px">${avatar(MEMBERS[1], 's')} Léa est aussi sur cette liste</div></div></div>
      ${(st === 'all' ? Object.keys(CATS) : ORDER[st]).map((c) => [c, todo.filter((i) => P[i.pid].cat === c)]).filter(([, xs]) => xs.length).map(([c, xs]) => `<div class="rayon">${CATS[c]}<span class="n">${xs.length}</span></div>
        <div class="group">${xs.map((i) => `<div class="item"><button class="ck" data-a="shop-check" data-id="${i.id}" aria-label="Dans le caddie">${I('check')}</button><button class="grow" style="text-align:left" data-a="shop-check" data-id="${i.id}"><div class="nm">${P[i.pid].n}</div><div class="meta"><span>${qtyText(i)}</span>${i.note ? `<span>${esc(i.note)}</span>` : ''}${i.need ? `<span>${i.need}</span>` : ''}</div></button>${st === 'all' ? sp(storeOf(i)) : ''}</div>`).join('')}</div>`).join('')}
      ${!todo.length ? `<div class="empty">${I('check', 'l')}<p><b>Tout est dans le caddie.</b></p></div>` : ''}
      ${cart.length ? `<div class="rayon">${I('cart', 's')} Dans le caddie<span class="n">${cart.length}</span></div><div class="group">${cart.map((i) => `<div class="item done"><button class="ck on" data-a="shop-uncheck" data-id="${i.id}" aria-label="Retirer du caddie">${I('check')}</button><div class="grow"><div class="nm">${P[i.pid].n}</div></div>${i.paid ? `<b class="num small">${eur(i.paid)}</b>` : ''}</div>`).join('')}</div>` : ''}`,
    dock: `<button class="btn full" style="background:${col}" data-a="shop-end" data-id="${l.id}" data-st="${st}">${st === 'all' ? 'Terminer les courses' : 'Terminer chez ' + STORES[st].n}</button>`,
  };
};
A['shop-check'] = (el) => {
  const { i } = findItem(el.dataset.id);
  S.q.paid = '';
  live(() => `<h3>${P[i.pid].n}</h3><p class="lead">Prix payé ? Facultatif : il devient un relevé de prix.</p>
    <div class="paid">${S.q.paid ? (Number(S.q.paid) / 100).toFixed(2).replace('.', ',') + ' €' : '<span class="faint">— , — €</span>'}</div>
    <div class="numpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'].map((k) => `<button data-a="pad" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="foot"><button class="btn sec" data-a="shop-ok" data-id="${i.id}" data-skip="1">Sans prix</button><button class="btn" data-a="shop-ok" data-id="${i.id}">${I('cart')} Dans le caddie</button></div>`);
};
A.pad = (el) => { const k = el.dataset.k; S.q.paid = k === 'C' ? '' : k === '⌫' ? S.q.paid.slice(0, -1) : (S.q.paid + k).slice(0, 6); refresh(); };
A['shop-ok'] = (el) => { const { i } = findItem(el.dataset.id); i.done = true; if (!el.dataset.skip && S.q.paid) i.paid = Number(S.q.paid); queued(); closeSheet(); toast(`${P[i.pid].n} dans le caddie${i.paid ? ' · relevé ' + eur(i.paid) : ''}`); render(); };
A['shop-uncheck'] = (el) => { findItem(el.dataset.id).i.done = false; queued(); render(); };
A['shop-end'] = (el) => {
  const st = el.dataset.st, l = listById(el.dataset.id), left = counted(l).filter((i) => inShop(i, st) && !i.done);
  // Tous les magasins : un ticket par magasin.
  const scans = st === 'all' ? activeStores() : [st];
  sheet(`<h3>${st === 'all' ? 'Terminer les courses' : 'Terminer chez ' + STORES[st].n}</h3><p class="lead">${left.length ? `${plural(left.length, 'article')} non pris : ${left.length > 1 ? 'ils seront marqués' : 'il sera marqué'} indisponible${left.length > 1 ? 's' : ''} et ${left.length > 1 ? 'restent' : 'reste'} dans la liste.` : 'Tout est pris.'}</p>
    ${left.length ? `<div class="hstack" style="margin-bottom:12px">${left.map((i) => `<span class="pill">${P[i.pid].n}</span>`).join('')}</div>` : ''}
    <div class="stack">${scans.map((s) => `<button class="card tap" style="width:100%;text-align:left;background:var(--accent-soft);color:var(--accent)" data-a="end-scan" data-id="${l.id}" data-st="${st}" data-ticket="${s}"><div class="hstack">${I('camera', 'l')}<span class="grow"><b>Scanner le ticket${st === 'all' ? ' ' + STORES[s].n : ''}</b><span class="small" style="display:block">Les prix du ticket deviennent des relevés. Lecture sur le téléphone.</span></span>${I('chev')}</div></button>`).join('')}</div>
    <div class="foot"><button class="btn" data-a="end-ok" data-id="${l.id}" data-st="${st}">Terminer sans ticket</button></div>`);
};
const endShop = (l, st) => counted(l).filter((i) => inShop(i, st) && !i.done).forEach((i) => { i.unav = true; });
A['end-ok'] = (el) => { endShop(listById(el.dataset.id), el.dataset.st); closeSheet(); back(); toast('Courses terminées'); };
A['end-scan'] = (el) => { endShop(listById(el.dataset.id), el.dataset.st); closeSheet(); S.q.scanStep = null; replace('scan', { id: el.dataset.id, st: el.dataset.ticket }); };

// ---------- Ticket ----------
VIEWS.scan = (t) => {
  const step = S.q.scanStep || 'photo';
  if (step === 'photo') return {
    title: 'Ticket de caisse', sub: `${STORES[t.st].n} · ${listName(listById(t.id))}`, noTabs: true,
    body: `<div class="card" style="display:grid;gap:14px;justify-items:center;text-align:center;padding:30px 18px;border:2px dashed var(--line);background:transparent">
      <div class="ico acc" style="width:64px;height:64px;border-radius:20px">${I('receipt', 'l')}</div>
      <div><div class="mid">Photographier le ticket</div><p class="sub" style="max-width:30ch;margin:6px auto 0">Bien à plat, en entier. La lecture se fait sur le téléphone : rien n’est envoyé ailleurs.</p></div>
      <label class="btn" style="cursor:pointer">${I('camera')} Prendre la photo<input type="file" accept="image/*" hidden data-ch="scan-file"></label>
      <button class="btn ghost" data-a="scan-demo">Utiliser un ticket d’exemple</button></div>`,
  };
  if (step === 'read') return {
    title: 'Lecture du ticket', noTabs: true,
    body: `<div class="card" style="display:grid;gap:12px;padding:24px 18px;margin-top:20px"><div class="mid">Lecture… <span class="num" id="ocr-p">0</span> %</div><div class="prog"><i id="ocr-b" style="width:0"></i></div><p class="sub">Image redressée et contrastée, puis reconnaissance du texte.</p></div>`,
  };
  const lines = S.q.lines;
  const ok = lines.filter((x) => x.on && x.pid).length;
  return {
    title: 'Vérifier le ticket', sub: `${STORES[t.st].n} · 13 oct. 2026 · ${lines.length} lignes lues`, noTabs: true,
    body: `<div class="banner info">${I('check')}<span>Magasin et date reconnus. Les remises sont comptées comme promos.</span></div>
      <div class="group">${lines.map((x, k) => `<div class="item" style="align-items:flex-start">
        <button class="ck sq ${x.on ? 'on' : ''}" data-a="tl-on" data-k="${k}" aria-label="Garder">${I('check')}</button>
        <div class="grow"><div class="xs faint" style="font-family:ui-monospace,monospace">${x.raw}</div>
          <button class="nm" style="text-align:left" data-a="tl-prod" data-k="${k}">${x.pid ? P[x.pid].n : '<span style="color:var(--warn)">À rapprocher…</span>'} ${I('down', 's')}</button>
          <div class="meta"><span>× ${x.q}</span>${x.promo || x.remise ? '<span class="pill warn">promo</span>' : ''}${x.pid && !x.remise ? '<span class="pill acc">dans la liste</span>' : ''}</div></div>
        <b class="num">${eur(x.pr)}</b></div>`).join('')}</div>
      <p class="sub" style="margin:10px 4px">Les correspondances choisies sont mémorisées pour ${STORES[t.st].n}.</p>`,
    dock: `<button class="btn full" data-a="scan-save">Enregistrer ${plural(ok, 'relevé')}</button>`,
  };
};
CH['scan-file'] = () => A['scan-demo']();
A['scan-demo'] = () => {
  S.q.scanStep = 'read'; render();
  let p = 0;
  const tick = setInterval(() => {
    p = Math.min(100, p + 7 + Math.round(Math.random() * 9));
    const n = $('ocr-p'), b = $('ocr-b');
    if (n) { n.textContent = p; b.style.width = p + '%'; }
    if (p >= 100) { clearInterval(tick); S.q.scanStep = 'check'; S.q.lines = TICKET.map((x) => ({ ...x, on: !!x.pid })); render(); }
  }, 140);
};
A['tl-on'] = (el) => { const x = S.q.lines[Number(el.dataset.k)]; x.on = !x.on; render(); };
A['tl-prod'] = (el) => {
  const k = Number(el.dataset.k), x = S.q.lines[k];
  sheet(`<h3>« ${x.raw} »</h3><p class="lead">Quel produit ?</p><div class="group">${['poi', 'per', 'cit', 'fet', 'vai', 'pap'].map((pid) => `<button class="row tap" data-a="tl-set" data-k="${k}" data-pid="${pid}"><span class="grow">${P[pid].n}</span>${x.pid === pid ? I('check') : ''}</button>`).join('')}
    <button class="row tap" data-a="tl-set" data-k="${k}" data-pid="" style="color:var(--muted)"><span class="ico">${I('ban')}</span><span class="grow">Ignorer cette ligne</span></button>
    <button class="row tap" data-a="noop" style="color:var(--accent)"><span class="ico acc">${I('plus')}</span><span class="grow">Créer un produit</span></button></div>`);
};
A['tl-set'] = (el) => { const x = S.q.lines[Number(el.dataset.k)]; x.pid = el.dataset.pid || null; x.on = !!x.pid; closeSheet(); render(); };
A['scan-save'] = () => { const n = S.q.lines.filter((x) => x.on && x.pid).length; S.q.scanStep = null; queued(); tab('lists'); toast(`${plural(n, 'relevé')} enregistré${n > 1 ? 's' : ''} · articles cochés`); };

// ---------- Historique, promos ----------
VIEWS.history = () => ({
  title: 'Historique', sub: 'Listes clôturées, en lecture seule',
  body: `<div class="group">${LISTS.filter((l) => l.status === 'closed').sort((a, b) => b.date.localeCompare(a.date)).map((l) => `<button class="row tap" data-a="go" data-v="list" data-id="${l.id}"><div class="ico">${I('check')}</div><span class="grow"><b>${listName(l)}</b><span class="sub" style="display:block">${l.items.filter((i) => i.done).length} achetés · ${l.items.filter((i) => i.unav).length} indisponible</span></span>${I('chev', 's chev')}</button>`).join('')}</div>`,
});
VIEWS.promos = () => ({
  title: 'Promos', sub: 'Une par produit et par magasin, jusqu’à une date ou la sortie du magasin',
  body: `<div class="group">${PROMOS.map((p) => `<button class="row tap" data-a="go" data-v="product" data-id="${p.pid}">${dotS(p.st)}<span class="grow"><b>${P[p.pid].n}</b><span class="sub" style="display:block">${STORES[p.st].n} · ${p.until >= TODAY ? 'jusqu’au ' + fmtD(p.until, { day: 'numeric', month: 'short' }) : 'terminée'} · par ${p.by}</span></span><span style="text-align:right"><b class="num" style="color:var(--warn)">${eur(p.price)}</b><br><s class="faint xs num">${eur(P[p.pid].avg[p.st])}</s></span></button>`).join('')}</div>`,
  dock: `<button class="btn full" data-a="promo-add">${I('tag')} Signaler une promo</button>`,
});
A['promo-add'] = () => {
  if (!needNet()) return;
  sheet(`<h3>Signaler une promo</h3><p class="lead">Tout membre peut le faire. Le prix promo remplace la moyenne tant qu’elle est valable.</p>
    <div class="stack"><label class="field"><span>Produit</span><select class="in">${Object.values(P).map((p) => `<option>${p.n}</option>`).join('')}</select></label>
    <div class="seg">${activeStores().map((s, k) => `<button class="${k ? '' : 'on'}">${STORES[s].n}</button>`).join('')}</div>
    <div class="grid2"><label class="field"><span>Prix promo (facultatif)</span><input class="in" inputmode="decimal" placeholder="1,99"></label><label class="field"><span>Jusqu’au</span><input class="in" type="date" value="${addDays(TODAY, 7)}"></label></div>
    <p class="sub">Sans date : valable jusqu’à la prochaine sortie de ce magasin.</p></div>
    <div class="foot"><button class="btn" data-a="promo-ok">Enregistrer la promo</button></div>`);
};
A['promo-ok'] = () => { closeSheet(); toast('Promo enregistrée · conseils recalculés'); };

// ---------- Bouton ＋ central ----------
A.quick = () => sheet(`<h3>Ajouter</h3><p class="lead">Aussi en appui long sur l’icône de l’app.</p>
  <div class="qa">
    <button data-a="qa" data-k="item"><span class="ico acc">${I('basket', 'l')}</span>Article</button>
    <button data-a="qa" data-k="meal"><span class="ico acc">${I('calendar', 'l')}</span>Repas au menu</button>
    <button data-a="qa" data-k="wish"><span class="ico warn">${I('bulb', 'l')}</span>Envie de plat</button>
    <button data-a="qa" data-k="dish"><span class="ico plum">${I('bowl', 'l')}</span>Nouveau plat</button>
    <button data-a="qa" data-k="promo"><span class="ico warn">${I('tag', 'l')}</span>Promo</button>
    <button data-a="qa" data-k="scan"><span class="ico">${I('receipt', 'l')}</span>Ticket</button>
  </div>`);
A.qa = (el) => {
  closeSheet();
  const k = el.dataset.k;
  if (k === 'item') { tab('lists'); go('list', { id: 'l13' }); A['add-sheet']({ dataset: { id: 'l13' } }); }
  if (k === 'meal') { tab('menu'); A['meal-add']({ dataset: { date: '2026-10-23', slot: 'soir' } }); }
  if (k === 'wish') { tab('menu'); A['wish-add'](); }
  if (k === 'dish') { tab('dishes'); A['dish-new'](); }
  if (k === 'promo') A['promo-add']();
  if (k === 'scan') { S.q.scanStep = null; go('scan', { id: 'l13', st: 'co' }); }
};
