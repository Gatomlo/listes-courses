// Le Cabas · maquette v2 : onglet Plus (produits, magasins, foyer, import, installation) et écrans d'accès.
VIEWS.more = () => ({
  title: 'Plus', sub: HOUSE.name, large: true,
  body: `<button class="card tap row" style="padding:14px 16px;margin-bottom:14px" data-a="go" data-v="house">${avatar(MEMBERS[0])}<span class="grow"><b>Thomas</b><span class="sub" style="display:block">${isM() ? 'Gestionnaire' : 'Membre'} · ${HOUSE.name}</span></span>${I('chev', 's chev')}</button>
    <div class="group">
      ${[['products', 'tag', 'Produits', `${Object.keys(P).length} produits · prix moyens`], ['stores', 'store', 'Magasins', 'Couleurs, rayons et parcours'], ['promos', 'flame', 'Promos', `${PROMOS.filter((p) => p.until >= TODAY).length} en cours`], ['history', 'clock', 'Historique des listes', 'Listes clôturées'], ['house', 'users', 'Foyer', `${MEMBERS.length} membres · réglages · tags`]]
        .map(([v, ic, t, s]) => `<button class="row tap" data-a="go" data-v="${v}"><span class="ico">${I(ic)}</span><span class="grow"><b>${t}</b><span class="sub" style="display:block">${s}</span></span>${I('chev', 's chev')}</button>`).join('')}
    </div>
    <div class="group" style="margin-top:14px">
      <button class="row tap" data-a="csv"><span class="ico">${I('upload')}</span><span class="grow"><b>Importer des produits (CSV)</b><span class="sub" style="display:block">Paniers transcrits, avec relevés de prix</span></span>${I('chev', 's chev')}</button>
      <button class="row tap" data-a="menu-share"><span class="ico">${I('link')}</span><span class="grow"><b>Lien d’affichage du menu</b><span class="sub" style="display:block">Lecture seule, sans connexion</span></span>${I('chev', 's chev')}</button>
      <button class="row tap" data-a="install"><span class="ico acc">${I('phone')}</span><span class="grow"><b>Installer l’app</b><span class="sub" style="display:block">Sur l’écran d’accueil, hors-ligne</span></span>${I('chev', 's chev')}</button>
      <button class="row tap" data-a="go" data-v="auth" data-k="login" style="color:var(--danger)"><span class="ico">${I('logout')}</span><b class="grow">Se déconnecter</b></button>
    </div>`,
});
A.install = () => sheet(`<h3>Installer Le Cabas</h3><p class="lead">L’app s’ouvre alors comme les autres, en plein écran, et marche sans réseau en magasin.</p>
  <div class="seg" style="margin-bottom:12px"><button class="on">iPhone</button><button>Android</button><button>PC</button></div>
  <ol class="steps"><li>Ouvrir le site dans Safari.</li><li>Toucher le bouton Partager.</li><li>Choisir « Sur l’écran d’accueil ».</li></ol>
  <p class="sub" style="margin-top:12px">Appui long sur l’icône : nouvel article, envie de plat, nouveau plat.</p>`);
A.csv = () => sheet(`<h3>Importer des produits</h3><p class="lead">Fichier CSV : nom ; rayon ; emballage ; contenance ; magasin ; prix ; promo ; prix normal ; date.</p>
  <label class="card tap" style="display:grid;place-items:center;gap:6px;border:2px dashed var(--line);background:transparent;padding:22px;cursor:pointer">${I('upload', 'l')}<b>Choisir un fichier</b><input type="file" accept=".csv" hidden data-ch="csv-file"></label>
  <div class="sh"><span>Aperçu · colruyt-octobre.csv</span></div>
  <div class="group">${[['Nouveaux produits', 4, 'acc'], ['Produits existants', 11, ''], ['Relevés ajoutés', 15, 'acc'], ['Relevés déjà connus (ignorés)', 3, '']].map(([t, n, c]) => `<div class="row"><span class="grow">${t}</span><span class="pill ${c}">${n}</span></div>`).join('')}</div>
  <div class="foot"><button class="btn" data-a="csv-ok">Importer</button></div>`);
CH['csv-file'] = () => toast('Fichier lu · aperçu mis à jour');
A['csv-ok'] = () => { closeSheet(); toast('4 produits créés · 15 relevés ajoutés'); };

