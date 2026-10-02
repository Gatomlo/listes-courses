// Appels a l'API (adresses relatives : la balise <base> pointe sur la racine de l'app,
// /cabas/ dans la passerelle).
import { toast } from './ui.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch('api/' + url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Pas de réseau.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Erreur.');
  return data;
}

export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b);
export const patch = (u, b) => api('PATCH', u, b);
export const put = (u, b) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);

// Execute une action et affiche l'erreur eventuelle ; renvoie undefined en cas d'echec.
export async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || 'Erreur.', true);
    return undefined;
  }
}
