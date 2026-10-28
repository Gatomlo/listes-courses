// Le Cabas · maquette v4 : ce qui est regroupé ou ajouté pour épurer
// (menu ⋯ du Menu, génération du menu, modèles de semaine, profil et rappels, section Avancé du Foyer).

// ---------- Données d'exemple ----------
const DTYPES = ['Soupe', 'Repas léger', 'Plat complet', 'Entrée'];
const DTYPE = { hou: 'Entrée', tab: 'Entrée', fal: 'Entrée', mez: 'Plat complet', sto: 'Plat complet', las: 'Plat complet', cur: 'Plat complet', sou: 'Soupe', pes: 'Repas léger', chi: 'Plat complet', pou: 'Plat complet', crq: 'Repas léger', bao: 'Plat complet' };
const MODELS = [
  { id: 'eq', n: 'Semaine équilibrée', rules: [{ t: 'Soupe', n: 1, k: 'exact' }, { t: 'Repas léger', n: 2, k: 'max' }] },
  { id: 'ra', n: 'Semaine rapide', rules: [{ t: 'Repas léger', n: 3, k: 'exact' }, { t: 'Plat complet', n: 3, k: 'max' }] },
];
const ruleText = (r) => `${r.k === 'exact' ? 'exactement' : 'au plus'} ${r.n} ${r.t.toLowerCase()}${r.n > 1 ? 's' : ''} par semaine`;

// Quelques plats de plus (jamais ou rarement servis) pour que la génération ait de quoi proposer.
Object.assign(DISHES, {
  gra: { n: 'Gratin dauphinois', p: 4, t: '1 h', tags: ['four', 'hiver'], times: 3, last: '2026-05-10', ings: [['pdt', 2], ['gru', 1]] },
  woo: { n: 'Wok de légumes', p: 4, t: '25 min', tags: ['végé', 'rapide'], times: 2, last: '2026-06-02', ings: [['oig', 2, 'pc'], ['riz', 300, 'g']] },
  spa: { n: 'Spaghetti bolognaise', p: 4, t: '45 min', tags: ['rapide'], times: 12, last: '2026-08-30', ings: [['pat', 1], ['hac', 1], ['tom', 400, 'g']] },
  qui: { n: 'Quiche aux poireaux', p: 4, t: '55 min', tags: ['four', 'végé'], times: 4, last: '2026-07-14', ings: [['oeu', 1], ['gru', 1]] },
  ris: { n: 'Risotto aux champignons', p: 4, t: '40 min', tags: ['végé'], times: 2, last: '2026-06-20', ings: [['riz', 300, 'g'], ['oig', 1, 'pc']] },
  ome: { n: 'Omelette aux herbes', p: 2, t: '10 min', tags: ['rapide', 'végé'], times: 6, last: '2026-09-01', ings: [['oeu', 1], ['per', 1]] },
  bla: { n: 'Blanquette de veau', p: 4, t: '1 h 30', tags: ['dimanche'], times: 2, last: '2026-04-12', ings: [['pdt', 1], ['car', 1], ['riz', 300, 'g']] },
  gno: { n: 'Gnocchis sauce tomate', p: 4, t: '20 min', tags: ['rapide', 'végé'], times: 3, last: '2026-07-30', ings: [['pat', 1], ['tom', 400, 'g'], ['moz', 1]] },
  sal: { n: 'Salade de pois chiches', p: 4, t: '15 min', tags: ['rapide', 'végé'], times: 2, last: '2026-07-02', ings: [['poi', 1], ['tom', 300, 'g'], ['fet', 1]] },
  taj: { n: 'Tajine de poulet', p: 4, t: '1 h 10', tags: ['four'], times: 2, last: '2026-06-15', ings: [['pou', 1], ['oig', 1, 'pc'], ['riz', 300, 'g']] },
  piz: { n: 'Pizza maison', p: 4, t: '1 h', tags: ['four', 'fête'], times: 4, last: '2026-08-08', ings: [['moz', 2], ['tom', 400, 'g']] },
  pot: { n: 'Potée de légumes', p: 4, t: '1 h', tags: ['hiver', 'belge'], times: 2, last: '2026-02-19', ings: [['pdt', 2], ['car', 1]] },
  sv: { n: 'Soupe de légumes', p: 4, t: '35 min', tags: ['végé', 'hiver'], times: 5, last: '2026-09-05', ings: [['car', 1], ['oig', 1, 'pc']] },
});
Object.assign(DTYPE, { gra: 'Plat complet', woo: 'Repas léger', spa: 'Plat complet', qui: 'Repas léger', ris: 'Plat complet', ome: 'Repas léger', sv: 'Soupe', bla: 'Plat complet', gno: 'Repas léger', sal: 'Repas léger', taj: 'Plat complet', piz: 'Plat complet', pot: 'Plat complet' });

