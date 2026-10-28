// Le Cabas · maquette v2 : données d'exemple (foyer fictif) et calculs de prix.
const TODAY = '2026-10-12';
const dt = (iso) => new Date(iso + 'T12:00:00Z');
const addDays = (iso, n) => { const d = dt(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((dt(b) - dt(a)) / 864e5);
const fmtD = (iso, o = { weekday: 'short', day: 'numeric', month: 'short' }) => dt(iso).toLocaleDateString('fr-BE', { timeZone: 'UTC', ...o });
const eur = (c) => (c == null ? '—' : (c / 100).toFixed(2).replace('.', ',') + ' €');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const HOUSE = { name: 'Foyer Phoenix', rhythm: 7, threshold: 500, records: 5, menuDays: 14, startDow: 'lundi', cost2: false, eco: 150 };
const HOUSES = [{ name: 'Foyer Phoenix', role: 'Gestionnaire' }, { name: 'Chalet des Ardennes', role: 'Membre' }];
const MEMBERS = [
  { id: 'th', n: 'Thomas', mail: 'thomas@exemple.be', role: 'manager', me: true, c: '#1b7647' },
  { id: 'le', n: 'Léa', mail: 'lea@exemple.be', role: 'member', c: '#5845b5' },
  { id: 'no', n: 'Noé', mail: 'noe@exemple.be', role: 'member', c: '#c9621b' },
];
const INVITES = [{ role: 'member', made: '2026-10-09', by: 'Thomas' }];

const STORES = {
  co: { n: 'Colruyt', c: 'var(--co)', cs: 'var(--co-soft)', active: true },
  im: { n: 'Intermarché', c: 'var(--im)', cs: 'var(--im-soft)', active: true },
  al: { n: 'Aldi', c: 'var(--al)', cs: 'var(--al-soft)', active: false },
};
const CATS = { fl: 'Fruits & légumes', fr: 'Frais', bo: 'Boucherie', ep: 'Épicerie', bs: 'Boissons', dr: 'Droguerie' };
// Parcours de chaque magasin (ordre des rayons).
const ORDER = { im: ['fl', 'fr', 'bo', 'ep', 'bs', 'dr'], co: ['ep', 'bs', 'dr', 'fr', 'bo', 'fl'], al: ['fl', 'ep', 'fr', 'bo', 'bs', 'dr'] };

// Produits : nom, rayon, emballage, prix moyen Inter, Colruyt (centimes, null = inconnu), relevés, extra.
const P = {};
[
  ['pdt', 'Pommes de terre', 'fl', 'sac 2 kg', 349, 299, 8],
  ['car', 'Carottes', 'fl', 'kg', 129, 115, 6],
  ['oig', 'Oignons', 'fl', 'filet 1 kg', 179, 149, 7],
  ['cit', 'Citrons', 'fl', 'filet de 4', 249, 219, 5],
  ['per', 'Persil plat', 'fl', 'botte', 99, 109, 4],
  ['tom', 'Tomates', 'fl', 'kg', 299, 279, 6],
  ['pot', 'Potiron', 'fl', 'pièce', 299, null, 2],
  ['ban', 'Bananes', 'fl', 'kg', 189, 169, 9, { rec: 1 }],
  ['lai', 'Lait demi-écrémé', 'fr', 'litre', 109, 99, 12, { rec: 1 }],
  ['yao', 'Yaourts nature', 'fr', 'pack de 8', 279, 245, 7],
  ['beu', 'Beurre doux', 'fr', '250 g', 289, 259, 6],
  ['oeu', 'Œufs bio', 'fr', 'boîte de 12', 389, 349, 8, { rec: 2 }],
  ['fet', 'Feta', 'fr', '200 g', 319, 289, 3],
  ['moz', 'Mozzarella', 'fr', '125 g', 189, 159, 4],
  ['gru', 'Gruyère râpé', 'fr', '200 g', 279, 299, 5],
  ['hac', 'Haché porc-bœuf', 'bo', '500 g', 549, 499, 6],
  ['sau', 'Saucisses', 'bo', 'barquette de 4', 449, 419, 5],
  ['pou', 'Filets de poulet', 'bo', '600 g', 799, 749, 4],
  ['poi', 'Pois chiches', 'ep', 'boîte 400 g', 99, 85, 5],
  ['bou', 'Boulgour', 'ep', '500 g', 219, 189, 3],
  ['tah', 'Tahini', 'ep', 'pot 300 g', 449, null, 1, { imp: 'im' }],
  ['pat', 'Penne', 'ep', '500 g', 129, 109, 9],
  ['riz', 'Riz basmati', 'ep', '1 kg', 329, 299, 6],
  ['coc', 'Lait de coco', 'ep', 'boîte 400 ml', 179, 159, 4],
  ['con', 'Tomates concassées', 'ep', 'boîte 400 g', 99, 89, 7],
  ['pes', 'Pesto vert', 'ep', 'pot 190 g', 299, 269, 4],
  ['pit', 'Pain pita', 'ep', 'sachet de 6', 199, 179, 3],
  ['caf', 'Café en grains', 'ep', '1 kg', 1299, 1249, 6],
  ['hui', 'Huile d’olive', 'ep', '75 cl', 899, 849, 4, { base: 1 }],
  ['sel', 'Sel fin', 'ep', '1 kg', 79, 69, 2, { base: 1 }],
  ['cum', 'Cumin', 'ep', 'pot', 189, 179, 1, { base: 1 }],
  ['eau', 'Eau pétillante', 'bs', '6 × 1,5 L', 399, 359, 10, { rec: 1 }],
  ['jus', 'Jus d’orange', 'bs', '1 L', 259, 239, 5],
  ['pap', 'Papier toilette', 'dr', '12 rouleaux', 649, 599, 6, { rec: 3 }],
  ['vai', 'Liquide vaisselle', 'dr', '500 ml', 249, 219, 4],
].forEach(([id, n, cat, u, im, co, rc, x]) => { P[id] = { id, n, cat, u, avg: { im, co, al: null }, rc, ...(x || {}) }; });

const PROMOS = [
  { id: 1, pid: 'poi', st: 'co', price: 59, until: '2026-10-18', by: 'Léa' },
  { id: 2, pid: 'caf', st: 'im', price: 999, until: '2026-10-20', by: 'Thomas' },
  { id: 3, pid: 'yao', st: 'im', price: 199, until: '2026-10-14', by: 'Thomas' },
  { id: 4, pid: 'hac', st: 'im', price: 449, until: '2026-10-16', by: 'Léa' },
];
// Relevés de prix (pour l'historique d'un produit) : générés à partir de la moyenne.
const records = (pid) => {
  const p = P[pid], out = [];
  ['co', 'im'].forEach((st, k) => {
    if (p.avg[st] == null) return;
    for (let i = 0; i < Math.min(p.rc, 6); i++) {
      const wobble = [0, 4, -3, 6, -5, 2][i] * (k ? 1 : -1);
      out.push({ st, date: addDays(TODAY, -6 - i * 14 - k * 3), price: p.avg[st] + Math.round(p.avg[st] * wobble / 100), src: ['ticket', 'caisse', 'manuel'][(i + k) % 3] });
    }
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
};

const activeStores = () => Object.keys(STORES).filter((s) => STORES[s].active);
const promoOf = (pid, st) => PROMOS.find((x) => x.pid === pid && x.st === st && x.until >= TODAY);
const price = (pid, st) => { const pr = promoOf(pid, st); return pr ? pr.price : P[pid].avg[st]; };
// Magasin conseillé : imposé s'il est actif, sinon le moins cher connu, sinon le 1er actif.
function advised(pid) {
  const p = P[pid], act = activeStores();
  if (p.imp && act.includes(p.imp)) return p.imp;
  const known = act.filter((s) => price(pid, s) != null);
  return known.length ? known.reduce((a, b) => (price(pid, b) < price(pid, a) ? b : a)) : act[0];
}

// ---------- Listes ----------
let IID = 100;
const it = (pid, q, x = {}) => ({ id: ++IID, pid, q, mq: 0, from: [], st: null, done: false, unav: false, note: '', sugg: null, ...x });
const LISTS = [
  { id: 'ap', type: 'backlog', items: [it('hui', 1, { note: 'presque vide' }), it('gru', 1), it('riz', 1)] },
  { id: 'l13', type: 'dated', date: '2026-10-13', status: 'cours', items: [
    it('pdt', 0, { mq: 1, from: ['Stoemp'] }), it('car', 0, { mq: 1, from: ['Stoemp'] }),
    it('oig', 0, { mq: 2, from: ['Curry de pois chiches', 'Soupe de potiron', 'Mezze libanais'], need: '1,4 kg' }),
    it('cit', 0, { mq: 2, from: ['Mezze libanais'] }), it('per', 0, { mq: 3, from: ['Mezze libanais'] }),
    it('tom', 0, { mq: 1, from: ['Mezze libanais'], need: '600 g' }), it('pot', 0, { mq: 1, from: ['Soupe de potiron'] }),
    it('ban', 2, { done: true }), it('lai', 6, { done: true }), it('yao', 1, { done: true }), it('oeu', 1),
    it('fet', 0, { mq: 2, from: ['Mezze libanais'] }), it('moz', 0, { mq: 2, from: ['Lasagnes'] }),
    it('hac', 0, { mq: 2, from: ['Lasagnes'] }), it('sau', 0, { mq: 1, from: ['Stoemp'], done: true }),
    it('poi', 0, { mq: 5, from: ['Mezze libanais', 'Curry de pois chiches'], need: '1,8 kg' }),
    it('bou', 0, { mq: 1, from: ['Mezze libanais'] }), it('tah', 0, { mq: 1, from: ['Mezze libanais'] }),
    it('coc', 0, { mq: 1, from: ['Curry de pois chiches'] }), it('pit', 0, { mq: 2, from: ['Mezze libanais'] }),
    it('caf', 1, { note: 'pour la cafetière à grains' }), it('eau', 2, { st: 'im' }),
    it('pap', 1, { sugg: 'Léa' }), it('jus', 2, { sugg: 'Léa' }),
  ] },
  { id: 'l20', type: 'dated', date: '2026-10-20', status: 'prep', items: [
    it('hac', 0, { mq: 1, from: ['Chili sin carne'] }), it('con', 0, { mq: 2, from: ['Chili sin carne'] }), it('riz', 1),
    it('lai', 6), it('ban', 2), it('pat', 0, { mq: 1, from: ['Pâtes au pesto'] }), it('pes', 0, { mq: 1, from: ['Pâtes au pesto'] }), it('eau', 2),
  ] },
  // Liste restee ouverte apres les courses (tout est pris) : rappel de cloture.
  { id: 'l09', type: 'dated', date: '2026-10-09', status: 'cours', items: [it('lai', 6, { done: true }), it('pat', 2, { done: true }), it('tom', 1, { done: true })] },
  { id: 'l06', type: 'dated', date: '2026-10-06', status: 'closed', items: [
    it('lai', 6, { done: true }), it('ban', 2, { done: true }), it('pat', 2, { done: true }), it('pou', 1, { done: true }),
    it('vai', 1, { unav: true }), it('eau', 2, { done: true }), it('beu', 1, { done: true }), it('tom', 1, { done: true }),
  ] },
  { id: 'l29', type: 'dated', date: '2026-09-29', status: 'closed', items: [
    it('lai', 6, { done: true }), it('oeu', 1, { done: true }), it('pdt', 1, { done: true }), it('sau', 1, { done: true }), it('caf', 1, { done: true }),
  ] },
];
const listById = (id) => LISTS.find((l) => l.id === id);
const qtyOf = (i) => i.q + i.mq;
const storeOf = (i) => (i.st && STORES[i.st].active ? i.st : advised(i.pid));
const counted = (l) => l.items.filter((i) => !i.sugg && !i.unav);
// Scenarios : chaque article chez le magasin retenu ; « tout chez X » (prix inconnu → meilleur ailleurs, non estimé).
function scenarios(l) {
  const items = counted(l), act = activeStores();
  const best = (pid) => { const xs = act.map((s) => price(pid, s)).filter((x) => x != null); return xs.length ? Math.min(...xs) : 0; };
  const plan = { total: 0, by: {}, unknown: 0 };
  for (const i of items) {
    const s = storeOf(i), pr = price(i.pid, s);
    plan.by[s] = (plan.by[s] || 0) + 1;
    if (pr == null) { plan.unknown++; plan.total += best(i.pid) * qtyOf(i); } else plan.total += pr * qtyOf(i);
  }
  const all = act.map((s) => {
    let total = 0, unknown = 0;
    for (const i of items) { const pr = price(i.pid, s); if (pr == null) { unknown++; total += best(i.pid) * qtyOf(i); } else total += pr * qtyOf(i); }
    return { st: s, total, unknown };
  }).sort((a, b) => a.total - b.total);
  const used = Object.keys(plan.by);
  const saving = all[0].total - plan.total;
  return { plan, all, used, saving, split: used.length > 1 && saving >= HOUSE.threshold };
}

// ---------- Plats ----------
// Ingredient : [produit, quantite, unite] (unite absente = emballages).
const DISHES = {
  hou: { n: 'Houmous', p: 4, t: '15 min', tags: ['libanais', 'végé'], url: 'https://www.exemple-recettes.be/houmous', times: 6, last: '2026-08-22',
    ings: [['poi', 400, 'g'], ['cit', 1], ['tah', 80, 'g'], ['cum', 1, 'cc'], ['hui', 3, 'cs']],
    steps: ['Égoutter et rincer les pois chiches.', 'Mixer avec le tahini, le jus de citron et le cumin.', 'Allonger avec un filet d’eau froide jusqu’à obtenir une crème lisse.', 'Servir avec un filet d’huile d’olive.'] },
  tab: { n: 'Taboulé', p: 4, t: '25 min', tags: ['libanais', 'végé'], times: 4, last: '2026-08-22',
    ings: [['bou', 1], ['per', 2], ['tom', 300, 'g'], ['cit', 1], ['hui', 4, 'cs']],
    steps: ['Faire gonfler le boulgour à l’eau froide 20 min.', 'Ciseler finement le persil, couper les tomates en dés.', 'Mélanger, assaisonner citron, huile, sel.'] },
  fal: { n: 'Falafels', p: 4, t: '40 min', tags: ['libanais', 'végé'], times: 3, last: '2026-08-22',
    ings: [['poi', 500, 'g'], ['per', 1], ['oig', 1, 'pc'], ['cum', 2, 'cc']],
    steps: ['Mixer pois chiches, oignon, persil et cumin.', 'Former des boulettes.', 'Frire 4 min à 175 °C.'] },
  mez: { n: 'Mezze libanais', p: 4, t: '1 h 20', tags: ['libanais', 'fête'], times: 2, last: '2026-08-22',
    parts: [['hou', 2], ['tab', 4], ['fal', 4]], ings: [['pit', 2], ['fet', 1]],
    notes: 'Houmous et taboulé la veille ; falafels au dernier moment.' },
  sto: { n: 'Stoemp', p: 4, t: '45 min', tags: ['belge', 'hiver'], times: 9, last: '2026-09-21',
    ings: [['pdt', 1], ['beu', 50, 'g']],
    groups: [{ g: 'Légume', o: [['carottes', [['car', 1]]], ['poireaux', []], ['épinards', []]] }, { g: 'Viande', o: [['saucisses', [['sau', 1]]], ['haché', [['hac', 1]]]] }],
    steps: ['Cuire pommes de terre et légume ensemble.', 'Écraser grossièrement avec le beurre.', 'Servir avec la viande poêlée.'] },
  las: { n: 'Lasagnes', p: 6, t: '1 h 30', tags: ['four'], times: 5, last: '2026-09-02', url: 'https://www.exemple-recettes.be/lasagnes',
    ings: [['hac', 2], ['con', 2], ['moz', 2], ['gru', 1]], steps: ['Préparer la bolognaise.', 'Monter les couches.', 'Cuire 40 min à 180 °C.'] },
  cur: { n: 'Curry de pois chiches', p: 4, t: '30 min', tags: ['végé', 'rapide'], times: 7, last: '2026-09-28', ahead: 'sortir le riz et couper l’oignon en fin d’après-midi',
    ings: [['poi', 2], ['coc', 1], ['oig', 1, 'pc'], ['riz', 300, 'g']], steps: ['Faire revenir l’oignon et les épices.', 'Ajouter pois chiches et lait de coco, mijoter 15 min.', 'Servir avec le riz.'] },
  sou: { n: 'Soupe de potiron', p: 4, t: '40 min', tags: ['végé', 'hiver'], times: 3, last: '2025-11-30',
    ings: [['pot', 1], ['oig', 1, 'pc'], ['beu', 20, 'g']], steps: ['Couper le potiron.', 'Cuire 25 min avec l’oignon.', 'Mixer.'] },
  pes: { n: 'Pâtes au pesto', p: 4, t: '15 min', tags: ['rapide'], times: 14, last: '2026-10-01', ings: [['pat', 1], ['pes', 1], ['gru', 1]] },
  chi: { n: 'Chili sin carne', p: 4, t: '50 min', tags: ['végé'], times: 1, last: '2026-03-14', ings: [['con', 2], ['riz', 300, 'g'], ['oig', 1, 'pc']] },
  pou: { n: 'Poulet rôti', p: 4, t: '1 h 10', tags: ['four', 'dimanche'], times: 8, last: '2026-09-27', ings: [['pou', 1], ['pdt', 1]] },
  crq: { n: 'Croque-monsieur', p: 4, tags: ['rapide'], times: 11, last: '2026-09-19', ings: [] },
  bao: { n: 'Bao au porc', p: 4, tags: [], times: 0, draft: 'Léa', ings: [['hac', 1]], notes: 'Vu chez Marie, recette à retrouver.' },
};
const WISHES = [
  { id: 1, dish: 'bao', by: 'Léa', status: 'pending' },
  { id: 2, dish: 'chi', by: 'Thomas', status: 'ok' },
];

// Repas : date, creneau, plat, personnes, variantes, recettes ecartees, suggestion.
let MID = 500;
const meal = (date, slot, dish, p = 4, x = {}) => ({ id: ++MID, date, slot, dish, p, opts: {}, skip: [], sugg: null, list: null, ...x });
const MEALS = [
  meal('2026-10-12', 'soir', 'sou'), meal('2026-10-13', 'soir', 'cur'),
  meal('2026-10-14', 'soir', 'sto', 4, { opts: { Légume: 'carottes', Viande: 'saucisses' } }), meal('2026-10-15', 'midi', 'crq', 2),
  meal('2026-10-15', 'soir', 'pes'), meal('2026-10-16', 'soir', 'las', 6), meal('2026-10-17', 'soir', 'mez', 8),
  meal('2026-10-18', 'midi', 'pou', 6), meal('2026-10-19', 'soir', 'sou'), meal('2026-10-20', 'soir', 'chi'),
  meal('2026-10-21', 'soir', 'pes'), meal('2026-10-22', 'soir', 'bao', 4, { sugg: 'Léa' }), meal('2026-10-24', 'soir', 'sto', 4, { opts: { Légume: 'épinards', Viande: 'haché' } }),
];
const MENU = { start: '2026-10-12', end: '2026-10-25', saved: true, note: 'Samedi 17 : anniversaire de Noé (8 personnes).' };
const SLOTS = { pdj: 'P.-déj.', midi: 'Midi', soir: 'Soir', coll: 'Goûter' };

// Ticket scanne (exemple) : libelle lu, quantite, prix, produit rapproche.
const TICKET = [
  { raw: 'POIS CHICHES 400G', q: 5, pr: 59, pid: 'poi', promo: true },
  { raw: 'PERSIL PLAT BTE', q: 3, pr: 109, pid: 'per' },
  { raw: 'CITRONS FILET', q: 2, pr: 219, pid: 'cit' },
  { raw: 'BOULGOUR 500G', q: 1, pr: 189, pid: 'bou' },
  { raw: 'FETA AOP 200G', q: 2, pr: 289, pid: 'fet' },
  { raw: 'PAIN PITA X6', q: 2, pr: 175, pid: 'pit' },
  { raw: 'LT COCO 400ML', q: 1, pr: 159, pid: 'coc' },
  { raw: 'SACS CONGEL.', q: 1, pr: 229, pid: null },
  { raw: 'REMISE 2E -50%', q: 1, pr: -45, pid: 'fet', remise: true },
];

// ---------- Sous-rayons ----------
// Un sous-rayon appartient a un rayon (Epicerie > Conserves). Un produit a un rayon et, facultativement, un sous-rayon ;
// chaque magasin peut ordonner les sous-rayons d'un rayon (sinon ordre par defaut).
const SUBS = { ep: { con: 'Conserves', pas: 'Pâtes, riz & céréales', cond: 'Condiments & épices', bis: 'Pain & biscuits', boi: 'Boissons' }, fr: { lai: 'Laitages & œufs', fro: 'Fromages' } };
const SUBORDER = { im: { ep: ['con', 'pas', 'cond', 'bis', 'boi'] }, co: { ep: ['boi', 'bis', 'pas', 'con', 'cond'] } };
Object.entries({ poi: 'con', con: 'con', coc: 'con', pat: 'pas', riz: 'pas', bou: 'pas', tah: 'cond', pes: 'cond', hui: 'cond', sel: 'cond', cum: 'cond', caf: 'boi', pit: 'bis', eau: 'boi', jus: 'boi', lai: 'lai', yao: 'lai', oeu: 'lai', beu: 'lai', fet: 'fro', moz: 'fro', gru: 'fro' })
  .forEach(([pid, s]) => { P[pid].sub = s; });
// « Boissons » n'est plus un rayon a part : sous-rayon d'Epicerie.
Object.values(P).forEach((p) => { if (p.cat === 'bs') { p.cat = 'ep'; p.sub = 'boi'; } });
delete CATS.bs;
Object.keys(ORDER).forEach((k) => { ORDER[k] = ORDER[k].filter((c) => c !== 'bs'); });
const subsOf = (cat, st) => { const all = Object.keys(SUBS[cat] || {}), o = ((SUBORDER[st] || {})[cat]) || []; return [...o.filter((k) => all.includes(k)), ...all.filter((k) => !o.includes(k))]; };
const catLabel = (p) => (p.sub && SUBS[p.cat] && SUBS[p.cat][p.sub] ? `${CATS[p.cat]} › ${SUBS[p.cat][p.sub]}` : CATS[p.cat]);
// Articles d'un rayon regroupes par sous-rayon (dans l'ordre du magasin) : [[cle | '', articles]].
const bySub = (cat, items, st) => { const ks = subsOf(cat, st), g = ks.map((k) => [k, items.filter((i) => P[i.pid].sub === k)]).filter(([, xs]) => xs.length), rest = items.filter((i) => !ks.includes(P[i.pid].sub)); if (rest.length) g.push(['', rest]); return g; };
// Choix « Rayon » / « Rayon › Sous-rayon » (une seule liste) : valeur « cat » ou « cat:sub ».
const catOptions = (cur) => Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${v}</option>` + Object.entries(SUBS[k] || {}).map(([s, n]) => `<option value="${k}:${s}" ${cur === `${k}:${s}` ? 'selected' : ''}>${v} › ${n}</option>`).join('')).join('');
