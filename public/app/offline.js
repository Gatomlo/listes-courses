// Prechargement pour le hors-ligne : chaque lecture est gardee sur l'appareil (api.js
// `get`), mais seulement si l'ecran a deja ete ouvert avec du reseau. Au demarrage et au
// retour du reseau, on lit en arriere-plan les ecrans utiles en magasin (listes, produits,
// menu, plats, promos…) pour qu'ils s'ouvrent aussi sans reseau.
import { get, net } from './api.js';
import { localDay } from './ui.js';

const KEY = 'cabas-warm';
let running = false;
const read = (k) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };

// Lectures en parallele, 4 a la fois, erreurs ignorees.
async function pool(urls, size = 4) {
  const queue = [...urls];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length && net.online) await get(queue.shift()).catch(() => {});
  }));
}

export async function warm(hid, { force = false } = {}) {
  if (running || !net.online || !hid) return;
  if (!force && Date.now() - read(KEY) < 20 * 60 * 1000) return;
  running = true;
  const h = `h/${hid}`;
  try {
    const [lists, dishes, menu] = await Promise.all([get(`${h}/lists`), get(`${h}/dishes`), get(`${h}/menu?at=${localDay()}`)]);
    const urls = [`${h}`, `${h}/products`, `${h}/promos`, `${h}/suggestions`, `${h}/aliases`, `${h}/wishes`,
      `${h}/menu?from=${localDay()}&days=2`, `${h}/menu?from=${localDay()}&days=7`];
    // Menu : periode affichee, precedente et suivante.
    if (menu && menu.period) {
      const day = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
      urls.push(`${h}/menu?at=${day(menu.period.end, 1)}`, `${h}/menu?at=${day(menu.period.start, -1)}`);
    }
    for (const l of [lists.backlog, ...lists.upcoming, ...lists.closed.slice(0, 3)]) if (l) urls.push(`${h}/lists/${l.id}`);
    // Fiches des plats : ceux du menu affiche d'abord, puis tous.
    const ids = [...new Set([...(menu ? menu.meals.map((m) => m.dish_id) : []), ...dishes.map((d) => d.id)])];
    for (const id of ids) urls.push(`${h}/dishes/${id}`);
    await pool(urls);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  } catch { /* hors-ligne ou erreur : sans importance */ } finally {
    running = false;
  }
}
