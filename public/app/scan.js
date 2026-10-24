// Scan du ticket de caisse : photo -> preparation de l'image -> lecture sur le telephone
// (Tesseract.js, rien n'est envoye a un service tiers) -> lignes rapprochees du
// catalogue -> validation -> operation receipt.save (fonctionne aussi hors-ligne).
import { esc, eur, on, acc, sheet, closeSheet, toast, formData, localDay, isPc } from './ui.js';
import { I } from './icons.js';
import { get, sync, newOp, attempt } from './api.js';
import { S, hp, render, go, loadProducts, activeStores, storeById, catName, categoryOrder } from './state.js';
import { parseTicket, detectStore, matchLines } from './ticket.mjs';
import { unitOptions, catOptions, contField } from './catalogue.js';

const abs = (p) => new URL(p, document.baseURI).href;
let scan = null; // { listId, storeId, date, status, progress, text, lines: [...] }

// ---------- Prise de photo ----------
// Le choix du fichier doit partir directement du clic (exigence des navigateurs).
export function startScan(lid, sid) {
  const input = document.createElement('input');
  input.type = 'file';
  // Sans « capture » : le téléphone propose Appareil photo, Photos et Fichiers (ticket reçu en PDF).
  input.accept = 'image/*,application/pdf,.pdf';
  input.addEventListener('change', () => {
    if (!input.files[0]) return;
    closeSheet();
    scan = { listId: Number(lid) || null, storeId: Number(sid) || null, date: localDay(), status: 'reading', progress: 0, lines: [] };
    go('#/scan');
    read(input.files[0]);
  });
  input.click();
}
on('click', 'scan-start', (el) => startScan(el.dataset.lid, el.dataset.sid));

// Image preparee : largeur ramenee entre 1000 et 1800 px, niveaux de gris, contraste
// etire (les tickets thermiques sont souvent pales).
async function prepare(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1800 / img.width, Math.max(1, 1000 / img.width));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = y;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i] - lo) * k;
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  g.putImageData(d, 0, 0);
  return c;
}

let tesseract = null;
function loadTesseract() {
  if (tesseract) return tesseract;
  tesseract = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = abs('vendor/tesseract/tesseract.min.js');
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tesseract = null; reject(new Error('Lecteur de ticket indisponible (ouvrez l’app une fois avec du réseau).')); };
    document.head.appendChild(s);
  });
  return tesseract;
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

let pdfjs = null;
function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = abs('vendor/pdfjs/pdf.min.js');
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.js'); resolve(window.pdfjsLib); };
    s.onerror = () => { pdfjs = null; reject(new Error('Lecteur de PDF indisponible (ouvrez l’app une fois avec du réseau).')); };
    document.head.appendChild(s);
  });
  return pdfjs;
}

// PDF : le texte du ticket est lu directement s'il y en a un (cas des tickets reçus par e-mail),
// sinon les pages sont dessinées puis lues comme une photo.
async function readPdf(file) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = Math.min(doc.numPages, 6);
  let text = '';
  for (let n = 1; n <= pages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      const row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (row) row.c.push({ x, t: it.str }); else rows.push({ y, c: [{ x, t: it.str }] });
    }
    rows.sort((a, b) => b.y - a.y);
    text += rows.map((r) => r.c.sort((a, b) => a.x - b.x).map((c) => c.t.trim()).join(' ')).join('\n') + '\n';
  }
  if (text.replace(/\s/g, '').length >= 40) { scan.progress = 100; return text; }
  const canvases = [];
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: Math.min(3, 1800 / page.getViewport({ scale: 1 }).width) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    canvases.push(c);
  }
  return ocr(canvases);
}

async function ocr(canvases) {
  const T = await loadTesseract();
  const worker = await T.createWorker('fra', 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract-core'),
    langPath: abs('vendor/tessdata'),
    logger: (m) => {
      if (m.status === 'recognizing text' && scan) { scan.progress = Math.round(m.progress * 100); updateProgress(); }
    },
  });
  let text = '';
  for (const c of canvases) text += (await worker.recognize(c)).data.text + '\n';
  await worker.terminate();
  return text;
}

