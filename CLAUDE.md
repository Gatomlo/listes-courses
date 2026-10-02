# Le Cabas (listes-courses)

## Objectif
Outil privé du foyer : listes de courses partagées (« À prévoir » + listes datées), prix moyens par magasin (Intermarché, Colruyt), conseil de magasin et économie estimée du split, listes par magasin triées par rayon, menus qui alimentent les listes. Spécifications : `CAHIER_DES_CHARGES.md` (§11 = étapes). Maquette de référence (toutes les fonctions) : `maquette/index.html`, publiée sur https://claude.ai/artifact/PFxn57TQBfrCebd4mEvCtw (republier après modification ; servir avec `npx http-server maquette -p 5180`).

## État (au 2026-10-02)
- **Étape 1 (socle) codée** : connexion par lien e-mail, foyers, membres et invitations, rôles, réglages, magasins (couleur, actif), rayons et leur ordre par magasin, catalogue (fiche, relevés, prix moyens, magasin conseillé/imposé, fusion, suppression). Interface mobile + PC (barre latérale, accordéons, colonnes en maçonnerie).
- Écrans Listes / Menu / Plats : « bientôt ». Prochaine étape : 2 (listes, suggestions, clôture, récurrents).
- Décisions : nom « Le Cabas », seuil 5 €, prix comparés par emballage (contenance facultative), OCR Tesseract.js, pas de total ticket ni lien budget-foyer, pas de sous-domaine (`/cabas` sur le domaine de la passerelle). Point ouvert : coût fixe 2e magasin (défaut : non).

## Stack
Node ≥ 22.5, Express 4, `node:sqlite` (base unique `data/cabas.db`), nodemailer. Front : SPA en modules ES sans framework ni build (`public/app/`), navigation par `#/…`. Même socle que MyLittleLibraryV2 (s'en inspirer).

## Fichiers clés
- `server.js` : exporte `app` (listen seulement si lancé directement), page `index.html` avec `{{ROOT}}` → `<base href>`, API sur `/api`.
- `lib/db.js` : connexion, `tx`, `normalize`, migrations (`MIGRATIONS`, `PRAGMA user_version` ; ne jamais modifier une entrée déployée).
- `lib/auth.js` : lien de connexion (15 min, usage unique), sessions 90 j (cookie `cabas_session`, `Path=<montage>/`), gardes `householdMember` / `manager`.
- `lib/api.js` : toutes les routes ; `lib/households.js` (foyer, membres, invitations) ; `lib/catalog.js` (magasins, rayons, produits, relevés, prix moyens) ; `lib/mailer.js` ; `lib/security.js` (CSP, `jsonOnly`).
- `public/app/` : `main.js` (démarrage, routes, cadre), `ui.js` (esc, accordéons, panneau, toast, actions), `api.js`, `state.js`, un fichier par écran (`connexion.js`, `foyer.js`, `catalogue.js`).

## Règles non évidentes
- **CSP stricte** : aucun script ni `onclick` en ligne → boutons `data-a="action"` (+ `data-*`) traités par `on('click', 'action', fn)` ; champs `data-in` / `data-ch` / `data-enter`. Texte affiché : toujours `esc()`.
- Prix en **centimes** entiers. Prix moyen = N derniers relevés hors promo < 6 mois (`catalog.averages`, fenêtre SQL).
- Droits : toute route `/api/h/:hid/...` passe par `householdMember` ; gestion → `manager` sur la route. Les membres peuvent créer un produit et ajouter un relevé.
- Au moins un gestionnaire par foyer, au moins un magasin actif. Nouveau rayon = fin de parcours de tous les magasins.
- Membres = suggestions seulement (étape 2) ; une liste datée couvre les repas jusqu'à la veille de la suivante ; split conseillé si économie ≥ seuil.
- Accordéons : état en `localStorage`, séparé mobile/PC ; sur PC ouverts par défaut.

## Commandes
- `npm test` (API sur base temporaire, e-mails en mémoire).
- Essai local : `CABAS_DATA_DIR=<dossier temp> CABAS_MAIL=log PORT=3101 node server.js` → le lien de connexion s'affiche dans la console. Ne jamais essayer sur `data/`.
- Passerelle locale : jonction `node-gateway/apps/cabas` → ce dossier (créée), servie sur `http://localhost:3000/cabas/`.

## Déploiement (Infomaniak, via node-gateway)
Envoyer `server.js`, `package.json`, `package-lock.json`, `lib/`, `public/` dans `apps/cabas` (jamais `data/`), `npm install --omit=dev`, redémarrer. Variables : `CABAS_PUBLIC_URL` (ex. `https://<domaine>/cabas`, obligatoire pour des liens e-mail sûrs), `MAIL_FROM`, et `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (sinon sendmail). Migrations automatiques au démarrage.

## Méthode
Réponses en français, concises. Une étape du §11 à la fois ; après chaque modification `npm test` ; tester par l'API avant l'interface ; commit après chaque fonctionnalité validée.