// ---------- Menu : un seul ⋯ ----------
A['menu-more'] = () => {
  const c = menuCost(), w = WISHES.filter((x) => x.status === 'ok').length;
  const row = (ic, t, sub, a, extra = '') => `<button data-a="${a}" ${extra}><span class="ico">${I(ic)}</span><span style="display:grid;text-align:left"><span>${t}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</span></button>`;
  sheet(`<h3>Menu</h3><div class="menu-pop">
    ${isM() ? row('spark', 'Générer le menu', 'propose des plats pour les créneaux libres', 'menu-gen') : ''}
    ${row('doc', 'Infos du menu', `${c.persons ? `budget ${c.partial ? 'dès ' : '≈ '}${eur(c.total)}` : 'budget'} · ${MENU.note ? '1 remarque' : 'remarques'}`, 'menu-info')}
    ${row('bulb', 'Envies de plats', `${w} validée${w > 1 ? 's' : ''}`, 'wishes-sheet')}
    ${row('sliders', isM() ? 'Réglages du menu' : 'Repas affichés', isM() ? 'dates · repas affichés · lien d’affichage' : '', isM() ? 'menu-set' : 'menu-slots')}
    ${row('share', 'Exporter et partager', 'A4, impression, PDF', 'go', 'data-v="export"')}
  </div>`);
};

// Budget et remarques : un seul bloc, hors de l'écran du menu.
A['menu-info'] = () => live(() => {
  const c = menuCost();
  return `<h3>Infos du menu</h3><p class="lead">${fmtD(MENU.start, { day: 'numeric', month: 'long' })} → ${fmtD(MENU.end, { day: 'numeric', month: 'long' })}</p>
    ${c.persons ? `<div class="sh" style="margin-top:6px"><span>Budget estimé</span></div><div class="group">
      <div class="row"><span class="grow"><b>${c.partial ? 'dès ' : '≈ '}${eur(c.total)}</b><span class="sub" style="display:block">${eur(Math.round(c.total / c.persons))} / pers.</span></span></div>
      ${c.weeks.map((t, k) => (t == null ? '' : `<div class="row"><span class="grow muted">Semaine du ${fmtD(addDays(MENU.start, 7 * k), { day: 'numeric', month: 'short' })}</span><b class="num">${eur(t)}</b></div>`)).join('')}</div>
      ${c.unknown ? `<p class="sub" style="margin:6px 2px 0">${plural(c.unknown, 'repas')} sans prix connu.</p>` : ''}` : ''}
    <div class="sh"><span>Remarques</span></div>
    ${isM() ? `<textarea class="in" rows="3" placeholder="Remarques sur ce menu (imprimées avec l’export)" data-ch="menu-note">${esc(MENU.note)}</textarea>` : `<div class="small">${esc(MENU.note) || '<span class="muted">Aucune remarque</span>'}</div>`}`;
});

// Envies de plats : plus de carrousel dans le menu ; elles sont aussi en tête du choix d'un plat.
A['wishes-sheet'] = () => live(() => `<h3>Envies de plats</h3><p class="lead">Elles passent en tête quand on choisit un plat pour un créneau.</p>
  <div class="group">${WISHES.map((w) => { const d = DISHES[w.dish]; return `<div class="row">${avatar(member(w.by), 's')}<span class="grow"><b>${d.draft ? I('edit', 's') + ' ' : ''}${d.n}</b><span class="sub" style="display:block">${w.status === 'pending' ? 'à valider · ' : ''}${w.by === 'Thomas' ? 'votre envie' : 'envie de ' + w.by}${ppShort(w.dish) ? ` · ${ppShort(w.dish)} / pers.` : ''}</span></span>
    ${isM() && w.status === 'pending' ? `<button class="ib solid" style="color:var(--accent)" data-a="wish-ok" data-id="${w.id}" aria-label="Valider">${I('check')}</button>` : ''}
    <button class="ib" data-a="wish-plan" data-id="${w.id}" aria-label="Mettre au menu">${I('calendar')}</button></div>`; }).join('') || '<p class="empty">Aucune envie.</p>'}</div>
  <div class="foot"><button class="btn sec" data-a="wish-add">${I('plus')} Proposer une envie</button></div>`);

