# Assistant Caisse — IGA Extra Famille Benoit

V1 fonctionnelle : recherche rapide de produits et codes, dictée volontaire, procédures enregistrées, administration protégée, import Excel/CSV et base partagée. Aucun service IA payant requis.

**Les 26 produits et 4 procédures fournis sont DEMO. Les codes D001 à D026 sont fictifs. Ne pas les utiliser pour facturer.** Les photos sont représentatives; elles ne valident ni le format ni la variété réelle du magasin.

## Démarrage local

Python 3.12 est recommandé.

```bash
python -m venv .venv
# macOS / Linux :
source .venv/bin/activate
# Windows PowerShell : .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scripts/setup_dev.py
python app.py
```

Ouvrir `http://localhost:8000`. Administration : `http://localhost:8000/admin`.
Le script crée un mot de passe aléatoire dans le fichier local `.env`, champ `ADMIN_PASSWORD`. Aucun compte universel ni mot de passe par défaut n'est inclus. `.env` ne doit jamais être envoyé sur GitHub.

La base de développement est `instance/caisse.db` (SQLite). Elle survit aux redémarrages locaux. Le premier démarrage insère la démo une seule fois. Supprimer ou désactiver une fiche ne la recrée pas au redémarrage.

## Mise en ligne sur GitHub + Render

Voir [le guide de déploiement](docs/DEPLOIEMENT.md). Le fichier `render.yaml` crée un service Python et une base PostgreSQL centrale. Les plans définis sont payants pour garder le service disponible; vérifier le coût affiché par Render avant de créer les ressources.

1. Créer un dépôt GitHub privé `assistant-caisse-iga` et y placer les fichiers du projet (à la racine, sans `.env`, `instance` ou dépendances).
2. Dans Render : **New → Blueprint**, choisir ce dépôt.
3. Renseigner `ADMIN_PASSWORD` (12 caractères minimum) et `KIOSK_PIN` (6 caractères minimum). Le premier protège l'administration; le deuxième est entré une fois par tablette.
4. Render génère `SECRET_KEY` et relie automatiquement `DATABASE_URL` à PostgreSQL.
5. Après déploiement, ouvrir l'adresse HTTPS du service et entrer le code du magasin.
6. Dans Safari : Partager → Sur l'écran d'accueil. Sur Android : menu Chrome → Installer / Ajouter à l'écran d'accueil.

Un essai depuis l'iPad exige l'adresse HTTPS déployée. `localhost` dans ce projet n'est pas une adresse accessible depuis l'iPad de l'utilisateur.

## Parcours à essayer

- `avocat` → photo + **D001** avec étiquette DEMO.
- `pomme` → plusieurs cartes (Gala, Granny Smith, Honeycrisp, pomme de terre).
- `banane bio`, `avocatt`, `cilantro`, `c'est quoi le code du gingembre?`.
- `Comment je fais un remboursement sans facture?` → texte DEMO enregistré.
- `Quel est le mot de passe du coffre?` → **Je n’ai pas cette information. Demande au superviseur.**
- Micro : toucher **Parler**, autoriser le micro du navigateur, dire un produit. L'écoute se termine après une phrase ou au plus tard après 15 secondes.
- Administration : créer un produit, rechercher son synonyme sur une deuxième tablette; modifier le code pendant que la première le consulte.
- Créer une procédure et ses formulations, puis poser la question à la caisse.
- Ouvrir **Recherches** pour consulter les demandes sans résultat et créer une procédure à partir d'une demande.

## Importer la vraie liste demain