async function read(file) {
  try {
    const text = isPdf(file) ? await readPdf(file) : await ocr([await prepare(file)]);
    await analyse(text);
  } catch (e) {
    if (scan) { scan.status = 'error'; scan.error = e.message; render(); }
  }
}
function updateProgress() {
  const bar = document.querySelector('#scan-progress i');
  if (bar) bar.style.width = `${scan.progress}%`;
  const t = document.querySelector('#scan-progress-text');
  if (t) t.textContent = `Lecture du ticket… ${scan.progress} %`;
}

async function analyse(text) {
  if (!S.products) await loadProducts();
  const aliases = await get(hp('/aliases')).catch(() => []);
  const list = scan.listId ? await get(hp(`/lists/${scan.listId}`)).catch(() => null) : null;
  const t = parseTicket(text);
  scan.text = text;
  if (t.date) scan.date = t.date;
  const detected = detectStore(text, activeStores());
  if (!scan.storeId || (detected && detected !== scan.storeId && !scan.storeFixed)) scan.storeId = detected || scan.storeId || activeStores()[0].id;
  scan.listItems = list ? list.items : [];
  scan.aliases = aliases;
  scan.lines = matchLines(t.items, { products: S.products, aliases, storeId: scan.storeId, listItems: scan.listItems })
    .map((l) => ({ ...l, on: true }));
  scan.status = 'review';
  render();
}

// ---------- Ecran de validation ----------
const price = (n) => (n == null ? '' : n.toFixed(2).replace('.', ','));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pickLabel = (cur) => (cur === 'ignore' ? 'Ignorée' : cur ? (S.products.find((p) => p.id === cur)?.name || '— à associer —') : '— à associer —');
// Choix d'un produit : panneau avec recherche (la liste complète est trop longue pour un menu déroulant).
let pickLine = null;
function pickRows(q) {
  const n = norm(q).trim();
  const row = (v, label, cls = '') => `<button class="item click${cls}" data-a="scan-pick-ok" data-v="${v}"><span class="grow">${label}</span></button>`;
  const items = [...S.products].sort((a, b) => a.name.localeCompare(b.name)).filter((p) => !n || norm(p.name).includes(n));
  return `${row('new', '＋ Créer un produit…')}${row('ignore', 'Ignorer cette ligne')}${n ? '' : row('', '— à associer —')}
    ${items.map((p) => row(p.id, esc(p.name))).join('') || '<p class="muted" style="padding:12px 14px;margin:0">Aucun produit.</p>'}`;
}

