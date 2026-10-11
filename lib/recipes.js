// Import d'une recette depuis un lien : la page est chargee par le serveur (pas de
// restriction CORS) et ses donnees structurees schema.org/Recipe (blocs JSON-LD, publies
// par la plupart des sites de recettes) sont lues : nom, portions, temps, ingredients,
// etapes. Garde-fous : http(s) seulement, adresses internes refusees (a chaque
// redirection), 8 s, 2 Mo, resultat garde 24 h.
const dns = require('dns').promises;
const net = require('net');
const { httpError } = require('./util');
const { normalizeAmount } = require('./units');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT = 8000;
const cache = new Map();

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw httpError(400, 'Lien invalide.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw httpError(400, 'Lien invalide (http ou https).');
  if (process.env.CABAS_ALLOW_PRIVATE_FETCH !== '1') { // tests uniquement
    const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length) throw httpError(400, 'Site introuvable.');
    if (addrs.some((a) => privateIp(a.address))) throw httpError(400, 'Adresse non autorisée.');
  }
  return u;
}

async function fetchPage(raw) {
  return (await fetchBytes(raw, 'text/html', MAX_BYTES)).buf.toString('utf8');
}

// Telechargement protege (adresses privees refusees a chaque redirection), taille bornee.
async function fetchBytes(raw, accept, max) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await checkUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let res;
    try {
      res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Le Cabas, import de recette)', accept } });
    } catch {
      clearTimeout(timer);
      throw httpError(502, 'Page inaccessible.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), u).href;
      continue;
    }
    if (!res.ok) { clearTimeout(timer); throw httpError(502, `Page inaccessible (${res.status}).`); }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) { ctrl.abort(); break; }
        chunks.push(value);
      }
    } finally { clearTimeout(timer); }
    return { buf: Buffer.concat(chunks), type: String(res.headers.get('content-type') || ''), truncated: size > max };
  }
  throw httpError(502, 'Trop de redirections.');
}

// ---------- Lecture des donnees structurees ----------
// Entites HTML (decimales, hexadecimales, nommees courantes), parfois encodees deux fois (&amp;#x27;).
const NAMED = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', oelig: 'œ', OElig: 'Œ', aelig: 'æ', ccedil: 'ç', Ccedil: 'Ç', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', agrave: 'à', acirc: 'â', auml: 'ä', Agrave: 'À', icirc: 'î', iuml: 'ï', ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü' };
const entities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
  if (e[0] !== '#') return NAMED[e] ?? m;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});
const decode = (s) => entities(entities(String(s || ''))).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return findRecipe(node['@graph']) || findRecipe(node.mainEntity) || null;
}

// « PT1H15M » -> « 1 h 15 »
function duration(iso) {
  const m = String(iso || '').match(/P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m || (!m[1] && !m[2])) return null;
  const h = Number(m[1] || 0), min = Number(m[2] || 0);
  return h ? `${h} h${min ? ' ' + String(min).padStart(2, '0') : ''}` : `${min} min`;
}

function steps(instr) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === 'string') { decode(x).split(/\n+/).forEach((s) => s.trim() && out.push(s.trim())); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.itemListElement) walk(x.itemListElement);
    else if (x.text) out.push(decode(x.text));
    else if (x.name) out.push(decode(x.name));
  };
  walk(instr);
  return out.filter(Boolean).slice(0, 40);
}

// Photo de la recette : chaine, liste ou objet ImageObject.
function imageUrl(x) {
  if (!x) return null;
  if (typeof x === 'string') return /^https?:\/\//i.test(x) ? x : null;
  if (Array.isArray(x)) { for (const y of x) { const u = imageUrl(y); if (u) return u; } return null; }
  return imageUrl(x.url || x.contentUrl || null);
}
// Image d'une recette importee (jpeg, png, webp ; 5 Mo au plus).
async function fetchImage(url) {
  const r = await fetchBytes(url, 'image/*', 5 * 1024 * 1024);
  const t = r.type.split(';')[0].trim().toLowerCase();
  if (r.truncated || !['image/jpeg', 'image/png', 'image/webp'].includes(t)) throw httpError(422, 'Photo de la recette illisible.');
  return { buf: r.buf, type: t };
}