// ---------- Produits ----------
VIEWS.products = () => {
  const n = norm(S.q.pq), c = S.q.pc || '';
  const ps = Object.values(P).filter((p) => (!n || norm(p.n).includes(n)) && (!c || p.cat === c)).sort((a, b) => a.n.localeCompare(b.n, 'fr'));
  return {
    title: 'Produits', sub: `Prix moyens : ${HOUSE.records} derniers relevés hors promo, moins de 6 mois`,
    actions: `<button class="ib" data-a="csv" aria-label="Importer">${I('upload')}</button>`,
    body: `<div class="search" style="margin-bottom:10px">${I('search')}<input class="in" id="pq" placeholder="Rechercher un produit…" value="${esc(S.q.pq || '')}" data-in="pq"></div>
      <div class="chips" style="margin-bottom:12px"><button class="chip ${!c ? 'on' : ''}" data-a="pc" data-c="">Tous</button>${Object.entries(CATS).map(([k, v]) => `<button class="chip ${c === k ? 'on' : ''}" data-a="pc" data-c="${k}">${v}</button>`).join('')}</div>
      <div class="group">${ps.map((p) => { const adv = advised(p.id); return `<button class="row tap" data-a="go" data-v="product" data-id="${p.id}">
        <span class="grow"><b>${p.n}</b><span class="sub" style="display:block">${CATS[p.cat]} · ${p.u}${p.base ? ' · de base' : ''}${p.imp ? ` · imposé ${STORES[p.imp].n}` : ''}</span></span>
        <span style="display:grid;gap:2px;justify-items:end">${activeStores().map((s) => `<span class="small num ${s === adv ? 'b' : 'faint'}" style="${s === adv ? `color:${STORES[s].c}` : ''}">${dotS(s)} ${eur(price(p.id, s))}</span>`).join('')}</span></button>`; }).join('')}</div>`,
    dock: `<button class="addbar" data-a="noop">${I('plus')}<span class="grow">Nouveau produit</span></button>`,
  };
};
IN.pq = (el) => { S.q.pq = el.value; render(); const i = $('pq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
A.pc = (el) => { S.q.pc = el.dataset.c; render(); };
function spark(rs) {
  const W = 320, H = 84, pad = 10, xs = rs.map((r) => dt(r.date).getTime()), ys = rs.map((r) => r.price);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) * 0.96, y1 = Math.max(...ys) * 1.04;
  const X = (v) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - pad * 2), Y = (v) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - pad * 2);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Évolution des prix">
    ${[0.33, 0.66].map((g) => `<line x1="0" x2="${W}" y1="${H * g}" y2="${H * g}" stroke="var(--line)" stroke-width="1"/>`).join('')}
    ${['co', 'im'].map((s) => { const pts = rs.filter((r) => r.st === s).sort((a, b) => a.date.localeCompare(b.date)); if (!pts.length) return '';
      const d = pts.map((r, k) => `${k ? 'L' : 'M'}${X(dt(r.date).getTime()).toFixed(1)} ${Y(r.price).toFixed(1)}`).join(' '), last = pts[pts.length - 1];
      return `<path d="${d}" fill="none" stroke="${STORES[s].c}" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${X(dt(last.date).getTime())}" cy="${Y(last.price)}" r="3.5" fill="${STORES[s].c}"/>`; }).join('')}</svg>`;
}
VIEWS.product = (t) => {
  const p = P[t.id], rs = records(p.id), adv = advised(p.id);
  const inLists = LISTS.filter((l) => l.status !== 'closed' && l.items.some((i) => i.pid === p.id));
  return {
    title: p.n, sub: `${CATS[p.cat]} · ${p.u}`,
    actions: `<button class="ib" data-a="prod-menu" data-id="${p.id}" aria-label="Actions">${I('more')}</button>`,
    body: `<div class="cols"><div>
      <div class="cmp">${activeStores().map((s) => `<div style="--c:${STORES[s].c};--cs:${STORES[s].cs}" class="${adv === s ? 'best' : ''}"><div class="between"><b class="small">${STORES[s].n}</b>${adv === s ? `<span class="xs b">${p.imp === s ? 'imposé' : 'conseillé'}</span>` : ''}</div>
        <div class="big num" style="margin:6px 0 2px">${eur(price(p.id, s))}</div><div class="xs">${promoOf(p.id, s) ? `promo · moyenne ${eur(p.avg[s])}` : p.avg[s] == null ? 'aucun relevé' : `moyenne · ${Math.min(p.rc, HOUSE.records)} relevés`}</div></div>`).join('')}</div>
      ${rs.length > 1 ? `<div class="card" style="margin-top:12px"><div class="between small"><b>Évolution</b><span class="hstack">${['co', 'im'].map((s) => `${dotS(s)} <span class="muted">${STORES[s].n}</span>`).join(' ')}</span></div>${spark(rs)}</div>` : ''}
      <div class="sh"><span>Relevés</span><button data-a="rec-add" data-id="${p.id}">＋ Relevé</button></div>
      <div class="group">${rs.slice(0, 8).map((r) => `<div class="row">${dotS(r.st)}<span class="grow">${fmtD(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}<span class="sub" style="display:block">${STORES[r.st].n} · ${{ ticket: 'ticket scanné', caisse: 'prix payé en magasin', manuel: 'saisi à la main' }[r.src]}</span></span><b class="num">${eur(r.price)}</b></div>`).join('') || '<p class="empty">Aucun relevé.</p>'}</div>
      </div><div class="side-col">
      <div class="sh"><span>Réglages</span></div>
      <div class="group">
        <label class="row"><span class="grow">Magasin</span><select class="in" style="width:58%;height:38px"><option>Conseil : le moins cher</option>${activeStores().map((s) => `<option ${p.imp === s ? 'selected' : ''}>Toujours ${STORES[s].n}</option>`).join('')}</select></label>
        <label class="row"><span class="grow">Rayon</span><select class="in" style="width:58%;height:38px">${Object.entries(CATS).map(([k, v]) => `<option ${k === p.cat ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="row"><span class="grow">Emballage</span><input class="in" style="width:58%;height:38px" value="${p.u}"></label>
        <div class="row"><span class="grow">Ingrédient de base<span class="sub" style="display:block">vérifié, pas ajouté d’office</span></span><span class="sw ${p.base ? 'on' : ''}"></span></div>
        <div class="row"><span class="grow">Récurrent</span><span class="pill">${p.rec ? (p.rec === 1 ? 'chaque liste' : `toutes les ${p.rec} listes`) : 'non'}</span></div>
      </div>
      ${inLists.length ? `<div class="sh"><span>Dans les listes</span></div><div class="group">${inLists.map((l) => `<button class="row tap" data-a="go" data-v="list" data-id="${l.id}"><span class="grow">${listName(l)}</span>${I('chev', 's chev')}</button>`).join('')}</div>` : ''}
      </div></div>`,
  };
};
A['rec-add'] = (el) => sheet(`<h3>Nouveau relevé</h3><p class="lead">${P[el.dataset.id].n}</p>
  <div class="stack"><div class="seg">${activeStores().map((s, k) => `<button class="${k ? '' : 'on'}">${STORES[s].n}</button>`).join('')}</div>
  <div class="grid2"><label class="field"><span>Prix</span><input class="in" inputmode="decimal" placeholder="0,99"></label><label class="field"><span>Date</span><input class="in" type="date" value="${TODAY}"></label></div>
  <label class="row" style="padding:0"><span class="grow">Prix promo (hors moyenne)</span><span class="sw"></span></label></div>
  <div class="foot"><button class="btn" data-a="rec-ok">Enregistrer</button></div>`);