// ---------- Génération du menu ----------
let gen = null, seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
A['menu-gen'] = () => { gen = { from: TODAY, to: MENU.end, slots: { midi: true, soir: true }, gap: 14, model: null, view: 'cfg', res: null }; live(genHtml); };
function genRun() {
  const parts = new Set(Object.values(DISHES).flatMap((d) => (d.parts || []).map(([p]) => p)));
  const slots = Object.keys(SLOTS).filter((s) => gen.slots[s]);
  const days = []; for (let d = gen.from; d <= gen.to; d = addDays(d, 1)) days.push(d);
  const wk = (d) => Math.floor(dayDiff(gen.from, d) / 7);
  const planned = MEALS.filter((m) => !m.sugg && m.dish).map((m) => ({ d: m.date, k: m.dish }));
  const free = []; days.forEach((d) => slots.forEach((s) => { if (!MEALS.some((m) => m.date === d && m.slot === s && !m.sugg) && !outAt(d, s)) free.push({ date: d, slot: s }); }));
  const cnt = {}; // semaine → type → nombre (repas déjà prévus compris)
  const add = (d, k) => { const t = DTYPE[k]; if (!t) return; (cnt[wk(d)] = cnt[wk(d)] || {})[t] = ((cnt[wk(d)] || {})[t] || 0) + 1; };
  planned.filter((p) => p.d >= gen.from && p.d <= gen.to).forEach((p) => add(p.d, p.k));
  const rules = gen.model ? MODELS.find((m) => m.id === gen.model).rules : [];
  const fits = (k, date) => {
    const d = DISHES[k];
    if (d.draft || d.isNew || parts.has(k)) return false;
    if (planned.some((p) => p.k === k && Math.abs(dayDiff(p.d, date)) < gen.gap)) return false;
    if (d.last && dayDiff(d.last, date) < gen.gap) return false;
    const r = rules.find((x) => x.t === DTYPE[k]);
    return !(r && ((cnt[wk(date)] || {})[r.t] || 0) >= r.n);
  };
  const out = [], left = free.slice(), skipped = [], unmet = [];
  const put = (slot, k) => { out.push({ ...slot, dish: k }); planned.push({ d: slot.date, k }); add(slot.date, k); left.splice(left.indexOf(slot), 1); };
  const age = (k) => (DISHES[k].last ? dayDiff(DISHES[k].last, TODAY) : 999) + rnd() * 40;
  // 1. envies validées d'abord
  WISHES.filter((w) => w.status === 'ok' && !DISHES[w.dish].draft).forEach((w) => {
    const s = left.find((x) => fits(w.dish, x.date));
    if (s) put(s, w.dish); else skipped.push([w.dish, planned.some((p) => p.k === w.dish) ? 'déjà prévue à moins de ' + gen.gap + ' jours' : 'aucun créneau libre compatible']);
  });
  // 2. règles « exactement » : placées avant le reste
  rules.filter((r) => r.k === 'exact').forEach((r) => {
    for (let w = 0; w <= wk(gen.to); w++) {
      while (((cnt[w] || {})[r.t] || 0) < r.n) {
        const s = left.find((x) => wk(x.date) === w);
        const ks = Object.keys(DISHES).filter((k) => DTYPE[k] === r.t && s && fits(k, s.date)).sort((a, b) => age(b) - age(a));
        if (!s || !ks.length) { unmet.push(`${ruleText(r)} (semaine ${w + 1})`); break; }
        put(s, ks[0]);
      }
    }
  });
  // 3. le reste, plats anciens d'abord
  left.slice().forEach((s) => {
    const ks = Object.keys(DISHES).filter((k) => fits(k, s.date)).sort((a, b) => age(b) - age(a));
    if (ks.length) put(s, ks[0]);
  });
  out.sort((a, b) => a.date.localeCompare(b.date) || Object.keys(SLOTS).indexOf(a.slot) - Object.keys(SLOTS).indexOf(b.slot));
  gen.res = { meals: out, empty: left, skipped, unmet };
}
function genHtml() {
  if (gen.view === 'model') return `<h3>Modèle de semaine</h3><p class="lead">Des règles par type de plat, comptées par tranche de 7 jours. Modifiables dans Foyer › Avancé.</p>
    <div class="group"><button class="row tap" data-a="gen-model" data-id=""><span class="grow"><b>Aucun modèle</b></span>${!gen.model ? I('check') : ''}</button>
    ${MODELS.map((m) => `<button class="row tap" data-a="gen-model" data-id="${m.id}"><span class="grow"><b>${m.n}</b><span class="sub" style="display:block">${m.rules.map(ruleText).join(' · ')}</span></span>${gen.model === m.id ? I('check') : ''}</button>`).join('')}</div>`;
  if (gen.view === 'prev') {
    const r = gen.res;
    return `<h3>Proposition</h3><p class="lead">${plural(r.meals.length, 'repas')} pour ${fmtD(gen.from, { day: 'numeric', month: 'short' })} → ${fmtD(gen.to, { day: 'numeric', month: 'short' })} : rien n’est enregistré avant « Appliquer ».</p>
      <div class="group">${r.meals.map((m, k) => `<div class="row"><span class="grow"><span class="sub" style="display:block">${fmtD(m.date)} · ${SLOTS[m.slot]}</span><b>${DISHES[m.dish].n}</b></span>${DTYPE[m.dish] ? `<span class="pill">${DTYPE[m.dish]}</span>` : ''}${ppShort(m.dish) ? `<span class="num small">${ppShort(m.dish)}</span>` : ''}<button class="ib" data-a="gen-drop" data-k="${k}" aria-label="Retirer">${I('x')}</button></div>`).join('') || '<p class="empty">Aucun plat disponible.</p>'}</div>
      ${r.empty.length ? `<p class="sub" style="margin:8px 2px 0">${plural(r.empty.length, 'créneau', 'créneaux')} sans plat disponible (délai trop long ?).</p>` : ''}
      ${r.skipped.length ? `<div class="banner" style="margin-top:10px">${I('bulb')}<span class="grow">${r.skipped.map(([k, why]) => `Envie « ${DISHES[k].n} » non placée : ${why}.`).join('<br>')}</span></div>` : ''}
      ${r.unmet.length ? `<div class="banner" style="margin-top:10px">${I('clock')}<span class="grow">Règle non tenue : ${r.unmet.join(' ; ')}.</span></div>` : ''}
      <div class="foot"><button class="btn sec" data-a="gen-again">${I('repeat')} Autre proposition</button><button class="btn" data-a="gen-apply" ${r.meals.length ? '' : 'disabled'}>Appliquer (${r.meals.length})</button></div>`;
  }
  return `<h3>Générer le menu</h3><p class="lead">Remplit les créneaux libres, du ${fmtD(gen.from, { day: 'numeric', month: 'short' })} au ${fmtD(gen.to, { day: 'numeric', month: 'short' })} Les envies passent en premier.</p>
    <div class="group">
      <div class="row" style="flex-wrap:wrap"><span class="grow">Repas à remplir</span><span class="chips" style="flex-wrap:wrap">${Object.entries(SLOTS).map(([k, v]) => `<button class="chip ${gen.slots[k] ? 'on' : ''}" data-a="gen-slot" data-k="${k}">${v}</button>`).join('')}</span></div>
      <div class="row"><span class="grow">Délai avant de reprendre un plat<span class="sub" style="display:block">valeur du foyer : ${HOUSE.gapDays || 14} jours</span></span><span class="stepper"><button data-a="gen-gap" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${gen.gap} j</b><button data-a="gen-gap" data-d="1" aria-label="Plus">${I('plus')}</button></span></div>
      <button class="row tap" data-a="gen-pick"><span class="grow">Modèle de semaine${gen.model ? `<span class="sub" style="display:block">${MODELS.find((m) => m.id === gen.model).rules.map(ruleText).join(' · ')}</span>` : ''}</span><b>${gen.model ? MODELS.find((m) => m.id === gen.model).n : 'Aucun'}</b>${I('chev', 's chev')}</button>
    </div>
    <div class="foot"><button class="btn" data-a="gen-go">${I('spark')} Proposer un menu</button></div>`;
}
A['gen-slot'] = (el) => { gen.slots[el.dataset.k] = !gen.slots[el.dataset.k]; if (!Object.values(gen.slots).some(Boolean)) gen.slots.soir = true; refresh(); };
A['gen-gap'] = (el) => { gen.gap = Math.max(1, Math.min(60, gen.gap + Number(el.dataset.d))); refresh(); };
A['gen-pick'] = () => { gen.view = 'model'; refresh(); };
A['gen-model'] = (el) => { gen.model = el.dataset.id || null; gen.view = 'cfg'; refresh(); };
A['gen-go'] = () => { genRun(); gen.view = 'prev'; refresh(); };
A['gen-again'] = () => { genRun(); refresh(); toast('Autre proposition'); };
A['gen-drop'] = (el) => { gen.res.meals.splice(Number(el.dataset.k), 1); refresh(); };
A['gen-apply'] = () => {
  if (!needNet()) return;
  const added = gen.res.meals.filter((m) => !MEALS.some((x) => x.date === m.date && x.slot === m.slot && !x.sugg)).map((m) => meal(m.date, m.slot, m.dish, 4));
  const w0 = WISHES.slice();
  added.forEach((m) => { MEALS.push(m); const i = WISHES.findIndex((w) => w.dish === m.dish); if (i >= 0) WISHES.splice(i, 1); });
  closeSheet(); render();
  toast(`${plural(added.length, 'repas')} ajouté${added.length > 1 ? 's' : ''} au menu`, () => { added.forEach((m) => MEALS.splice(MEALS.indexOf(m), 1)); WISHES.length = 0; WISHES.push(...w0); render(); });
};