[Guide d'importation](docs/IMPORTATION.md). Modèle : `static/modele-produits.csv`.

Colonnes : `nom | code | synonymes/mots-clés | catégorie | image | précision`.
Seuls `nom` et `code` sont obligatoires. CSV UTF-8, CSV Windows-1252 et XLSX sont acceptés. L'import est vérifié puis confirmé; aucun enregistrement n'est modifié à l'aperçu. Les codes restent du texte et conservent les zéros initiaux. Les cellules Excel de code doivent être au format Texte ou au format numérique à zéros fixes, par exemple `00000`.

Une option désactive les produits DEMO après import. Les procédures DEMO doivent être remplacées ou désactivées séparément. La source officielle des codes demeure la liste fournie par le magasin.

## Architecture et décisions

- **Flask / Python + SQLAlchemy** : un seul service simple. HTML/CSS/JavaScript natifs; pas de chaîne de compilation du frontend.
- **PostgreSQL en production** : produits, procédures, photos téléversées, sessions, journaux et révision centrale. Aucun code important stocké uniquement dans le navigateur. SQLite sert uniquement au développement et aux tests locaux.
- **Photos** : 26 images initiales intégrées dans le dépôt; nouvelles photos normalisées en JPEG et stockées en base. URLs HTTPS externes également possibles. Aucun téléchargement automatique côté serveur lors d'une recherche.
- **Synchronisation** : SSE vérifie la révision centrale chaque seconde; l'écran courant se recharge à la modification. Contrôle de secours toutes les 5 secondes, reconnexion au retour sur l'écran. Les changements sont lus à la recherche suivante même si SSE est indisponible. Latence réseau en sus.
- **Recherche produit** : accents, pluriels simples, synonymes, préfixes et petites fautes. Tous les mots significatifs doivent correspondre. Une recherche précise `banane bio` ne retourne pas la banane conventionnelle.
- **Procédures** : recherche prudente sur le sujet et les formulations enregistrées, normalisation et synonymes courants. Le texte enregistré est renvoyé sans reformulation. Les qualificatifs inconnus empêchent une réponse trop large. En cas d'ambiguïté, l'utilisateur choisit le sujet. Ce moteur ne comprend pas toutes les paraphrases : enrichir les formulations depuis les recherches sans résultat.
- **IA future** : point d'extension `caisse/search.py::resolve`. Un éventuel modèle peut sélectionner des identifiants de procédures approuvées; le serveur doit valider les identifiants, l'état actif, la confiance et renvoyer les textes officiels. Il ne doit jamais inventer des étapes. Pas de clé IA ni d'appel IA en V1.
- **PWA** : manifeste, icônes, écran hors connexion. Seule la coque est mise en cache; aucune procédure ni liste PLU périmée ne sert de secours hors connexion.
- **Appareil** : nom choisi par l'utilisateur, conservé localement pour l'ergonomie, enregistré dans chaque recherche finalisée. Il s'agit d'une étiquette déclarative, pas d'une identité matérielle certifiée.

## Protection et confidentialité

- Administration : mot de passe haché scrypt en mémoire; session opaque révocable en base, cookie HttpOnly/SameSite Strict et Secure sur Render. Session admin 8 h; tablette 30 jours.
- POST/PUT/DELETE : en-tête dédié et contrôle Origin; aucun CORS ouvert.
- Maximum 8 tentatives de connexion sur 15 minutes par adresse hachée. Pas d'adresse IP brute dans le journal applicatif de recherche.
- Réponse HTML échappée, politique CSP, images téléversées décodées puis réencodées. Import limité à 5 Mo / 10 000 lignes, protection contre gros classeurs décompressés, formules Excel refusées.
- Concurrence : une fiche éditée depuis deux sessions déclenche un conflit plutôt qu'un écrasement silencieux. Un import refuse une base modifiée depuis son aperçu.
- Les recherches sont conservées 30 jours par défaut. Elles contiennent l'appareil, la date UTC, le texte, le type, la source texte/voix et le résultat. Éviter d'y inscrire des renseignements clients. Nettoyage des journaux lors d'une nouvelle recherche finalisée.
- L'application ne reçoit ni ne conserve les fichiers audio. La reconnaissance native du navigateur peut transmettre l'audio au fournisseur de son service de dictée. Une connexion Internet et les permissions système peuvent être nécessaires.
- Le code tablette protège les procédures sur l'adresse Internet. Les photos DEMO sous `/static` restent publiques; les photos téléversées passent par l'API protégée.

## Variables d'environnement

| Variable | Usage |
|---|---|
| `APP_ENV` | `production` sur Render, `development` en local |
| `SECRET_KEY` | Secret de signature, 32 caractères minimum; généré par Render |
| `ADMIN_PASSWORD` | Mot de passe admin, 12 caractères minimum |
| `ADMIN_PASSWORD_HASH` | Variante : hash scrypt Werkzeug, prioritaire sur le mot de passe |
| `KIOSK_PIN` | Code partagé des tablettes, 6 caractères minimum en production |
| `DATABASE_URL` | PostgreSQL en production; absence = SQLite local |
| `SEED_DEMO` | `true` initialise une fois; `false` pour une nouvelle base vide |
| `LOG_RETENTION_DAYS` | Conservation des recherches, défaut 30 |
| `PORT` | Fourni automatiquement par Render; défaut local 8000 |

En production, le programme refuse de démarrer sans PostgreSQL, sans secret ou sans code tablette. Une rotation de `SECRET_KEY` déconnecte tous les appareils; changer aussi les mots de passe/codes concernés puis redéployer.

## Sauvegarde et exploitation

Le lien de sauvegarde dans l'administration exporte les produits, procédures et photos téléversées en JSON; les sessions et mots de passe ne sont pas exportés. Utiliser `python scripts/restore_backup.py fichier.json` pour restaurer dans une base vide (voir l'aide du script). Configurer aussi les sauvegardes de PostgreSQL dans Render selon le plan retenu.

Le schéma v1 est déclaré dans `caisse/models.py`; `docs/schema-postgresql.sql` en fournit la version SQL. La création initiale est automatique. Toute évolution future des colonnes devra passer par une migration versionnée; `create_all` ne modifie pas les colonnes existantes.

## Tests

```bash
pip install pytest==9.0.2
python -m pytest tests -q
```

Essais supplémentaires des parcours JavaScript (sans microphone physique) : `npm ci`, puis `python scripts/test_ui.py`.

Les tests couvrent recherche, refus, isolation bio, CRUD, données partagées, conflits, import transactionnel, XLSX, zéros initiaux, photos, journaux et authentification. La CI GitHub ajoute un essai PostgreSQL isolé. Le micro réel doit être validé sur l'iPad et les tablettes Android après déploiement; sa disponibilité dépend du navigateur, d'iPadOS/Android et des permissions.

Crédits des photos : [docs/PHOTOS.md](docs/PHOTOS.md) et `data/image-credits.json`. Ne pas supprimer ces attributions.
