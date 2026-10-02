# Le Cabas (listes-courses)

## Objectif
Outil privé du foyer : listes de courses partagées (« À prévoir » + listes datées), prix moyens par magasin (Intermarché, Colruyt), conseil de magasin et économie estimée du split, listes par magasin triées par rayon, menus qui alimentent les listes. Spécifications : `CAHIER_DES_CHARGES.md`.

## État (au 2026-10-02)
Phase d'étude. Aucun code applicatif. Maquette cliquable statique : `maquette/index.html` (servir avec `npx http-server maquette -p 5180`, ouvrir `http://127.0.0.1:5180`), publiée en privé : https://claude.ai/artifact/PFxn57TQBfrCebd4mEvCtw (republier après chaque modif de la maquette).

Fait dans la maquette + cahier des charges : listes À prévoir/datées, conseil magasin et économie du split, mode courses par rayon, scan ticket (Tesseract.js, simulé), menu + export/impression, écran Plats dédié avec recherche, édition/suppression de plats et recettes, création d'ingrédient à la volée, ingrédients « en réserve » à l'ajout d'un repas, Foyer en accordéons, gestion des membres (profil, retrait), rayons (ajout/renommage/suppression/ordre), promos (prix pour une sortie ou jusqu'à une date), hors-ligne (stockage local à l'ouverture, file d'opérations, synchro à la reprise ; simulé), import de recette depuis une URL (schema.org/Recipe, simulé).
Décisions utilisateur : pas de saisie du total ticket (dépenses suivies ailleurs, pas de lien budget-foyer), OCR = Tesseract.js gratuit uniquement.
Prochaine étape : faire relire la maquette à l'utilisateur, trancher les points ouverts (section 12), puis démarrer l'étape 1 (socle).

## Stack prévue
SvelteKit (adapter-node) + SQLite/Drizzle, PWA, temps réel par SSE, auth lien magique. Monté dans **node-gateway** sur `/courses` (pas de `app.listen`/`process.on` hors `require.main === module`).

## Règles métier non évidentes
- Membres = suggestions seulement ; un gestionnaire valide (articles et plats).
- Prix moyen = moyenne des N (5) derniers relevés < 6 mois par produit × magasin ; relevés issus du cochage, de la saisie manuelle et du scan de ticket (alias libellé→produit mémorisés par magasin).
- Une liste datée couvre les repas de sa date jusqu'à la veille de la liste suivante ; ingrédients fusionnés par produit ; ingrédients « de base » seulement proposés.
- Split conseillé seulement si économie ≥ seuil du foyer (5 € par défaut).

## Commandes
À définir au démarrage du développement.

## Méthode de travail
Réponses en français, concises. Développement par étapes (section « Étapes » du cahier des charges).
