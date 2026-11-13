// Le Cabas · maquette v4 : fiche repas simplifiée.
// Priorité à ce qui sert le plus : les convives (− / +) et les ingrédients (touchés = en réserve).
// Tout le reste (changer de plat, liste, remarque, retirer…) passe par un seul bouton « Plus ».
(() => {
  const old = A['meal-open'];
  const getM = (id) => MEALS.find((x) => x.id === Number(id));
  let mid = null;
  // Ingrédients du repas avec quantités pour le nombre de convives (recettes composées incluses).
  const needs = (m) => {
    const d = DISHES[m.dish], f = m.p / d.p, out = [];
    const add = (src, fac) => src.forEach(([pid, q, u]) => { const o = out.find((x) => x[0] === pid && x[2] === u); if (o && q != null && o[1] != null) o[1] += q * fac; else if (!o) out.push([pid, q == null ? null : q * fac, u]); });
    add([...d.ings, ...(d.groups || []).flatMap((g) => (g.o.find((o) => o[0] === (m.opts || {})[g.g]) || g.o[0])[1])], f);
    (d.parts || []).filter(([p]) => !m.skip.includes(p)).forEach(([p, pp]) => add(DISHES[p].ings, f * pp / DISHES[p].p));
    return out;
  };
  const body = () => {
    const m = getM(mid), d = DISHES[m.dish]; m.res = m.res || []; m.extra = m.extra || [];
    const all = needs(m), buy = all.filter(([pid]) => !P[pid].base), base = all.filter(([pid]) => P[pid].base);
    const nBuy = buy.filter(([pid]) => !m.res.includes(pid)).length, c = mealCost(m);
    const lst = m.list ? `Liste du ${fmtD(m.list, { day: 'numeric', month: 'short' })}` : `Liste du ${fmtD(LISTS.filter((l) => l.type === 'dated' && l.date <= m.date).map((l) => l.date).sort().pop() || '2026-10-13', { day: 'numeric', month: 'short' })}`;
    const row = ([pid, q, u], isBase) => {
      const off = isBase ? !m.extra.includes(pid) : m.res.includes(pid);
      return `<button class="row tap" data-a="mm-ing" data-pid="${pid}" data-base="${isBase ? 1 : ''}"><span class="ck sq ${off ? '' : 'on'}">${I('check')}</span><span class="grow ${off && !isBase ? 'faint' : ''}" ${off && !isBase ? 'style="text-decoration:line-through"' : ''}>${P[pid].n}</span><span class="sub">${off && !isBase ? 'en réserve' : ingText([pid, q, u])}</span></button>`;
    };
    return `<h3>${dishLabel(m)}</h3>
      <p class="lead">${fmtD(m.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${SLOTS[m.slot]}${m.sugg ? ` · suggéré par ${m.sugg}` : ''}</p>
      <div class="group"><div class="row"><span class="grow"><b>Convives</b></span><span class="stepper"><button data-a="mm-p" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${m.p}</b><button data-a="mm-p" data-d="1" aria-label="Plus">${I('plus')}</button></span></div></div>
      ${(d.groups || []).map((g) => `<div class="seg" style="margin-top:10px">${g.o.map(([o]) => `<button class="${(m.opts || {})[g.g] === o ? 'on' : ''}" data-a="mm-opt" data-g="${g.g}" data-o="${o}">${o}</button>`).join('')}</div>`).join('')}
      ${d.parts ? `<div class="hstack" style="gap:6px;flex-wrap:wrap;margin-top:10px">${d.parts.map(([p]) => `<button class="chip ${m.skip.includes(p) ? '' : 'on'}" data-a="mm-part" data-k="${p}">${m.skip.includes(p) ? '' : I('check', 's') + ' '}${DISHES[p].n}</button>`).join('')}</div>` : ''}
      <div class="sh"><span>Ingrédients</span><span class="xs" style="text-transform:none;letter-spacing:0">${buy.length ? `${nBuy} à acheter` : ''}${c.cost != null && buy.length ? ` · ${c.partial ? 'dès ' : '≈ '}${eur(c.cost)}` : ''}</span></div>
      <div class="group">${buy.map((g) => row(g, false)).join('') || '<p class="empty">Aucun ingrédient pour ce plat.</p>'}
        ${base.length ? `<button class="row tap" data-a="mm-base"><span class="ico">${I('box')}</span><span class="grow sub">Ingrédients de base (${base.length})${m.extra.length ? ` · ${m.extra.length} ajouté${m.extra.length > 1 ? 's' : ''}` : ''}</span>${I('chev', 's chev')}</button>${S.q.mmBase ? base.map((g) => row(g, true)).join('') : ''}` : ''}</div>
      ${buy.length ? '<p class="sub" style="margin:6px 2px 0">Touchez un ingrédient déjà en réserve : il ne sera pas acheté.</p>' : ''}
      ${m.sugg && isM() ? `<div class="foot"><button class="btn danger" data-a="meal-del" data-id="${m.id}">Refuser</button><button class="btn" data-a="meal-accept" data-id="${m.id}">Accepter</button></div>`
        : `<div class="btn-row" style="margin-top:14px"><button class="btn grow" data-a="go" data-v="dish" data-id="${m.dish}">${I('book', 's')} Fiche du plat</button>${isM() ? `<button class="btn sec" data-a="mm-more">${I('more', 's')} Plus</button>` : ''}</div>`}
      <p class="sub" style="text-align:center;margin:12px 0 0">${lst} · <button class="lnk" data-a="mm-more">modifier</button></p>`;
  };
  A['meal-open'] = (el) => {
    const m = getM(el.dataset.id); if (!m) return;
    if (m.rest) return old(el);
    mid = m.id; live(body);
  };
  A['mm-p'] = (el) => { const m = getM(mid); m.p = Math.max(1, m.p + Number(el.dataset.d)); refresh(); render(); };
  A['mm-opt'] = (el) => { getM(mid).opts[el.dataset.g] = el.dataset.o; refresh(); };
  A['mm-part'] = (el) => { const m = getM(mid), k = el.dataset.k; m.skip = m.skip.includes(k) ? m.skip.filter((x) => x !== k) : [...m.skip, k]; refresh(); };
  A['mm-base'] = () => { S.q.mmBase = !S.q.mmBase; refresh(); };
  A['mm-ing'] = (el) => {
    const m = getM(mid), k = el.dataset.pid, key = el.dataset.base ? 'extra' : 'res';
    m[key] = m[key].includes(k) ? m[key].filter((x) => x !== k) : [...m[key], k]; refresh();
  };
  // Tout le reste, rangé au même endroit.
  A['mm-more'] = () => { const m = getM(mid); live(() => `<h3>${I('more', 's')} ${dishLabel(m)}</h3>
    <div class="group">
      <button class="row tap" data-a="mm-swap"><span class="ico">${I('repeat')}</span><span class="grow">Changer de plat</span>${I('chev', 's chev')}</button>
      <button class="row tap" data-a="mm-wish"><span class="ico">${I('bulb')}</span><span class="grow">Remettre en envie</span>${I('chev', 's chev')}</button>
      <div class="row"><span class="ico">${I('basket')}</span><span class="grow">Liste</span><select class="in" style="width:auto"><option>Automatique</option>${dated().map((l) => `<option>Liste du ${fmtD(l.date, { day: 'numeric', month: 'short' })}</option>`).join('')}</select></div>
      <div class="row"><span class="ico">${I('edit')}</span><span class="grow"><input class="in" placeholder="Rappel pour ce repas (facultatif)" value="${esc(m.note || '')}"></span></div>
    </div>
    <div class="foot"><button class="btn danger" data-a="meal-del" data-id="${m.id}">${I('trash', 's')} Retirer du menu</button><button class="btn" data-a="mm-back">Retour</button></div>`); };
  A['mm-back'] = () => live(body);
  A['mm-swap'] = () => A['meal-edit']({ dataset: { id: mid } });
  A['mm-wish'] = () => { const m = getM(mid); MEALS.splice(MEALS.indexOf(m), 1); if (!WISHES.some((w) => w.dish === m.dish)) WISHES.push({ id: Date.now(), dish: m.dish, by: 'Thomas', status: 'ok' }); closeSheet(); toast('Repas retiré · plat remis en envie'); render(); };
})();