// ---------- Foyer › Avancé ----------
A.models = () => live(() => `<h3>Modèles de semaine</h3><p class="lead">Des règles par type de plat, proposées à la génération du menu. Comptées en repas par tranche de 7 jours.</p>
  <div class="group">${MODELS.map((m) => `<button class="row tap" data-a="model-open" data-id="${m.id}"><span class="grow"><b>${m.n}</b><span class="sub" style="display:block">${m.rules.map(ruleText).join(' · ') || 'aucune règle'}</span></span>${I('chev', 's chev')}</button>`).join('')}</div>
  <div class="foot"><button class="btn sec" data-a="model-new">${I('plus')} Nouveau modèle</button></div>`);
A['model-new'] = () => { MODELS.push({ id: 'm' + Date.now(), n: 'Nouveau modèle', rules: [] }); refresh(); toast('Modèle créé : ajoutez des règles'); };
A['model-open'] = (el) => { S.q.mdl = el.dataset.id; live(modelHtml); };
const modelHtml = () => { const m = MODELS.find((x) => x.id === S.q.mdl);
  return `<h3>${m.n}</h3>
    <div class="group">${m.rules.map((r, k) => `<div class="row" style="flex-wrap:wrap;gap:8px"><span class="grow" style="flex-basis:60%"><b>${r.t}</b><span class="sub" style="display:block">par semaine</span></span><button class="ib" data-a="rule-del" data-k="${k}" aria-label="Retirer la règle">${I('x')}</button>
      <div class="seg" style="flex:1"><button class="${r.k === 'exact' ? 'on' : ''}" data-a="rule-k" data-k="${k}" data-v="exact">exactement</button><button class="${r.k === 'max' ? 'on' : ''}" data-a="rule-k" data-k="${k}" data-v="max">au plus</button></div>
      <span class="stepper"><button data-a="rule-n" data-k="${k}" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${r.n}</b><button data-a="rule-n" data-k="${k}" data-d="1" aria-label="Plus">${I('plus')}</button></span></div>`).join('') || '<p class="empty">Aucune règle.</p>'}</div>
    <div class="sh"><span>Ajouter une règle</span></div><div class="chips" style="flex-wrap:wrap">${DTYPES.filter((t) => !m.rules.some((r) => r.t === t)).map((t) => `<button class="chip" data-a="rule-add" data-t="${t}">${I('plus', 's')} ${t}</button>`).join('')}</div>
    <div class="foot"><button class="btn danger" data-a="model-del">Supprimer</button><button class="btn sec" data-a="models">Retour</button></div>`; };
