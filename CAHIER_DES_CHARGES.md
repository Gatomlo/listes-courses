# Le Cabas — Cahier des charges (v0.1)

> Nom de travail. Outil privé du foyer pour préparer les courses, choisir le bon magasin selon les prix et planifier les repas.
> Maquette cliquable : `maquette/index.html` (publiée : https://claude.ai/artifact/PFxn57TQBfrCebd4mEvCtw).

## 1. Objectif

- Tenir des **listes de courses partagées** dans le foyer, préparées à l'avance (rythme habituel ~15 jours, variable).
- Connaître le **prix moyen** de chaque produit dans chaque magasin (Intermarché, Colruyt…) à partir des achats réels.
- **Conseiller** le magasin le moins cher par article et montrer si **faire deux magasins vaut la peine** (économie estimée vs un seul magasin), en laissant toujours le choix final libre.
- Sortir une **liste par magasin**, triée dans l'ordre des rayons de ce magasin.
- Planifier un **menu** (plats datés) qui alimente automatiquement la liste avec ses ingrédients.

## 2. Foyer et rôles

- Un **foyer** regroupe des comptes. Un compte peut appartenir à plusieurs foyers (sélecteur en en-tête).
- **Gestionnaire** : crée/clôture les listes, ajoute directement articles et plats, valide les suggestions, gère catalogue, magasins et paramètres. Plusieurs gestionnaires possibles par foyer.
- **Membre** : consulte tout, coche en magasin, saisit des prix, et **suggère** des articles ou des plats. Une suggestion reste « en attente » (visible, grisée) jusqu'à acceptation ou refus par un gestionnaire.
- Invitation par lien/e-mail émis par un gestionnaire.
- **Gestion des membres** (gestionnaire) : modifier le nom affiché et l'e-mail, **changer le profil** Membre ↔ Gestionnaire, **retirer du foyer** (le compte n'est pas supprimé ; ses suggestions en attente sont refusées ; son nom reste dans l'historique). Le foyer garde toujours au moins un gestionnaire : le dernier ne peut être ni rétrogradé ni retiré.
- Écran **Foyer** organisé en **accordéons** (en-tête avec résumé : nombre, valeurs clés) : Suggestions en attente (ouvert par défaut s'il y en a), Membres, Réglages, puis un accordéon par magasin (ordre des rayons). Bouton « Tout ouvrir / Tout replier » ; état mémorisé par appareil.

## 3. Catalogue commun du foyer

Base unique de produits partagée par le foyer, réutilisée par les listes et les recettes.

| Champ | Exemple | Rôle |
|---|---|---|
| Nom | Lait demi-écrémé | Autocomplétion |
| Catégorie | Frais | Tri par rayon |
| Format / contenance | 1 L | Comparaison au litre/kg si formats différents |
| Unité d'achat | bouteille, pièce, kg | Quantités et fusion |
| Récurrent | chaque liste / toutes les 2 listes / non | Ajout automatique |
| Ingrédient de base | oui (sel, huile, épices) | Proposé « à vérifier », jamais ajouté d'office |
| Magasin préféré forcé | — | Outrepasse le conseil prix (qualité, habitude) |

- Ajout à la volée depuis une liste (« Créer “xxx” dans le catalogue »).
- Fusion de doublons par le gestionnaire.

## 4. Magasins et prix

### 4.1 Magasins
- Liste libre (au départ : **Intermarché**, **Colruyt**), couleur, actif/inactif.
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
- Comparaison sur le **prix au kg/L** quand les contenances sont renseignées, sinon sur le prix unitaire.
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
- Historique consultable (montants estimés vs tickets).

### 5.3 Article de liste
Produit du catalogue (ou texte libre non rattaché), quantité, note, **origine** (manuel, récurrent, repas X, suggestion de Y), magasin conseillé, magasin affecté (libre), statut (à acheter / acheté / indisponible).

## 6. Répartition par magasin

- **Conseil par article** : magasin au prix moyen le plus bas (ou magasin forcé du produit).
- **Scénarios comparés** pour la liste :
  - tout chez Intermarché, tout chez Colruyt (un seul magasin),
  - répartition conseillée (chaque article au moins cher).
- **Économie estimée** = (meilleur scénario un seul magasin) − (répartition). Si elle est sous un **seuil** (par défaut 5 €, paramétrable), l'app recommande de ne faire qu'un magasin.
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

- **SvelteKit** (adapter-node) + **SQLite / Drizzle**, PWA (manifest + service worker), même socle que La Hotte.
- Déploiement derrière **node-gateway** : monté sur `/courses` (`paths.base = '/courses'`), le module exporte un handler Express ; aucun `app.listen` / `process.on` / `setInterval` hors `require.main === module`.
- Temps réel : **Server-Sent Events** par foyer (process unique → diffusion en mémoire suffit).
- Hors-ligne : IndexedDB (via Dexie) pour les données locales et la file d'opérations ; chaque opération porte un `op_id` unique (table `AppliedOp` côté serveur pour l'idempotence) ; endpoint `GET /sync?since=<version>` pour rattraper les changements.
- Import de recette : extraction JSON-LD/microdonnées côté serveur (parseur HTML léger, ex. `cheerio`), analyse des lignes d'ingrédients par règles (quantités, fractions, unités françaises).
- Authentification : lien magique e-mail (comme La Hotte), session cookie.
- Sous-domaine envisagé : `courses.ranchduphoenix.be` (à router vers la passerelle).

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

1. Socle : auth, foyer, rôles, catalogue, magasins, déploiement node-gateway.
2. Listes (À prévoir + datées), suggestions, clôture/report, récurrents.
3. Prix : relevés, moyennes, conseil, scénarios et économie, listes par magasin triées.
4. Mode courses : cochage, saisie prix, temps réel (SSE), hors-ligne complet (stockage local, file d'opérations, synchronisation à la reprise).
5. Scan du ticket (Tesseract.js) : lecture, rapprochement, alias par magasin, mise à jour des prix.
6. Plats (écran dédié, recherche, recettes avec import depuis un lien), planning avec ingrédients en réserve, génération et fusion des ingrédients, export du menu.
7. Plus tard : photo/PDF de recette.

## 12. Points ouverts
- Nom définitif de l'app et sous-domaine.
- Seuil d'économie par défaut (5 € ?) et éventuel coût fixe « 2e magasin » (temps/trajet).
- Gestion des formats différents (kg vs pièce) : niveau de détail souhaité dans le catalogue.
