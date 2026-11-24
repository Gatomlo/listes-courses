'use strict';
// IA facultative (Google Gemini) : une cle et un modele pour toute l'installation
// (table ai_settings, reglages geres par les gestionnaires ; variable GEMINI_API_KEY en secours).
// Chaque fonction a un repli cote application : sans cle ou en cas d'erreur, l'existant sert.
// Seuls des noms de produits, de plats et des libelles de ticket partent vers Google.
const { db } = require('./db');
const { httpError, str, limiter } = require('./util');
const { parseIngredient } = require('./recipes');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT = 40000;

const row = () => db.prepare('SELECT api_key, model FROM ai_settings WHERE id = 1').get() || {};
const apiKey = () => row().api_key || process.env.GEMINI_API_KEY || '';
const enabled = () => !!apiKey();
const model = () => row().model || DEFAULT_MODEL;
const hint = (k) => (k ? (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••') : null);

// Etat pour l'ecran de reglages : la cle n'est jamais renvoyee, seulement un apercu.
function config() {
  const k = apiKey();
  return { configured: !!k, key_hint: hint(k), source: row().api_key ? 'base' : k ? 'env' : null, model: model(), default_model: DEFAULT_MODEL };
}

// Appel REST ; la cle va dans l'en-tete (jamais dans l'adresse, ni dans les messages d'erreur).
async function call(path, { key = apiKey(), body } = {}) {
  if (!key) throw httpError(409, 'IA non configurée : ajoutez une clé Gemini dans le Foyer.');
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'x-goog-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw httpError(502, e.name === 'TimeoutError' ? 'Gemini ne répond pas (délai dépassé).' : 'Gemini injoignable.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String((data.error && data.error.message) || '').slice(0, 200);
    if (r.status === 400 && /api key/i.test(msg)) throw httpError(400, 'Clé refusée par Google : vérifiez-la.');
    if (r.status === 401 || r.status === 403) throw httpError(400, 'Clé refusée ou sans droit sur Gemini.');
    if (r.status === 429) throw httpError(429, 'Quota Gemini atteint : réessayez plus tard.');
    throw httpError(502, `Gemini : ${msg || r.status}`);
  }
  return data;
}

// Modeles qui savent produire du texte (generateContent), du plus recent au plus ancien.
async function models(key) {
  const out = [];
  let token = '';
  for (let i = 0; i < 5; i++) {
    const d = await call(`/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { key });
    for (const m of d.models || []) {
      if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
      const id = String(m.name || '').replace(/^models\//, '');
      if (!/^gemini/i.test(id) || /(embedding|aqa|tts|image|live|audio|robotics|computer-use)/i.test(id)) continue;
      out.push({ id, label: m.displayName || id, description: str(m.description, 160) });
    }
    if (!d.nextPageToken) break;
    token = d.nextPageToken;
  }
  return out.sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
}

// Enregistre la cle (verifiee par une liste de modeles) et/ou le modele ; renvoie la config + les modeles.
async function save({ api_key, model: m } = {}) {
  const cur = row();
  let key = cur.api_key || '';
  let list = null;
  if (api_key !== undefined && api_key !== null && String(api_key).trim() !== '') {
    key = str(api_key, 200);
    if (/\s/.test(key)) throw httpError(400, 'Clé invalide.');
    list = await models(key); // refuse une cle fausse avant de l'enregistrer
  }
  const chosen = m === undefined ? cur.model || null : (str(m, 100) || null);
  db.prepare('INSERT INTO ai_settings (id, api_key, model) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key, model = excluded.model').run(key || null, chosen);
  return { ...config(), models: list || (enabled() ? await models(apiKey()).catch(() => []) : []) };
}

function removeKey() {
  db.prepare('UPDATE ai_settings SET api_key = NULL WHERE id = 1').run();
  return config();
}

// Plafond par foyer (cout et abus) : 80 appels par heure.
const hits = limiter(3600 * 1000);
async function generate(hid, system, prompt, schema) {
  if (hits.count(hid) >= 80) throw httpError(429, 'Trop de demandes à l’IA cette heure-ci : réessayez plus tard.');
  hits.hit(hid);
  const d = await call(`/models/${encodeURIComponent(model())}:generateContent`, {
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.4 },
    },
  });
  const text = ((((d.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
  let out = null;
  try { out = JSON.parse(text); } catch { /* illisible */ }
  if (!out || typeof out !== 'object') throw httpError(502, 'Réponse de l’IA illisible : réessayez.');
  return out;
}

const SYS = 'Tu aides un foyer belge francophone à organiser ses courses et ses repas. Réponds uniquement en JSON conforme au schéma, en français, avec des unités métriques.';
const productNames = (hid) => db.prepare('SELECT id, name FROM products WHERE household_id = ? AND deleted_at IS NULL ORDER BY name').all(hid);

// ---------- Recette : meme forme que l'import d'une recette (ingredients lus comme par parseIngredient) ----------
const UNITS = { g: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'l', pc: '', cs: 'c. à s.', cc: 'c. à c.', emb: 'boîte' };
const RECIPE = {
  type: 'OBJECT', required: ['name', 'portions', 'steps', 'ingredients'],
  properties: {
    name: { type: 'STRING' }, portions: { type: 'INTEGER' }, time: { type: 'STRING', description: 'ex. « 45 min »' },
    steps: { type: 'ARRAY', items: { type: 'STRING' } },
    ingredients: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name'], properties: {
      name: { type: 'STRING', description: 'nom du produit au singulier, sans quantité' },
      quantity: { type: 'NUMBER' }, unit: { type: 'STRING', enum: Object.keys(UNITS) },
      note: { type: 'STRING' }, base: { type: 'BOOLEAN', description: 'produit de base du placard (sel, huile, épices…)' } } } },
  },
};
function shapeRecipe(r, fallbackName) {
  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 40).map((g) => {
    const name = str(g.name, 80);
    if (!name) return null;
    const q = Number(g.quantity);
    const u = UNITS[g.unit] !== undefined ? UNITS[g.unit] : '';
    const raw = Number.isFinite(q) && q > 0 ? `${q} ${u ? u + ' ' : ''}${name}` : name;
    const p = parseIngredient(raw);
    return { ...p, raw, name, base: !!g.base || p.base };
  }).filter(Boolean);
  return {
    name: str(r.name, 120) || fallbackName || null, portions: Number(r.portions) > 0 ? Math.min(Number(r.portions), 50) : null,
    time: str(r.time, 40) || null, steps: (Array.isArray(r.steps) ? r.steps : []).map((s) => str(s, 400)).filter(Boolean).slice(0, 30),
    image: null, ingredients, source: 'ai',
  };
}
const known = (hid) => productNames(hid).slice(0, 300).map((p) => p.name).join(', ');

async function suggestRecipe(hid, { name, portions }) {
  const n = str(name, 120);
  if (!n) throw httpError(400, 'Donnez d’abord un nom au plat.');
  const p = Math.min(Math.max(parseInt(portions, 10) || 4, 1), 20);
  const r = await generate(hid, SYS,
    `Propose une recette classique et réalisable pour le plat « ${n} », pour ${p} personnes. Ingrédients avec quantités (g, ml, pièces…) et étapes courtes.\n` +
    `Quand un produit de la liste suivante convient, reprends exactement son nom : ${known(hid)}`, RECIPE);
  return shapeRecipe(r, n);
}

async function dishFromProducts(hid, { names, portions }) {
  const list = (Array.isArray(names) ? names : []).map((s) => str(s, 80)).filter(Boolean).slice(0, 30);
  if (!list.length) throw httpError(400, 'Choisissez au moins un produit.');
  const p = Math.min(Math.max(parseInt(portions, 10) || 4, 1), 20);
  const r = await generate(hid, SYS,
    `Invente un plat simple pour ${p} personnes qui utilise ces produits (pas forcément tous, mais l'essentiel) : ${list.join(', ')}. ` +
    `Tu peux ajouter quelques ingrédients courants. Donne un nom de plat, les ingrédients avec quantités et les étapes.\n` +
    `Quand un produit de la liste suivante convient, reprends exactement son nom : ${known(hid)}`, RECIPE);
  return shapeRecipe(r);
}

// ---------- Rapprochement de libelles de ticket avec les produits ----------
async function matchLabels(hid, labels) {
  const ls = (Array.isArray(labels) ? labels : []).map((s) => str(s, 80)).filter(Boolean).slice(0, 40);
  if (!ls.length) return [];
  const prods = productNames(hid).slice(0, 500), ids = new Set(prods.map((p) => p.id));
  const r = await generate(hid, SYS,
    `Libellés abrégés d'un ticket de caisse (numérotés) :\n${ls.map((l, i) => `${i}: ${l}`).join('\n')}\n\n` +
    `Produits connus (id: nom) :\n${prods.map((p) => `${p.id}: ${p.name}`).join('\n')}\n\n` +
    'Pour chaque libellé, donne l\'id du produit correspondant, ou null si aucun ne correspond clairement. Ne devine pas.',
    { type: 'OBJECT', required: ['matches'], properties: { matches: { type: 'ARRAY', items: { type: 'OBJECT', required: ['i'], properties: { i: { type: 'INTEGER' }, product_id: { type: 'INTEGER', nullable: true } } } } } });
  const out = ls.map(() => null);
  for (const m of r.matches || []) if (Number.isInteger(m.i) && m.i >= 0 && m.i < ls.length && ids.has(m.product_id)) out[m.i] = m.product_id;
  return out;
}

// ---------- Ajout multiple en langage libre ----------
async function parseItems(hid, text) {
  const t = str(text, 600);
  if (!t) return [];
  const r = await generate(hid, SYS,
    `Phrase dictée ou saisie pour une liste de courses : « ${t} »\n` +
    `Découpe-la en articles (nom au singulier, quantité entière ≥ 1). Quand un produit de la liste suivante convient, reprends exactement son nom : ${known(hid)}`,
    { type: 'OBJECT', required: ['items'], properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name'], properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER' } } } } } });
  return (r.items || []).slice(0, 30).map((i) => ({ name: str(i.name, 80), qty: Number(i.qty) > 0 ? Math.min(Number(i.qty), 99) : 1 })).filter((i) => i.name);
}

module.exports = { enabled, config, models, save, removeKey, suggestRecipe, dishFromProducts, matchLabels, parseItems, shapeRecipe };