const curModel = () => MODELS.find((x) => x.id === S.q.mdl);
A['rule-k'] = (el) => { curModel().rules[el.dataset.k].k = el.dataset.v; refresh(); };
A['rule-n'] = (el) => { const r = curModel().rules[el.dataset.k]; r.n = Math.max(0, Math.min(14, r.n + Number(el.dataset.d))); refresh(); };
A['rule-del'] = (el) => { curModel().rules.splice(el.dataset.k, 1); refresh(); };
A['rule-add'] = (el) => { curModel().rules.push({ t: el.dataset.t, n: 1, k: 'max' }); refresh(); };
A['model-del'] = () => { MODELS.splice(MODELS.indexOf(curModel()), 1); A.models(); toast('Modèle supprimé'); };
A.dtypes = () => sheet(`<h3>Types de plats</h3><p class="lead">Un plat peut avoir plusieurs types. Renommer vers un nom existant fusionne ; les règles des modèles suivent.</p>
  <div class="group">${DTYPES.map((t) => `<button class="row tap" data-a="tag-edit" data-t="${t}"><span class="grow">${t}</span><span class="sub">${Object.keys(DTYPE).filter((k) => DTYPE[k] === t).length} plats</span>${I('edit', 's chev')}</button>`).join('')}</div>
  <div class="foot"><button class="btn sec" data-a="close">${I('plus')} Nouveau type</button></div>`);