A['rec-ok'] = () => { if (!needNet()) return; closeSheet(); toast('Relevé ajouté · moyenne recalculée'); };
A['prod-menu'] = (el) => sheet(`<h3>${P[el.dataset.id].n}</h3><div class="menu-pop">
  <button data-a="prod-merge" data-id="${el.dataset.id}"><span class="ico">${I('merge')}</span>Fusionner avec un autre produit</button>
  <button class="danger" data-a="prod-del" data-id="${el.dataset.id}"><span class="ico">${I('trash')}</span>Supprimer le produit</button></div>`);
A['prod-merge'] = (el) => sheet(`<h3>Fusionner « ${P[el.dataset.id].n} »</h3><p class="lead">Relevés, articles et ingrédients passent sur le produit choisi.</p><div class="search">${I('search')}<input class="in" placeholder="Produit à garder…"></div>
  <div class="group" style="margin-top:10px">${Object.values(P).filter((p) => p.cat === P[el.dataset.id].cat && p.id !== el.dataset.id).slice(0, 5).map((p) => `<button class="row tap" data-a="close"><span class="grow">${p.n}</span>${I('merge')}</button>`).join('')}</div>`);
A['prod-del'] = (el) => confirmSheet(`Supprimer « ${P[el.dataset.id].n} » ?`, 'Retiré des listes en cours, relevés supprimés. Dans l’historique, il reste affiché barré.', 'Supprimer', () => { back(); toast('Produit supprimé'); });

