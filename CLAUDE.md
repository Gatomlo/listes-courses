# Le Cabas (listes-courses)

## Objectif
Outil privé du foyer : listes de courses partagées (« À prévoir » + listes datées), prix moyens par magasin (Intermarché, Colruyt), conseil de magasin et économie estimée du split, listes par magasin triées par rayon, menus qui alimentent les listes. Spécifications : `CAHIER_DES_CHARGES.md` (§11 = étapes). Maquette de référence (toutes les fonctions) : `maquette/index.html`, publiée sur https://claude.ai/artifact/PFxn57TQBfrCebd4mEvCtw (republier après modification ; servir avec `npx http-server maquette -p 5180`).

## État (au 2026-10-02)
- **Étape 1 (socle) codée** : connexion par lien e-mail, foyers, membres et invitations, rôles, réglages, magasins (couleur, actif), rayons et leur ordre par magasin, catalogue (fiche, relevés, prix moyens, magasin conseillé/imposé, fusion, suppression). Interface mobile + PC (barre latérale, accordéons, colonnes en maçonnerie).
- **Étape 2 (listes) codée** : « À prévoir » (créée à la demande), listes datées (une par date, date proposée = dernière + rythme), import des récurrents dus et d'articles « À prévoir », ajout avec recherche/création de produit, quantités cumulées, coche « acheté », fiche article (quantité, note, indisponible, déplacer, récurrent, retirer), suggestions des membres (validation dans la liste ou Foyer, badge), menu ⋯ (date, statut, clôture avec report par article, suppression), historique en lecture seule + copie vers « À prévoir ».
- **Étape 3 (prix) codée** : prix effectif par article et magasin (promo valable sinon moyenne), magasin conseillé (imposé > moins cher), choix manuel par article (étiquette cliquable, tout membre ; retour au conseil), « tout chez X » (gestionnaire), scénarios + économie vs seuil, liste par magasin (`#/listes/:id/magasin/:sid`, ordre des rayons du magasin), promos (sortie ou date, prix facultatif, une par produit × magasin, tout membre). Suggestions en attente : accordéon en haut de l'écran Listes + badge onglet Listes.
- **Étape 4 (mode courses, temps réel, hors-ligne) codée** : mode courses `#/listes/:id/magasin/:sid` (rayons du magasin, gros texte, « Dans le caddie », prix payé facultatif au cochage → relevé `check`, « Terminer » : non pris → indisponibles), présence (« Léa est aussi sur cette liste ») et rechargement en direct par SSE, hors-ligne (copie locale de chaque lecture, file d'opérations rejouée au retour du réseau, bandeau), service worker `public/sw.js`.
- Écrans Menu / Plats : « bientôt ». Prochaine étape : 5 (scan du ticket, Tesseract.js).
- Décisions : nom « Le Cabas », seuil 5 €, prix comparés par emballage (contenance facultative), OCR Tesseract.js, pas de total ticket ni lien budget-foyer, pas de sous-domaine (`/cabas` sur le domaine de la passerelle). Point ouvert : coût fixe 2e magasin (défaut : non).

## Stack
Node ≥ 22.5, Express 4, `node:sqlite` (base unique `data/cabas.db`), nodemailer. Front : SPA en modules ES sans framework ni build (`public/app/`), navigation par `#/…`. Même socle que MyLittleLibraryV2 (s'en inspirer).

## Fichiers clés
- `server.js` : exporte `app` (listen seulement si lancé directement), page `index.html` avec `{{ROOT}}` → `<base href>`, API sur `/api`.
- `lib/db.js` : connexion, `tx`, `normalize`, migrations (`MIGRATIONS`, `PRAGMA user_version` ; ne jamais modifier une entrée déployée).
- `lib/auth.js` : lien de connexion (15 min, usage unique), sessions 90 j (cookie `cabas_session`, `Path=<montage>/`), gardes `householdMember` / `manager`.
- `lib/api.js` : toutes les routes ; `lib/households.js` (foyer, membres, invitations) ; `lib/catalog.js` (magasins, rayons, produits, relevés, prix moyens) ; `lib/lists.js` (listes, articles, suggestions, clôture, récurrents, promos) ; `lib/pricing.js` (prix effectifs, magasin retenu, scénarios) ; `lib/sync.js` (rejeu d'opérations, conflits) ; `lib/events.js` (SSE, présence, diffusion après chaque modification) ; `lib/mailer.js` ; `lib/security.js` (CSP, `jsonOnly`).
- `public/app/` : `main.js` (démarrage, routes, cadre), `ui.js` (esc, accordéons, panneau, toast, actions), `api.js`, `state.js`, un fichier par écran (`connexion.js`, `foyer.js`, `catalogue.js`, `listes.js`).

## Règles non évidentes
- **CSP stricte** : aucun script ni `onclick` en ligne → boutons `data-a="action"` (+ `data-*`) traités par `on('click', 'action', fn)` ; champs `data-in` / `data-ch` / `data-enter`. Texte affiché : toujours `esc()`.
- Prix en **centimes** entiers. Prix moyen = N derniers relevés hors promo < 6 mois (`catalog.averages`, fenêtre SQL).
- Droits : toute route `/api/h/:hid/...` passe par `householdMember` ; gestion → `manager` sur la route. Les membres peuvent créer un produit et ajouter un relevé.
- Au moins un gestionnaire par foyer, au moins un magasin actif. Nouveau rayon = fin de parcours de tous les magasins.
- Listes : un article par produit et par liste (ajout = quantités cumulées) ; membre : ajoute en suggestion, coche, modifie quantité/note ; gestionnaire : le reste. Récurrence n = absent des n−1 listes datées précédentes. Clôture : non achetés → liste suivante (défaut) / À prévoir / abandon (`carried_to`), suggestions en attente abandonnées. Suppression d'un produit : retiré des listes en cours, relevés supprimés ; s'il figure dans une liste clôturée il est seulement marqué `deleted_at` (exclu partout, affiché barré dans l'historique, nom de nouveau libre).
- une liste datée couvre les repas jusqu'à la veille de la suivante ; split conseillé si économie ≥ seuil.
- Magasin retenu d'un article = `store_id` manuel s'il est actif, sinon conseil, sinon 1er magasin actif. Scénarios : prix inconnu dans un magasin → meilleur prix connu ailleurs, compté « non estimé » ; hors suggestions, indisponibles, supprimés. Split conseillé si ≥ 2 magasins utilisés et économie ≥ seuil.
- Hors-ligne : seules les actions du mode courses passent par des **opérations** (`item.update`, `item.add`, `record.add`, avec `op_id` unique → `applied_ops`) ; le reste exige le réseau (`attempt` affiche « Pas de réseau »). Conflits : « acheté » l'emporte, sinon la plus récente (`at` de l'appareil vs `updated_at`). Lectures : `get()` garde une copie `localStorage` (`cabas-get:<url>`), effacée à la déconnexion. `sw.js` : changer `VERSION` et `FILES` quand les fichiers de l'interface changent (non vérifié dans le navigateur intégré, qui refuse l'enregistrement).
- Accordéons : état en `localStorage`, séparé mobile/PC ; sur PC ouverts par défaut.

## Commandes
- `npm test` (API sur base temporaire, e-mails en mémoire ; `tests/helpers.js` : clients, foyer gestionnaire + membre).
- Essai local : `CABAS_DATA_DIR=<dossier temp> CABAS_MAIL=log PORT=3101 node server.js` → le lien de connexion s'affiche dans la console. Ne jamais essayer sur `data/`.
- Passerelle locale : jonction `node-gateway/apps/cabas` → ce dossier (créée), servie sur `http://localhost:3000/cabas/`.

## Déploiement (Infomaniak, via node-gateway)
Envoyer `server.js`, `package.json`, `package-lock.json`, `lib/`, `public/` dans `apps/cabas` (jamais `data/`), `npm install --omit=dev`, redémarrer. Variables : `CABAS_PUBLIC_URL` (ex. `https://<domaine>/cabas`, obligatoire pour des liens e-mail sûrs), `MAIL_FROM`, et `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (sinon sendmail). Migrations automatiques au démarrage.

## Méthode
Réponses en français, concises. Une étape du §11 à la fois ; après chaque modification `npm test` ; tester par l'API avant l'interface ; commit après chaque fonctionnalité validée.
