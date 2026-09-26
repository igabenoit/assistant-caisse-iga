# Déploiement — intervention finale

Le code est prêt à être placé dans un nouveau dépôt privé, puis déployé sur Render. Ne pas remplacer un des projets existants du magasin.

## 1. GitHub

Créer le dépôt privé `assistant-caisse-iga`. Avec Git installé :

```bash
git init
git add .
git commit -m "Assistant Caisse V1"
git branch -M main
git remote add origin https://github.com/igabenoit/assistant-caisse-iga.git
git push -u origin main
```

Le `.gitignore` exclut les secrets, bases locales et environnements Python. Ne jamais ajouter `.env` manuellement. Autre possibilité : téléverser les fichiers extraits dans le dépôt via l'interface GitHub; `render.yaml`, `app.py` et `requirements.txt` doivent être à sa racine.

## 2. Render Blueprint

Dans le tableau de bord Render : **New → Blueprint**, connecter le nouveau dépôt, donner un nom au Blueprint, vérifier les ressources proposées.

Le Blueprint définit :

- un service web Python toujours actif, plan `0.5c-512mb`;
- une base PostgreSQL 17, plan `0.1c-256mb`, disque 1 Go;
- une région commune Ohio;
- aucune ouverture publique de la base (liste d'accès IP vide; connexion interne Render);
- vérification de santé `/healthz`;
- initialisation DEMO une seule fois.

**Ces ressources engendrent des frais Render. Le prix total doit être vérifié et accepté dans le tableau de bord avant leur création.** Les identifiants de plans sont ceux de la documentation officielle consultée le 26 septembre 2026; si Render propose une autre nomenclature, choisir l'équivalent 512 Mo web et 256 Mo PostgreSQL, ou ajuster le Blueprint.

Renseigner :

- `ADMIN_PASSWORD` : mot de passe long et unique (12 caractères minimum);
- `KIOSK_PIN` : code du magasin (6 caractères minimum).

`SECRET_KEY` est générée automatiquement. `DATABASE_URL` vient de la base créée par le Blueprint. Ne pas exposer ces valeurs dans le dépôt, une capture d'écran ou un message.

## 3. Essai sur iPad

Attendre que le service soit marqué Live. Copier son adresse HTTPS exacte depuis Render; aucune adresse publique n'est présumée dans ce projet.

1. Ouvrir l'adresse dans Safari.
2. Entrer le code du magasin.
3. Toucher le nom de la tablette pour l'appeler « iPad Marc-André » ou « Caisse 1 ».
4. Rechercher « avocat », puis « pomme ».
5. Toucher le microphone et autoriser son utilisation. Si la dictée échoue, le clavier reste disponible.
6. Ouvrir Administration et entrer le mot de passe administrateur.
7. Ajouter un produit fictif de test et le retrouver sur une deuxième page/tablette.
8. Ajouter une procédure de test et vérifier les recherches sans réponse.
9. Safari → Partager → Sur l'écran d'accueil.

L'application nécessite le réseau pour les données courantes. Le fonctionnement vocal réel n'est pas certifiable depuis un test serveur; il doit être essayé dans Safari sur l'iPad.

## 4. Mises à jour et diagnostic

Une modification poussée vers la branche reliée déclenche le déploiement selon le réglage d'auto-déploiement de Render. La base PostgreSQL et les photos téléversées sont conservées.

- Erreur de démarrage : regarder Logs et vérifier les quatre variables essentielles.
- Code du magasin oublié : le modifier dans Environment, modifier `SECRET_KEY` pour révoquer les sessions existantes, puis redéployer.
- Réponse absente : ajouter la formulation exacte dans les mots-clés d'une procédure validée.
- Tablette non synchronisée : vérifier le réseau, revenir sur la page; un contrôle de secours a lieu toutes les 5 secondes.
- Trop de tentatives : attendre 15 minutes.
- Ne pas utiliser SQLite sur le disque éphémère Render : le programme refuse cette configuration en production.

Sources officielles : https://render.com/docs/blueprint-spec ; https://render.com/docs/deploy-flask ; https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