A['csv-dishes'] = () => sheet(`<h3>Importer des plats</h3><p class="lead">Fichier CSV : nom ; portions ; temps ; repas ; types ; tags ; lien ; ingrédients ; variantes ; étapes ; notes.</p>
  <label class="card tap" style="display:grid;place-items:center;gap:6px;border:2px dashed var(--line);background:transparent;padding:22px;cursor:pointer">${I('upload', 'l')}<b>Choisir un fichier</b><input type="file" accept=".csv" hidden data-ch="csv-file"></label>
  <div class="sh"><span>Aperçu · plats-maison.csv</span></div>
  <div class="group">${[['Nouveaux plats', 6, 'acc'], ['Plats connus (repas, types, tags complétés)', 2, ''], ['Produits créés en Épicerie', 3, 'acc']].map(([t, n, c]) => `<div class="row"><span class="grow">${t}</span><span class="pill ${c}">${n}</span></div>`).join('')}</div>
  <div class="foot"><button class="btn sec" data-a="noop">${I('upload')} Modèle à télécharger</button><button class="btn" data-a="csv-ok">Importer</button></div>`);

// ---------- Profil et rappels ----------
S.q.rem = { on: true, time: '19:00' };
A.profile = () => live(() => {
  const r = S.q.rem;
  return `<div class="hstack" style="gap:12px;margin-bottom:12px">${avatar(MEMBERS[0])}<span class="grow"><b style="font-size:17px">Thomas</b><span class="sub" style="display:block">${MEMBERS[0].mail} · ${isM() ? 'Gestionnaire' : 'Membre'}</span></span></div>
  <div class="sh" style="margin-top:0"><span>Rappel de la veille</span></div>
  <div class="group">
    <button class="row tap" data-a="rem-t"><span class="ico">${I('clock')}</span><span class="grow"><b>Menu du lendemain et préparations à l’avance</b><span class="sub" style="display:block">une seule notification sur cet appareil ; rien à dire = pas d’envoi</span></span><span class="sw ${r.on ? 'on' : ''}"></span></button>
    ${r.on ? `<label class="row"><span class="grow">Heure</span><input class="in" type="time" style="width:150px;height:38px" value="${r.time}" data-ch="rem-time"></label>
      <div class="row"><span class="grow"><button class="btn sm sec" data-a="rem-test">Envoyer un essai</button></span></div>` : ''}
  </div>
  <div class="group" style="margin-top:14px">
    <button class="row tap" data-a="install"><span class="ico">${I('phone')}</span><span class="grow"><b>Installer l’app</b><span class="sub" style="display:block">Sur l’écran d’accueil, hors-ligne</span></span>${I('chev', 's chev')}</button>
    <button class="row tap" data-a="pwd"><span class="ico">${I('lock')}</span><b class="grow">Changer mon mot de passe</b>${I('chev', 's chev')}</button>
    ${isM() ? '' : `<button class="row tap" data-a="noop" style="color:var(--danger)"><span class="ico">${I('logout')}</span><b class="grow">Quitter le foyer</b></button>`}
    <button class="row tap" data-a="go" data-v="auth" data-k="login" style="color:var(--danger)"><span class="ico">${I('logout')}</span><b class="grow">Se déconnecter</b></button>
  </div>`;
});
A['rem-t'] = () => { S.q.rem.on = !S.q.rem.on; if (S.q.rem.on) toast('Rappel activé sur cet appareil'); refresh(); };
CH['rem-time'] = (el) => { S.q.rem.time = el.value; toast(`Rappel chaque soir à ${el.value}`); };
A['rem-test'] = () => toast('Notification d’essai envoyée');
A.pwd = () => sheet(`<h3>Changer mon mot de passe</h3><div class="stack"><label class="field"><span>Mot de passe actuel</span><input class="in" type="password"></label><label class="field"><span>Nouveau mot de passe</span><input class="in" type="password"></label></div><div class="foot"><button class="btn" data-a="close">Enregistrer</button></div>`);
{ const ok = A['wish-ok']; A['wish-ok'] = (el) => { ok(el); refresh(); }; }