function parseRecipeHtml(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b.trim()); } catch { continue; }
    const r = findRecipe(data);
    if (!r) continue;
    const yieldRaw = Array.isArray(r.recipeYield) ? r.recipeYield.join(' ') : r.recipeYield;
    const portions = parseInt(String(yieldRaw || '').match(/\d+/), 10) || null;
    return {
      name: decode(r.name) || null,
      portions,
      time: duration(r.totalTime) || duration(r.cookTime) || duration(r.prepTime),
      steps: steps(r.recipeInstructions),
      image: imageUrl(r.image),
      ingredients: (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : []).map(decode).filter(Boolean).slice(0, 60).map(parseIngredient),
    };
  }
  return null;
}

// ---------- Lignes d'ingredients ----------
// « 1,2 kg de pommes de terre » -> { qty: 1.2, unit: 'kg', name: 'pommes de terre' }
const UNIT = /^(kg|g|gr|grammes?|mg|l|litres?|cl|ml|dl|c\.? ?à ?s\.?|c\.? ?à ?c\.?|cuill[eè]res? (?:à|a) (?:soupe|café|cafe)|cuill[eè]res?|pincées?|gousses?|tranches?|boîtes?|boites?|sachets?|briques?|bottes?|feuilles?|brins?|pots?|paquets?|verres?|tasses?|filets?|morceaux?)\b\.?/i;
const BASE = /\b(sel|poivre|huile|vinaigre|épices?|epices?|curry|paprika|cumin|muscade|herbes|thym|laurier|origan|cannelle|sucre|farine|levure|bouillon|moutarde)\b/i;
const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.33, '⅔': 0.67 };

// Cuilleres : « c. à café », « C à soupe », « càs », « cs », « c.à.c. », « cuillère(s) à soupe »,
// « cuil. à café »… -> cs (15 ml) ou cc (5 ml).
const SPOON = /^(?:cuill?[eè]?r?(?:e|ée)?s?\.?|c\.?)\s?(?:à|a)?\.?\s?(soupe|s|caf[eé]|c)(?=[\s.,]|$)\.?/i;

function parseIngredient(raw) {
  let s = raw.replace(/[½¼¾⅓⅔]/g, (c) => ` ${FRAC[c]}`).replace(/\s+/g, ' ').trim();
  let qty = null;
  const m = s.match(/^(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+))?(?:\s*(?:à|-)\s*\d+(?:[.,]\d+)?)?\s*/);
  if (m) {
    qty = m[2] ? Number(m[1].replace(',', '.')) / Number(m[2]) : Number(m[1].replace(',', '.'));
    s = s.slice(m[0].length);
  }
  let unit = null, spoon = null;
  const sp = s.match(SPOON), u = !sp && s.match(UNIT);
  if (sp) { spoon = /^s/i.test(sp[1]) ? 'cs' : 'cc'; unit = sp[0].trim(); s = s.slice(sp[0].length).trim(); }
  else if (u) { unit = u[1].toLowerCase(); s = s.slice(u[0].length).trim(); }
  s = s.replace(/^(de |d'|d’|des |du )/i, '').replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim();
  const name = s || raw;
  // Quantite pour le plat : g / ml / pieces (convertis en emballages dans les listes) ;
  // boite, sachet... = emballages ; gousse, pincee... sans equivalent = 1 emballage.
  const q = qty != null ? Math.round(qty * 100) / 100 : null;
  const pack = /^(bo[iî]tes?|sachets?|briques?|pots?|paquets?|bottes?)$/i.test(unit || '');
  const a = q == null ? null : spoon ? { qty: q, unit: spoon } : !unit ? { qty: q, unit: 'pc' } : pack ? { qty: q, unit: null } : normalizeAmount(q, unit);
  return {
    raw, name, unit, qty: q,
    amount: a ? a.qty : null, amount_unit: a ? a.unit : null,
    base: BASE.test(raw) && !/\d+\s*(g|kg)\b/i.test(raw.split(',')[0]) ? true : /^(sel|poivre)\b/i.test(name),
  };
}

async function importRecipe(url) {
  const hit = cache.get(url);
  if (hit && hit.at > Date.now() - 24 * 3600 * 1000) return hit.data;
  const html = await fetchPage(url);
  const data = parseRecipeHtml(html);
  if (!data) throw httpError(422, 'Pas de recette lisible sur cette page : le lien est gardé, renseignez la recette à la main.');
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return data;
}

module.exports = { importRecipe, parseRecipeHtml, parseIngredient, privateIp, fetchImage };