// ---------- Magasins ----------
VIEWS.stores = () => ({
  title: 'Magasins', sub: 'Au moins un magasin actif',
  body: `<div class="group">${Object.entries(STORES).map(([k, s]) => `<div class="row"><span class="ico" style="background:${s.cs};color:${s.c}">${I('store')}</span>
    <button class="grow" style="text-align:left" data-a="go" data-v="store" data-id="${k}"><b>${s.n}</b><span class="sub" style="display:block">${s.active ? 'Actif' : 'Inactif : ignoré dans les conseils'}</span></button>
    <button class="sw ${s.active ? 'on' : ''}" data-a="store-act" data-id="${k}" aria-label="Actif"></button></div>`).join('')}</div>
    <div class="sh"><span>Rayons</span><button data-a="cat-add">＋ Rayon</button></div>
    <div class="group">${Object.entries(CATS).map(([k, v]) => `<button class="row tap" data-a="cat-edit" data-id="${k}"><span class="grow">${v}</span><span class="sub">${Object.values(P).filter((p) => p.cat === k).length} produits</span>${I('edit', 's chev')}</button>`).join('')}</div>`,
  dock: isM() ? `<button class="addbar" data-a="noop">${I('plus')}<span class="grow">Nouveau magasin</span></button>` : null,
});
A['store-act'] = (el) => { const s = STORES[el.dataset.id]; if (s.active && activeStores().length < 2) { toast('Il faut au moins un magasin actif'); return; } s.active = !s.active; render(); };
A['cat-add'] = () => sheet(`<h3>Nouveau rayon</h3><input class="in" placeholder="ex. Surgelés"><p class="sub" style="margin-top:8px">Ajouté en fin de parcours de tous les magasins.</p><div class="foot"><button class="btn" data-a="close">Créer</button></div>`);
A['cat-edit'] = (el) => sheet(`<h3>Rayon</h3><input class="in" value="${CATS[el.dataset.id]}"><div class="foot"><button class="btn danger" data-a="close">Supprimer</button><button class="btn" data-a="close">Renommer</button></div>`);
VIEWS.store = (t) => {
  const s = STORES[t.id], ord = ORDER[t.id];
  return {
    title: s.n, sub: 'Parcours : l’ordre des rayons trie la liste et le mode courses',
    body: `<div class="stack"><label class="field"><span>Nom</span><input class="in" value="${s.n}"></label>
      <div class="field"><span>Couleur</span><div class="hstack">${['var(--im)', 'var(--co)', 'var(--al)', 'var(--accent)', 'var(--plum)', 'var(--warn)'].map((c) => `<button class="avatar" style="--c:${c};${s.c === c ? 'outline:3px solid var(--ink);outline-offset:2px' : ''}" data-a="store-col" data-id="${t.id}" data-c="${c}" aria-label="Couleur"></button>`).join('')}</div></div></div>
      <div class="sh"><span>Ordre des rayons</span><span class="xs" style="text-transform:none;letter-spacing:0">glisser sur PC</span></div>
      <div class="group">${ord.map((c, k) => `<div class="row"><span class="faint">${I('grip')}</span><span class="num faint small" style="width:18px">${k + 1}</span><span class="grow">${CATS[c]}</span>
        <button class="ib" data-a="ord" data-id="${t.id}" data-k="${k}" data-d="-1" ${k ? '' : 'disabled'} aria-label="Monter">${I('up', 's')}</button><button class="ib" data-a="ord" data-id="${t.id}" data-k="${k}" data-d="1" ${k < ord.length - 1 ? '' : 'disabled'} aria-label="Descendre">${I('down', 's')}</button></div>`).join('')}</div>`,
  };
};
A.ord = (el) => { const o = ORDER[el.dataset.id], k = Number(el.dataset.k), j = k + Number(el.dataset.d); [o[k], o[j]] = [o[j], o[k]]; render(); };
A['store-col'] = (el) => { const s = STORES[el.dataset.id]; s.c = el.dataset.c; s.cs = `color-mix(in srgb, ${el.dataset.c} 16%, var(--surface))`; render(); };

