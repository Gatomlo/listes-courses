// Installation de l'app (PWA) : invite du navigateur quand il en propose une (Android,
// Chrome / Edge sur PC), sinon la marche a suivre (iPhone : Safari > Partager).
import { esc, on, sheet, toast } from './ui.js';
import { render } from './state.js';

let deferred = null; // invite d'installation retenue par le navigateur
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; render(); });
window.addEventListener('appinstalled', () => { deferred = null; toast('App installée sur l’écran d’accueil'); render(); });

export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

// Carte « Installer l'app », rien si l'app tourne deja installee.
export const installCard = () => (isInstalled() ? '' : `<button class="card click row install" data-a="install">
  <img src="icon-192.png" alt="" width="40" height="40"><span class="grow"><b>Installer l’app</b>
  <span class="muted block">Icône sur l’écran d’accueil, plein écran, utilisable sans réseau en magasin</span></span></button>`);

const step = (n, html) => `<div class="row" style="align-items:flex-start;margin:8px 0"><span class="pill p-grey">${n}</span><span class="grow">${html}</span></div>`;

on('click', 'install', async () => {
  if (deferred) {
    const d = deferred;
    deferred = null;
    d.prompt();
    const r = await d.userChoice.catch(() => null);
    if (!r || r.outcome !== 'accepted') toast('Installation annulée : vous pourrez la relancer d’ici');
    render();
    return;
  }
  const safari = isIos() && !/crios|fxios|edgios/i.test(navigator.userAgent);
  const steps = isIos()
    ? (safari ? '' : step(0, `Ouvrez cette page dans <b>Safari</b> (sur iPhone, seul Safari sait installer une app web).`))
      + step(1, 'Touchez le bouton <b>Partager</b> <span class="muted">(carré avec une flèche vers le haut, en bas de l’écran)</span>.')
      + step(2, 'Faites défiler et choisissez <b>Sur l’écran d’accueil</b>.')
      + step(3, 'Touchez <b>Ajouter</b> : l’icône du Cabas apparaît avec vos autres apps.')
    : isAndroid()
      ? step(1, 'Ouvrez le menu <b>⋮</b> du navigateur <span class="muted">(en haut à droite dans Chrome)</span>.')
        + step(2, 'Choisissez <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.')
      : step(1, 'Dans Chrome ou Edge : cliquez sur l’icône d’installation <b>⊕</b> à droite de la barre d’adresse, ou menu <b>⋮</b> → <b>Installer Le Cabas</b>.')
        + step(2, 'Sur téléphone, ouvrez plutôt cette adresse dans le navigateur du téléphone :<br><code>' + esc(location.href.split('#')[0]) + '</code>');
  sheet(`<h3>📲 Installer l’app</h3>${steps}<p class="muted small">Ensuite, ouvrez Le Cabas depuis son icône : il s’affiche en plein écran et garde vos listes pour les magasins sans réseau.</p>`);
});
