// Etat partage de l'interface et rafraichissement de l'ecran.
import { get } from './api.js';

export const S = {
  me: null,        // compte connecte + ses foyers (GET /api/me)
  house: null,     // foyer courant : reglages, role, membres, magasins, rayons
  products: null,  // catalogue du foyer courant
  route: [],       // ex. ['catalogue', '12']
  q: {},           // recherches et filtres par ecran
};

export const hp = (u = '') => `h/${S.me.householdId}${u}`;
export const isManager = () => S.house && S.house.role === 'manager';
export const activeStores = () => S.house.stores.filter((s) => s.active);
export const storeById = (id) => S.house.stores.find((s) => s.id === id);
export const catName = (id) => (S.house.categories.find((c) => c.id === id) || {}).name || '—';

export async function loadHouse() {
  S.house = S.me.householdId ? await get(hp()) : null;
}
export async function loadProducts() {
  S.products = await get(hp('/products'));
}

let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export const render = () => renderer();

export function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}