// ---------- Foyer ----------
VIEWS.house = () => ({
  title: 'Foyer', sub: HOUSE.name,
  body: `<div class="cols"><div>
    <div class="sh"><span>Membres</span>${isM() ? '<button data-a="invite">＋ Inviter</button>' : ''}</div>
    <div class="group">${MEMBERS.map((m) => `<button class="row tap" data-a="${isM() && !m.me ? 'member' : 'noop'}" data-id="${m.id}">${avatar(m)}<span class="grow"><b>${m.n}${m.me ? ' (vous)' : ''}</b><span class="sub" style="display:block">${m.mail}</span></span><span class="pill ${m.role === 'manager' ? 'acc' : ''}">${m.role === 'manager' ? 'Gestionnaire' : 'Membre'}</span></button>`).join('')}
      ${INVITES.map((v) => `<div class="row"><span class="ico">${I('mail')}</span><span class="grow"><b>Invitation en attente</b><span class="sub" style="display:block">${v.role === 'member' ? 'Membre' : 'Gestionnaire'} · créée le ${fmtD(v.made)}</span></span><button class="btn sm sec" data-a="invite">Lien</button></div>`).join('')}</div>
    <div class="sh"><span>Tags des plats</span></div>
    <div class="group">${[...new Set(Object.values(DISHES).flatMap((d) => d.tags))].sort().map((tg) => `<button class="row tap" data-a="${isM() ? 'tag-edit' : 'noop'}" data-t="${tg}"><span class="grow">#${tg}</span><span class="sub">${Object.values(DISHES).filter((d) => d.tags.includes(tg)).length} plats</span>${isM() ? I('edit', 's chev') : ''}</button>`).join('')}</div>
    </div><div class="side-col">
    <div class="sh"><span>Réglages</span></div>
    <div class="group">
      ${[['Rythme des courses', `${HOUSE.rhythm} jours`, 'date proposée d’une nouvelle liste'], ['Seuil d’économie', eur(HOUSE.threshold), 'pour conseiller deux magasins'], ['Relevés pour la moyenne', HOUSE.records, 'moins de 6 mois, hors promo'], ['Durée d’un menu', `${HOUSE.menuDays} jours`, 'période proposée'], ['Début du menu', HOUSE.startDow, '']]
        .map(([a, b, c]) => `<button class="row tap" data-a="${isM() ? 'setting' : 'mgr-only'}" data-t="${a}" data-v="${b}"><span class="grow">${a}${c ? `<span class="sub" style="display:block">${c}</span>` : ''}</span><b class="num">${b}</b>${I('chev', 's chev')}</button>`).join('')}
      <div class="row"><span class="grow">Coût fixe d’un 2e magasin<span class="sub" style="display:block">trajet, temps : relève le seuil</span></span><span class="sw"></span></div>
    </div>
    ${isM() ? `<button class="btn ghost" style="margin-top:12px;color:var(--danger)" data-a="noop">Supprimer le foyer</button>` : ''}
    </div></div>`,
});
A.invite = () => sheet(`<h3>Inviter dans le foyer</h3><p class="lead">Le lien permet de créer un compte (e-mail + mot de passe) et rejoint ${HOUSE.name}.</p>
  <div class="seg" style="margin-bottom:12px"><button class="on">Membre</button><button>Gestionnaire</button></div>
  <div class="hstack"><input class="in grow" readonly value="https://exemple.be/cabas/?invite=Qm8x…" id="inv-url"><button class="btn sm" data-a="inv-copy">Copier</button></div>
  <p class="sub" style="margin-top:10px">Membre : ajoute en suggestion, coche, modifie quantités et notes. Gestionnaire : tout le reste.</p>`);
A['inv-copy'] = async () => { try { await navigator.clipboard.writeText($('inv-url').value); toast('Lien copié'); } catch { $('inv-url').select(); } };
A.member = (el) => { const m = MEMBERS.find((x) => x.id === el.dataset.id); sheet(`<h3>${m.n}</h3><p class="lead">${m.mail}</p>
  <div class="seg" style="margin-bottom:12px"><button class="${m.role === 'member' ? 'on' : ''}" data-a="role" data-id="${m.id}" data-r="member">Membre</button><button class="${m.role === 'manager' ? 'on' : ''}" data-a="role" data-id="${m.id}" data-r="manager">Gestionnaire</button></div>
  <div class="menu-pop"><button data-a="reset-link"><span class="ico">${I('lock')}</span>Créer un lien de nouveau mot de passe</button><button class="danger" data-a="close"><span class="ico">${I('logout')}</span>Retirer du foyer</button></div>`); };
A.role = (el) => { MEMBERS.find((x) => x.id === el.dataset.id).role = el.dataset.r; closeSheet(); toast('Rôle changé'); render(); };
A['reset-link'] = () => sheet(`<h3>Lien de réinitialisation</h3><p class="lead">À transmettre à la main (pas d’e-mail envoyé). Valable 24 h.</p><div class="hstack"><input class="in grow" readonly value="https://exemple.be/cabas/?reset=Zr4…"><button class="btn sm" data-a="close">Copier</button></div>`);
A.setting = (el) => sheet(`<h3>${el.dataset.t}</h3><input class="in" value="${el.dataset.v}"><div class="foot"><button class="btn" data-a="close">Enregistrer</button></div>`);
A['tag-edit'] = (el) => sheet(`<h3>#${el.dataset.t}</h3><p class="lead">Renommer vers un tag existant les fusionne.</p><input class="in" value="${el.dataset.t}"><div class="foot"><button class="btn danger" data-a="close">Supprimer</button><button class="btn" data-a="close">Renommer</button></div>`);

// ---------- Écrans d'accès ----------
VIEWS.auth = (t) => {
  const k = t.k;
  const c = {
    login: ['Bon retour', 'Connectez-vous pour retrouver les listes du foyer.', [['E-mail', 'email', 'thomas@exemple.be'], ['Mot de passe', 'password', '']], 'Se connecter', '<button class="btn ghost" data-a="go" data-v="auth" data-k="reset">Mot de passe oublié ?</button>'],
    setup: ['Premier compte', 'Aucun compte n’existe encore : celui-ci gérera le premier foyer.', [['Prénom', 'text', ''], ['E-mail', 'email', ''], ['Mot de passe', 'password', '']], 'Créer mon compte', ''],
    invite: ['Rejoindre Foyer Phoenix', 'Thomas vous invite comme membre.', [['Prénom', 'text', 'Noé'], ['E-mail', 'email', ''], ['Mot de passe', 'password', '']], 'Rejoindre le foyer', '<button class="btn ghost" data-a="go" data-v="auth" data-k="login">J’ai déjà un compte</button>'],
    reset: ['Nouveau mot de passe', 'Sans e-mail : demandez un lien à un gestionnaire du foyer, puis choisissez votre mot de passe ici.', [['Nouveau mot de passe', 'password', ''], ['Confirmer', 'password', '']], 'Enregistrer', ''],
  }[k];
  return {
    title: '', noTabs: true,
    body: `<form class="auth" data-a="noop"><div class="logo">${I('basket', 'l')}</div><div><h1 class="ltitle" style="display:block">${c[0]}</h1><p class="lsub" style="margin:4px 2px 0">${c[1]}</p></div>
      ${c[2].map(([l, ty, v], j) => `<label class="field"><span>${l}</span><input class="in" id="au${j}" type="${ty}" value="${v}" autocomplete="${ty === 'password' ? 'current-password' : 'on'}"></label>`).join('')}
      <button class="btn full" type="button" data-a="auth-ok">${c[3]}</button>${c[4]}</form>`,
  };
};
A['auth-ok'] = () => { S.stack = [{ v: 'home' }]; S.tab = 'home'; render('f'); toast('Connecté · Foyer Phoenix'); };
