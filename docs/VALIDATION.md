# Validation de la V1 — 26 septembre 2026

## Vérifications réalisées

- **34 tests serveur réussis** avec SQLite, dont un flux de mise à jour SSE entre deux clients.
- **Parcours JavaScript réussis dans JSDOM**, avec l'application HTTP réelle : accueil, avocat, pommes, procédure DEMO, refus d'une question inconnue, connexion admin, création de produit, lecture depuis une autre interface, création de procédure, journal sans résultat, dictée simulée et erreur de permission du micro. Aucune erreur JavaScript détectée pendant ces parcours.
- 26 photos intégrées, examinées visuellement; auteur, source et licence dans les crédits.
- Syntaxe Python et JavaScript vérifiée.
- Schéma PostgreSQL produit par le même modèle SQLAlchemy utilisé par le serveur.

## Résultat par critère

| Critère | Résultat |
|---|---|
| Avocat + photo + code dominant | Fonctionnel en test, D001 fictif |
| Plusieurs pommes | Fonctionnel |
| Micro volontaire + repli clavier | Implémenté; événements simulés vérifiés |
| Question DEMO → procédure | Fonctionnel pour les formulations du mandat |
| Question inconnue → refus | Fonctionnel; qualificatifs inconnus également refusés |
| Administration protégée | Fonctionnelle, refus des accès anonymes et CSRF |
| Ajouter / modifier / désactiver / supprimer | API testée; création et lecture testées dans l'interface |
| Ajouter une procédure | Fonctionnel, texte restitué sans génération |
| Mise à jour partagée | Deux clients et flux SSE testés |
| Journal des demandes sans réponse | Fonctionnel, dédoublonnage des événements |
| Importation future | CSV et XLSX, aperçu puis transaction, zéros initiaux et doublons testés |

## À vérifier après mise en ligne

- Déploiement Render et connexion à PostgreSQL réel. Le code est préparé, mais ces ressources n'ont pas été créées pendant cette exécution.
- Pipeline PostgreSQL de GitHub Actions : configuré, pas encore exécuté sur GitHub.
- Affichage visuel et installation PWA sur l'iPad physique et une tablette Android.
- Reconnaissance de la voix réelle en français canadien et permissions Safari/Chrome.
- Persistance après un redéploiement Render, puis essai simultané des trois tablettes.

Le navigateur distant de vérification n'a pas accès au serveur local de cet environnement. Les tests DOM vérifient les interactions et requêtes HTTP, pas le rendu graphique d'un vrai navigateur ni la capture audio. Aucune réussite Safari/iPad réelle n'est revendiquée.

## Limites délibérées

- Pas de réponse générée par un modèle IA. La recherche des procédures est prudente et dépend des formulations enregistrées.
- Internet requis pour les données courantes : aucune ancienne procédure ni ancien PLU proposé hors connexion.
- Identifiant de tablette déclaratif et code d'accès collectif, pas encore de comptes individuels par caissier.
- Le format `.xls` ancien n'est pas pris en charge; convertir en `.xlsx` ou CSV.
- Petite flotte prévue avec le service 24 threads (les connexions SSE en occupent une chacune); augmenter les ressources ou remplacer SSE par un service asynchrone avant une forte expansion.
