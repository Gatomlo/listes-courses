# Le Cabas — Cahier des charges (v0.1)

> Nom : **Le Cabas**. Outil privé du foyer pour préparer les courses, choisir le bon magasin selon les prix et planifier les repas.
> Maquette cliquable : `maquette/index.html` (publiée : https://claude.ai/artifact/PFxn57TQBfrCebd4mEvCtw).

## 1. Objectif

- Tenir des **listes de courses partagées** dans le foyer, préparées à l'avance (rythme habituel ~15 jours, variable).
- Connaître le **prix moyen** de chaque produit dans chaque magasin (Intermarché, Colruyt…) à partir des achats réels.
- **Conseiller** le magasin le moins cher par article et montrer si **faire deux magasins vaut la peine** (économie estimée vs un seul magasin), en laissant toujours le choix final libre.
- Sortir une **liste par magasin**, triée dans l'ordre des rayons de ce magasin.
- Planifier un **menu** (plats datés) qui alimente automatiquement la liste avec ses ingrédients.

## 2. Interface

- **Accordéons partout** pour la lisibilité : chaque écran est découpé en sections repliables, avec un en-tête qui résume le contenu (nombre d'éléments, valeur clé). Ouverts par défaut : ce qui sert tout de suite (rayons d'une liste et du mode courses, prix d'un produit, informations et ingrédients d'un plat) ; repliés : le reste (historiques, caddie, relevés, réglages). État mémorisé par appareil.
- Les fenêtres ponctuelles (ajout, confirmation) restent des panneaux glissants depuis le bas.
- **Deux affichages**, choisis automatiquement selon la largeur d'écran (une seule application responsive, mêmes données et mêmes droits) :
  - **Mobile** (< 900 px) : navigation par onglets en bas, un écran = une colonne, onglets Articles / Repas / Magasins dans une liste ; usage en magasin.
  - **PC** (≥ 900 px) : navigation dans une **barre latérale** à gauche (logo, foyer courant, onglets, badge des suggestions) ; contenu sur toute la largeur :
    - écran Listes : panneaux (Prochaines courses, Historique) sur toute la largeur ;
    - liste : articles à gauche, et à droite l'économie, les scénarios, les listes par magasin et les repas (plus d'onglets) ;
    - menu : **grille semaine** (jours en colonnes × créneaux en lignes), 2 semaines visibles ;
    - plats : cartes sur 3 colonnes, même placement sans trou ;
    - fiche plat et Foyer : panneaux les uns sous les autres, en pleine largeur ;
    - catalogue, fiche produit, historique : accordéons répartis sur 2 colonnes en « maçonnerie » (chaque panneau se place sous le précédent de sa colonne, sans trou) ;
    - fenêtres ponctuelles en boîte de dialogue centrée ; messages en bas à droite.
  - Le mode courses reste pensé pour le téléphone (il s'affiche aussi sur PC).
  - Sur PC, **tous les accordéons sont ouverts par défaut** (on peut toujours les replier) ; l'état ouvert/replié est mémorisé séparément pour le mobile et le PC.

## 2 bis. Foyer et rôles

- Un **foyer** regroupe des comptes. Un compte peut appartenir à plusieurs foyers (sélecteur en en-tête).
- **Gestionnaire** : crée/clôture les listes, ajoute directement articles et plats, valide les suggestions, gère catalogue, magasins et paramètres. Plusieurs gestionnaires possibles par foyer.
- **Membre** : consulte tout, coche en magasin, saisit des prix, et **suggère** des articles ou des plats. Une suggestion reste « en attente » (visible, grisée) jusqu'à acceptation ou refus par un gestionnaire.
- Invitation par lien/e-mail émis par un gestionnaire.
- Les **suggestions en attente** s'affichent dans un accordéon en haut de l'écran **Listes** (badge sur l'onglet Listes pour les gestionnaires), avec Accepter / Refuser.
- **Gestion des membres** (gestionnaire) : modifier le nom affiché et l'e-mail, **changer le profil** Membre ↔ Gestionnaire, **retirer du foyer** (le compte n'est pas supprimé ; ses suggestions en attente sont refusées ; son nom reste dans l'historique). Le foyer garde toujours au moins un gestionnaire : le dernier ne peut être ni rétrogradé ni retiré.
- Écran **Foyer** organisé en **accordéons** (en-tête avec résumé : nombre, valeurs clés) : Membres, Réglages, puis un accordéon par magasin (ordre des rayons). Bouton « Tout ouvrir / Tout replier » ; état mémorisé par appareil.
- **Accès** :
  - **Connexion** par lien magique : saisie de l'e-mail, lien valable 15 min et à usage unique, session de 90 jours sur l'appareil ; déconnexion depuis « Mes foyers ».
  - **Invitation** (gestionnaire) : par e-mail ou lien copiable, avec le profil proposé (membre ou gestionnaire), valable 7 jours ; l'invité voit qui l'invite, dans quel foyer et avec quel rôle, puis rejoint ou refuse.
  - **Mes foyers** : sélecteur en haut de l'écran Listes, créer un foyer (on en devient gestionnaire). Catalogue, magasins, listes et plats sont propres à chaque foyer.

## 3. Catalogue commun du foyer

Base unique de produits partagée par le foyer, réutilisée par les listes et les recettes.

| Champ | Exemple | Rôle |
|---|---|---|
| Nom | Lait demi-écrémé | Autocomplétion |
| Catégorie | Frais | Tri par rayon |
| Emballage | bouteille, paquet, barquette… | **Format par défaut** : les prix se comparent par emballage |
| Contenance (facultatif) | 1 L, 500 g, x12 | Sert seulement si l'emballage diffère d'un magasin à l'autre (comparaison au kg/L) |
| Récurrent | chaque liste / toutes les 2 listes / non | Ajout automatique |
| Ingrédient de base | oui (sel, huile, épices) | Proposé « à vérifier », jamais ajouté d'office |
| Magasin préféré forcé | — | Outrepasse le conseil prix (qualité, habitude) |

- Ajout à la volée depuis une liste (« Créer “xxx” dans le catalogue »).
- Écran **Catalogue** : recherche, filtres (Tous, Récurrents, De base, Prix manquant), magasin conseillé par produit, bouton « ＋ Produit ».
- **Fiche produit** éditable (gestionnaire) : nom, rayon, emballage, contenance, récurrence (non / chaque liste / toutes les 2 ou 3 listes), ingrédient de base, magasin imposé ; prix moyens par magasin ; derniers relevés ; **ajout d'un relevé** manuel (magasin, prix, date, promo).
- **Fusion de doublons** : relevés, articles de listes, ingrédients de plats et promos transférés vers le produit gardé.
- **Suppression** : retiré des listes non clôturées et des plats (avec confirmation listant les usages) ; l'historique garde le nom.

## 4. Magasins et prix

### 4.1 Magasins
- Liste libre (au départ : **Intermarché**, **Colruyt**). Ajout et modification par le gestionnaire (écran Foyer) : nom, **couleur** (étiquettes et graphiques), **actif/inactif**. Un magasin inactif disparaît des conseils, scénarios et listes (ses prix sont conservés, les articles qui y étaient affectés reviennent au conseil). Un nouveau magasin démarre sans prix et avec l'ordre des rayons par défaut. Au moins un magasin actif.
- **Rayons** = catégories du catalogue, communs au foyer. Dans l'accordéon de chaque magasin (écran Foyer), le gestionnaire peut :
  - **réordonner** les rayons selon le parcours du magasin (↑ ↓, glisser-déposer dans l'app) : l'ordre est propre à chaque magasin ;
  - **ajouter** un rayon (placé en fin de parcours dans tous les magasins, à repositionner) ;
  - **renommer** un rayon (le nom change partout) ;
  - **supprimer** un rayon : s'il contient des produits, choix obligatoire du rayon qui les reçoit.

### 4.2 Relevés de prix (3 sources)
1. **En cochant** un article en magasin : champ prix facultatif, pré-rempli avec le prix moyen.
2. **Scan du ticket** : photo du ticket en fin de courses, voir 4.4.
3. **Saisie manuelle** depuis la fiche produit.

Aucun suivi des dépenses (total payé) : géré dans un autre outil.

### 4.3 Prix moyen
- Moyenne des **N derniers relevés** (N = 5, paramétrable) de moins de 6 mois, par produit et par magasin.
- Indicateur de fiabilité : nombre de relevés et date du dernier.
- **Comparaison par emballage** (format par défaut). Si une contenance différente est indiquée pour un magasin, comparaison au kg/L pour ce produit.
- **Promotions saisies à la main** (pas de récupération automatique : aucune API publique Intermarché/Colruyt connue, scraping fragile et contraire aux CGU). Bouton 🏷 sur un article (tout membre) :
  - magasin concerné, **prix promo facultatif** (sans prix = simple rappel « devrait être moins cher »), note (ex. « 2e à -50 % ») ;
  - validité : **uniquement pour une sortie de courses précise** (la liste en cours) **ou jusqu'à une date** ; expiration automatique ensuite ;
  - pendant sa validité, le prix promo **remplace la moyenne** pour le conseil de magasin, les scénarios et les totaux ; étiquette 🏷 visible dans la liste et en mode courses ;
  - les relevés faits sous promo (cochage ou ligne de ticket avec remise) sont marqués `promo` et **exclus de la moyenne**.

### 4.4 Scan du ticket de caisse
Proposé en fin de courses (« Terminer chez X ») ou depuis la liste clôturée.
1. **Photo** du ticket (ou import d'une image / PDF de ticket électronique).
2. **Lecture** : magasin, date et lignes (libellé, quantité, prix unitaire, remise éventuelle).
3. **Rapprochement** de chaque ligne avec le catalogue :
   - d'abord via les **correspondances mémorisées par magasin** (ex. « TOMAT CONC 400G » chez Colruyt → Tomates concassées 400 g),
   - puis par similarité avec les articles de la liste du magasin,
   - sinon la ligne est « à associer » : choisir un produit, le créer dans le catalogue, ou ignorer (chaque association est mémorisée).
4. **Validation** : écran récapitulatif avec, par ligne, le prix lu, la moyenne actuelle et l'écart en %. Lignes décochables.
5. **Effets** : un relevé de prix (`source = ocr`) par ligne validée **pour ce magasin**, recalcul des moyennes, articles correspondants de la liste cochés « achetés ». Les lignes avec remise sont marquées « promo » (exclues de la moyenne, cf. 4.3). La photo est conservée 3 mois.

Lecture : **Tesseract.js** (gratuit, open source), exécuté **sur le téléphone** dans le navigateur (worker + modèle `fra` mis en cache par le service worker ; rien n'est envoyé à un service tiers).
- Prétraitement de la photo avant OCR : recadrage manuel, niveaux de gris, binarisation, redressement.
- Analyse des lignes par expressions régulières propres à chaque magasin (format Intermarché / Colruyt : libellé, quantité × prix, remises).
- Tesseract étant moins précis sur les tickets froissés ou pâles, l'écran de validation (étape 4) permet de **corriger un prix lu** ou un libellé ; les correspondances mémorisées compensent les libellés mal lus récurrents.

## 5. Listes

### 5.1 Types
- **À prévoir** : liste permanente, sans date. On y note ce qui sera à acheter « la prochaine fois » ou plus tard.
- **Listes datées** : une par sortie de courses. Date proposée = précédente + 15 jours (modifiable). Plusieurs listes futures possibles.

### 5.2 Cycle de vie
`En préparation` → `En courses` → `Clôturée`

- **Création** d'une liste datée : l'app propose d'y importer
  - les articles **récurrents** dus,
  - une sélection de l'**À prévoir**,
  - les **ingrédients des repas** prévus sur sa période.
- **Période d'une liste** = de sa date jusqu'à la veille de la liste suivante. Les repas planifiés dans cette période lui sont rattachés (déplaçables manuellement).
- **Clôture** : les articles non achetés sont reportés vers la liste suivante ou vers À prévoir (choix global ou article par article).
- **Historique** : une liste clôturée s'ouvre en lecture seule : articles achetés par magasin avec le prix payé et l'écart à la moyenne, articles non trouvés et où ils ont été reportés, repas de la période ; action « Copier les articles dans À prévoir ».
- **Actions d'une liste** (menu ⋯, gestionnaire) : changer la date (la période des repas suit ; une seule liste par date), commencer les courses, clôturer, supprimer (impossible si des articles sont cochés ; articles manuels renvoyés vers À prévoir, repas rattachés à la liste voisine).

### 5.3 Article de liste
Produit du catalogue (ou texte libre non rattaché), quantité, note, **origine** (manuel, récurrent, repas X, suggestion de Y), magasin conseillé, magasin affecté (libre), statut (à acheter / acheté / indisponible).

**Fiche article** (toucher un article) : quantité ajoutée à la main, note (« bio », « grand format »), déplacer vers À prévoir ou une autre liste, rendre récurrent / arrêter, accès à la fiche produit, retirer de la liste. Pour un article venant des repas : quantité en plus possible, et « déjà en réserve » qui le retire des repas concernés.

## 6. Répartition par magasin

- **Conseil par article** : magasin au prix moyen le plus bas (ou magasin forcé du produit).
- **Scénarios comparés** pour la liste :
  - tout chez Intermarché, tout chez Colruyt (un seul magasin),
  - répartition conseillée (chaque article au moins cher).
- **Économie estimée** = (meilleur scénario un seul magasin) − (répartition). Si elle est sous un **seuil** (**5 €** par défaut, paramétrable), l'app recommande de ne faire qu'un magasin.
- Articles sans prix connu dans un magasin : signalés, comptés « non estimés », affectés au magasin principal.
- Le gestionnaire (ou membre en magasin) peut **déplacer** n'importe quel article d'un magasin à l'autre ; l'affectation manuelle est conservée et le gain/perte affiché.
- **Liste par magasin** : articles triés selon l'ordre des catégories du magasin, avec total estimé.

## 7. Menus et plats

### 7.1 Plats
- Nom, portions de référence, ingrédients (produit du catalogue + quantité, quantités facultatives).
- **Écran Plats dédié** (onglet de navigation) : **recherche** par nom de plat ou par ingrédient (« oignon » → tous les plats qui en contiennent), filtres Tous / Avec recette / Sans détail / Au menu, prochaine date prévue, bouton « Nouveau plat ». Le menu ne liste plus les plats ; le choix d'un plat pour un créneau a aussi sa recherche.
- Dans l'édition d'un plat, un ingrédient absent du catalogue se **crée à la volée** (nom, rayon, unité d'achat, ingrédient de base oui/non ; prix inconnus jusqu'aux premiers relevés).
- Un plat peut n'avoir **aucun ingrédient détaillé** (« je connais par cœur ») : il apparaît alors comme simple **rappel** dans la liste.
- Ajustement des quantités au nombre de personnes du repas.
- **Recette facultative** : temps de préparation, lien vers une recette en ligne, étapes (texte), notes ; plus tard photo/PDF (page de livre).
- **Depuis la fiche d'un plat** :
  - **Ajouter au menu** (membre : suggérer) : date (à partir d'aujourd'hui) et créneau ; si le créneau est déjà occupé, avertissement et remplacement ; puis même écran que depuis le menu (personnes, ingrédients en réserve).
  - Fiche plat en accordéons, dans cet ordre : Informations, Ingrédients, Recette, puis un panneau unique **Au menu** (dates à venir, bouton « Ajouter au menu », puis historique) ; en bas, boutons **Supprimer** et **Enregistrer** compacts sur une même ligne.
- **Historique des planifications** : nombre de fois planifié, dernière fois (« il y a 13 j »), fréquence moyenne, et **les 5 dernières dates** (créneau, personnes) ; chaque date ouvre le repas. Dans l'écran Plats, chaque carte affiche la prochaine date prévue et la dernière fois.
- **Import automatique depuis un lien** : en collant l'URL d'une recette, le serveur charge la page et en extrait, quand le site les publie, les données structurées `schema.org/Recipe` (JSON-LD ou microdonnées — Marmiton, 750g, Cuisine AZ, CuisineActuelle, Jow, sites WordPress de blogs culinaires…) : nom, photo, portions, temps, ingrédients, étapes.
  - **Ingrédients analysés** (« 2 oignons », « 400 g de tomates concassées ») → quantité, unité, produit, rapprochés du catalogue ; ceux qui manquent sont proposés à la création ; « sel, poivre… » proposés comme ingrédients de base.
  - **Aperçu avant application** : chaque élément importé est cochable ; l'existant du plat n'est remplacé qu'après validation. Quantités ramenées aux portions du plat.
  - Échec (site sans données structurées, page protégée) : le lien est simplement conservé, message « Import impossible, renseigner à la main ».
  - Chargement **côté serveur** (contourne les restrictions CORS) avec garde-fous : http/https uniquement, adresses internes refusées (anti-SSRF), délai 8 s, page max 2 Mo, résultat mis en cache par URL.
- **Créer, modifier, supprimer** un plat (gestionnaire ; les membres le consultent). Modifier un plat recalcule les ingrédients des listes non clôturées. Supprimer un plat prévu dans des repas futurs : confirmation listant ces repas, qui sont retirés du menu ; les menus passés gardent le nom du plat (archivage logique).

### 7.2 Planning
- Calendrier : date × créneau (**petit-déjeuner, midi, soir, collation** ; petit-déjeuner et collation masqués par défaut, activables).
- **Ajout d'un plat au menu** : choix du nombre de personnes et de la liste des ingrédients à acheter ; on **décoche ceux encore en réserve**, qui ne seront pas ajoutés à la liste. Modifiable ensuite depuis le repas (« Ingrédients en réserve »).
- Un membre peut **suggérer** un plat à une date (validation par le gestionnaire).
- Depuis une liste : onglet **Repas** = plats prévus sur sa période.
- Un repas peut être **rattaché manuellement à une autre liste** (ex. dîner du jeudi acheté aux courses suivantes) ; sinon rattachement automatique par période.
- Toucher un repas du menu : **voir la recette** (quantités ajustées au nombre de personnes), changer le nombre de personnes, changer de plat, modifier le plat, retirer du menu. Un 📖 signale les plats qui ont une recette.

### 7.3 Génération des ingrédients
- **Fusion** : un même produit demandé par plusieurs plats donne une seule ligne avec la somme (si même unité) et l'origine (« pour Lasagnes, Chili »).
- Ingrédients de base → section **À vérifier dans les placards**, à cocher pour les ajouter.
- Retirer un repas retire ses quantités de la liste (sauf si l'article a été modifié à la main).

### 7.4 Export et impression du menu
Pour afficher le menu (frigo, cuisine) ou le partager.
- **Période** : 7 jours, période d'une liste (entre deux courses) ou 14 jours ; à partir de la date affichée.
- **Options** : créneaux à inclure, nombre de personnes, marquage des jours de courses (🛒). Les plats suggérés non validés sont exclus.
- **Mise en page** : grille A4 paysage, jours en colonnes × créneaux en lignes, une semaine par tableau, texte lisible de loin, noir et blanc acceptable.
- **Formats** :
  - **Impression** directe (feuille de style `@media print`).
  - **PDF** généré côté serveur (téléchargeable, partageable).
  - **Image PNG** (fond d'écran, envoi par messagerie).
  - **Lien d'affichage** en lecture seule, sans connexion, révocable, qui se met à jour (tablette de cuisine).

## 8. Mode courses (en magasin)

- Vue d'un magasin, grosse typographie, cases à cocher, tri par rayon, articles cochés repliés en bas.
- **Synchronisation en temps réel** entre membres (un coche, l'autre le voit).
- Fin de courses : **scan du ticket** (4.4) ou « Terminer sans scanner », articles non trouvés → « indisponible » (reportés à la clôture).

### 8.1 Fonctionnement hors-ligne (magasins sans réseau)
- **Stockage local automatique** : dès qu'une liste est ouverte, l'app enregistre sur l'appareil (IndexedDB) la liste, ses repas, les produits concernés avec leurs prix moyens et promos, et l'ordre des rayons des magasins. Les listes « En préparation » et « En courses » du foyer sont aussi pré-chargées à l'ouverture de l'app tant qu'il y a du réseau.
- **Application disponible sans réseau** : PWA installable, interface mise en cache par le service worker, ainsi que le moteur et le modèle OCR (Tesseract.js `fra`) pour pouvoir scanner le ticket hors réseau.
- **Tout fonctionne hors-ligne** sur les données locales : cocher/décocher, saisir un prix, ajouter/modifier un article, déplacer un article de magasin, poser une promo, scanner et valider un ticket.
- **File d'attente (outbox)** : chaque modification est enregistrée localement comme une opération horodatée (identifiant unique, appareil, utilisateur), appliquée tout de suite à l'écran.
- **Reprise du réseau** : envoi automatique de la file, dans l'ordre (événement `online`, retour au premier plan de l'app, Background Sync quand le navigateur le permet — Android ; sur iPhone, au prochain affichage de l'app). Ensuite récupération des changements faits par les autres depuis la dernière version connue, puis reconnexion au temps réel (SSE).
- **Conflits** :
  - opérations idempotentes (rejouer deux fois ne double rien) ;
  - cocher un article : « acheté » l'emporte (deux personnes peuvent cocher le même) ;
  - modification d'un même champ : la plus récente gagne ; les relevés de prix ne sont jamais en conflit (ajouts) ;
  - article supprimé par l'un et modifié par l'autre : suppression conservée, notification « 1 modification ignorée ».
- **Indicateurs** : bandeau « Hors-ligne — N modifications en attente », puis « Synchronisé à 10:42 » ; pastille par liste « disponible hors-ligne ». Données locales des listes clôturées purgées après 30 jours.

## 9. Hors périmètre V1 / pistes
- Récupération automatique des promotions.
- Notifications push (V1 : badge in-app des suggestions en attente).

## 10. Proposition technique

- **Express 4 + SQLite intégré à Node (`node:sqlite`, Node ≥ 22.5)**, interface en modules JavaScript sans framework ni compilation, PWA (manifest + service worker) : même socle que les autres outils de la passerelle (MyLittleLibrary, budget-foyer…), aucun module natif à compiler chez l'hébergeur.
- Déploiement dans **node-gateway** (pas de sous-domaine) : dossier `apps/cabas` → servi sur `<domaine de la passerelle>/cabas/`, avec sa tuile « Cabas » sur le portail d'accueil de la passerelle. Le module exporte l'app Express (`module.exports = app`) ; aucun `app.listen` / `process.on` / `setInterval` hors `require.main === module`.
- Contraintes du montage sous `/cabas` :
  - la passerelle retire le préfixe (`app.use('/cabas', …)`) : les routes internes restent `/api/...` ; la page pose `<base href="/cabas/">` (chemin de montage lu dans `req.app.mountpath`) ;
  - aucun chemin absolu `/…` côté navigateur (liens, `fetch`, images) ;
  - icône du portail : `manifest.json` à la racine du dossier (ou `public/manifest.json`), premier élément de `icons` ;
  - même domaine que les autres outils : cookie de session avec `Path=/cabas` et nom propre, service worker limité au scope `/cabas/`, bases IndexedDB préfixées `cabas-`, manifest PWA avec `start_url` et `scope` = `/cabas/`.
- Temps réel : **Server-Sent Events** par foyer (process unique → diffusion en mémoire suffit).
- Hors-ligne : IndexedDB (API native) pour les données locales et la file d'opérations ; chaque opération porte un `op_id` unique (table `AppliedOp` côté serveur pour l'idempotence) ; endpoint `GET /sync?since=<version>` pour rattraper les changements.
- Import de recette : extraction JSON-LD/microdonnées côté serveur (lecture des blocs JSON-LD sans dépendance), analyse des lignes d'ingrédients par règles (quantités, fractions, unités françaises).
- Authentification : lien magique e-mail (comme La Hotte), session cookie.
- Pas de sous-domaine : URL = domaine de la passerelle + `/cabas/`.

### Modèle de données (simplifié)

```
User(id, email, nom)
Household(id, nom, seuil_economie, nb_releves_moyenne, creneaux_actifs)
Membership(user, household, role: manager|member)
Store(id, household, nom, couleur, actif)
Category(id, household, nom)
StoreCategoryOrder(store, category, position)
Product(id, household, nom, category, unite, contenance, contenance_unite,
        recurrence: null|every_list|every_n(n), is_base, forced_store?)
PriceRecord(id, product, store, prix, date, source: check|manual|ocr, promo, user, receipt_line?)
Receipt(id, store_trip, photo, date_lue, statut)
ReceiptLine(id, receipt, libelle_brut, qte, prix_unitaire, remise, product?, statut: matched|to_map|ignored)
StoreAlias(store, libelle_normalise, product)              -- correspondances mémorisées
  -- prix moyen = vue calculée (N derniers relevés < 6 mois)
ShoppingList(id, household, type: backlog|dated, date?, statut, created_by)
ListItem(id, list, product?, libelle_libre?, qte, note, origin: manual|recurring|meal|suggestion,
         assigned_store?, statut: todo|bought|unavailable, suggested_by?, suggestion_state?)
ListItemMealLink(list_item, planned_meal, qte_part)       -- traçabilité de la fusion
StoreTrip(id, list, store, date)
Dish(id, household, nom, portions, temps?, recette_url?, etapes?, notes?, archived)
DishIngredient(dish, product, qte?, unite?)
PlannedMeal(id, household, date, creneau, dish, personnes, list?, suggested_by?, suggestion_state?)
Promo(id, household, product, store, prix?, list?, valid_until?, note, created_by)  -- list XOR valid_until
PlannedMealSkip(planned_meal, product)                     -- ingrédients en réserve, non achetés
```

## 11. Étapes

1. ✅ Socle : auth, foyer, rôles, catalogue, magasins, déploiement node-gateway.
2. ✅ Listes (À prévoir + datées), suggestions, clôture/report, récurrents.
3. ✅ Prix : relevés, moyennes, conseil, scénarios et économie, listes par magasin triées, promos.
4. Mode courses : cochage, saisie prix, temps réel (SSE), hors-ligne complet (stockage local, file d'opérations, synchronisation à la reprise).
5. Scan du ticket (Tesseract.js) : lecture, rapprochement, alias par magasin, mise à jour des prix.
6. Plats (écran dédié, recherche, recettes avec import depuis un lien), planning avec ingrédients en réserve, génération et fusion des ingrédients, export du menu.
7. Plus tard : photo/PDF de recette.

## 12. Points ouverts
- Prendre en compte un coût fixe pour le 2e magasin (trajet, temps) en plus du seuil ? (par défaut : non)