export function scanView() {
  if (!scan) return { title: 'Ticket', back: '#/listes', body: '<p class="muted">Aucun ticket en cours.</p>' };
  const back = scan.listId ? `#/listes/${scan.listId}` : '#/listes';
  if (scan.status === 'reading') {
    return {
      title: 'Lecture du ticket', back,
      body: `<div class="card"><p id="scan-progress-text">Lecture du ticket… ${scan.progress} %</p><div class="bar" id="scan-progress"><i style="width:${scan.progress}%;background:var(--leaf)"></i></div>
        <p class="muted small">Lecture sur le téléphone (Tesseract.js), rien n'est envoyé. La première fois, le lecteur se charge (quelques secondes).</p></div>`,
    };
  }
  if (scan.status === 'error') {
    return { title: 'Ticket', back, body: `<div class="card error">${esc(scan.error)}</div><button class="btn" data-a="scan-start" data-lid="${scan.listId || ''}" data-sid="${scan.storeId || ''}">${I('camera', 's')} Reprendre une photo</button>` };
  }
  const st = storeById(scan.storeId);
  const on_ = scan.lines.filter((l) => l.on && l.product_id !== 'ignore');
  const todo = on_.filter((l) => !l.product_id && !l.create).length;
  const total = on_.reduce((n, l) => n + (Number(l.unit) || 0) * (Number(l.qty) || 1), 0);
  const avgOf = (pid) => { const p = S.products.find((x) => x.id === pid); return p && p.prices[scan.storeId] ? p.prices[scan.storeId].avg : null; };
  const rows = scan.lines.map((l, i) => {
    const avg = typeof l.product_id === 'number' ? avgOf(l.product_id) : null;
    const delta = avg && l.unit ? Math.round(((l.unit * 100 - avg) / avg) * 100) : null;
    return `<div class="item scanline${l.on ? '' : ' off'}"><button class="chk${l.on ? ' on' : ''}" data-a="scan-toggle" data-i="${i}">${l.on ? '✓' : ''}</button>
      <div class="grow"><input class="txt sm mono" value="${esc(l.label)}" data-ch="scan-label" data-i="${i}" aria-label="Libellé lu">
      <div class="row gap"><input class="txt w5 sm c" value="${esc(String(l.qty).replace('.', ','))}" data-ch="scan-qty" data-i="${i}" aria-label="Quantité"><span class="muted">×</span><input class="txt w5 sm c" value="${price(l.unit)}" data-ch="scan-unit" data-i="${i}" aria-label="Prix unitaire"><span class="muted small">€</span>
      <label class="row small"><input type="checkbox" class="cb" data-ch="scan-promo" data-i="${i}" ${l.promo ? 'checked' : ''}>promo</label></div>
      ${l.create ? `<div class="pill p-carrot">＋ créer « ${esc(l.create.name)} » (${esc(catName(Number(l.create.category_id)))})</div>`
        : `<button class="txt sm pick-btn" data-a="scan-pick" data-i="${i}">${esc(pickLabel(l.product_id))} ▾</button>`}
      <div class="muted small">${l.how === 'alias' ? '<span class="pill p-plum">correspondance mémorisée</span> ' : l.how === 'guess' ? '<span class="pill p-grey">proposé</span> ' : ''}${avg != null ? `moyenne ${eur(avg)}` : ''}${delta && Math.abs(delta) >= 1 ? ` · <b class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta} %</b>` : ''}</div>
      </div></div>`;
  }).join('');
  return {
    title: `Ticket ${st ? st.name : ''}`, back,
    sub: `${scan.lines.length} ligne${scan.lines.length > 1 ? 's' : ''} lue${scan.lines.length > 1 ? 's' : ''}${todo ? ` · ${todo} à associer` : ''} · ${eur(Math.round(total * 100))}`,
    body: `<div class="card"><div class="row gap"><label class="grow"><span class="muted">Magasin</span><select class="txt" data-ch="scan-store">${activeStores().map((s) => `<option value="${s.id}" ${s.id === scan.storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="grow"><span class="muted">Date</span><input class="txt" type="date" value="${scan.date}" data-ch="scan-date"></label></div>
      <p class="muted small">Chaque ligne validée devient un prix relevé ${st ? 'chez ' + esc(st.name) : ''} et coche l'article de la liste. Les associations sont mémorisées pour les prochains tickets.</p></div>
      ${acc('scan_lines', { icon: `${I('receipt', 's')} `, title: 'Lignes du ticket', sum: ` · ${on_.length} retenue${on_.length > 1 ? 's' : ''}`, def: true,
        body: (rows || '<p class="muted">Aucune ligne reconnue. Reprenez la photo bien à plat, avec de la lumière.</p>') + '<button class="btn sm sec2" style="margin:8px 0" data-a="scan-add">＋ Ajouter une ligne</button>' })}
      ${acc('scan_text', { icon: `${I('doc', 's')} `, title: 'Texte lu', sum: ' · pour vérifier', body: `<pre class="ocr">${esc(scan.text || '')}</pre>` })}
      <div class="row end wide"><button class="btn sec2" data-a="scan-start" data-lid="${scan.listId || ''}" data-sid="${scan.storeId || ''}">${I('camera', 's')} Reprendre</button><button class="btn" data-a="scan-save" ${todo ? 'disabled title="Des lignes sont à associer, à créer ou à ignorer"' : ''}>Valider et mettre à jour les prix</button></div>`,
  };
}

const line = (el) => scan.lines[Number(el.dataset.i)];
const num = (v) => Number(String(v).replace(',', '.'));
on('click', 'scan-toggle', (el) => { const l = line(el); l.on = !l.on; render(); });
on('change', 'scan-label', (el) => { line(el).label = el.value; });
on('change', 'scan-qty', (el) => { line(el).qty = num(el.value) || 1; render(); });
on('change', 'scan-unit', (el) => { line(el).unit = num(el.value) || null; render(); });
on('change', 'scan-promo', (el) => { line(el).promo = el.checked; });
on('change', 'scan-date', (el) => { scan.date = el.value; });
on('change', 'scan-store', (el) => {
  scan.storeId = Number(el.value);
  scan.storeFixed = true;
  // Correspondances du magasin choisi
  scan.lines = matchLines(scan.lines, { products: S.products, aliases: scan.aliases, storeId: scan.storeId, listItems: scan.listItems })
    .map((l, i) => ({ ...scan.lines[i], product_id: scan.lines[i].create ? null : (l.product_id ?? scan.lines[i].product_id), how: l.how }));
  render();
});
on('click', 'scan-pick', (el) => {
  pickLine = Number(el.dataset.i);
  const l = scan.lines[pickLine];
  sheet(`<h3>Associer à un produit</h3><p class="muted small">Ligne du ticket : « ${esc(l.label)} »</p>
    <div class="search" style="margin:10px 0">${I('search')}<input class="txt" id="scan-q" placeholder="Rechercher un produit…" data-in="scan-q" autocomplete="off"></div>
    <div class="group fs-list" id="scan-pick-list">${pickRows('')}</div>`);
  if (!isPc()) document.getElementById('scan-q')?.focus();
});
on('input', 'scan-q', (el) => { document.getElementById('scan-pick-list').innerHTML = pickRows(el.value); });
on('click', 'scan-pick-ok', (el) => {
  const i = pickLine, v = el.dataset.v;
  closeSheet();
  if (v === 'new') { createSheet(i); return; }
  const l = scan.lines[i];
  l.product_id = v === 'ignore' ? 'ignore' : v ? Number(v) : null;
  l.how = null;
  render();
});
on('click', 'scan-add', () => { scan.lines.push({ label: '', qty: 1, unit: null, promo: false, product_id: null, on: true }); render(); });

// Nom propose pour un produit a creer : libelle du ticket en casse normale.
const pretty = (s) => { const t = String(s).toLowerCase().trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function createSheet(i) {
  const l = scan.lines[i];
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ligne du ticket : « ${esc(l.label)} »</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(pretty(l.label))}">
    <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="category_id">${catOptions(categoryOrder()[0])}</select></label>
    <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit">${unitOptions('paquet')}</select></label></div>
    ${contField()}
    <p class="muted small">Créé à la validation du ticket.</p>
    <div class="row end"><button class="btn sec2" data-a="scan-create-cancel">Annuler</button><button class="btn" data-a="scan-create-ok" data-i="${i}">OK</button></div>`);
}
on('click', 'scan-create-cancel', () => { closeSheet(); render(); });
on('click', 'scan-create-ok', (el) => {
  const f = formData(document.querySelector('.sheet'));
  if (!f.name.trim()) return;
  const l = scan.lines[Number(el.dataset.i)];
  l.create = { name: f.name.trim(), category_id: Number(f.category_id), unit: f.unit, cont_n: f.cont_n, cont_u: f.cont_u };
  l.product_id = null;
  closeSheet();
  render();
});

on('click', 'scan-save', async () => {
  const lines = scan.lines.filter((l) => l.on).map((l) => ({
    label: l.label, qty: l.qty, unit_price: l.unit, promo: !!l.promo,
    ...(l.product_id === 'ignore' ? { ignore: true } : l.create ? { create: l.create } : { product_id: l.product_id }),
  }));
  const op = newOp({ type: 'receipt.save', store_id: scan.storeId, list_id: scan.listId, date: scan.date, raw_text: scan.text, lines });
  const r = await attempt(() => sync(S.me.householdId, [op]));
  if (r === undefined) return;
  const back = scan.listId ? `#/listes/${scan.listId}` : '#/listes';
  if (r === null) toast('Ticket gardé : envoyé au retour du réseau');
  else {
    const x = r.results[0];
    if (!x.ok) { toast(x.reason || 'Ticket refusé.', true); return; }
    const s = x.receipt;
    toast(`${s.records} prix mis à jour · ${s.checked} article${s.checked > 1 ? 's' : ''} coché${s.checked > 1 ? 's' : ''}${s.created ? ` · ${s.created} produit${s.created > 1 ? 's' : ''} créé${s.created > 1 ? 's' : ''}` : ''}`);
    S.products = null;
  }
  scan = null;
  go(back);
});
