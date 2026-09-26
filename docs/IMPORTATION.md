# Importation des vrais produits

Ouvrir **Administration → Importer**, sélectionner un CSV ou XLSX, puis **Vérifier le fichier**. L'aperçu indique les nouveaux codes et les codes déjà présents. **Confirmer l'importation** est la seule étape qui écrit en base.

| Colonne | Requis | Exemple de contenu |
|---|---|---|
| nom | Oui | Nom officiel dans votre liste |
| code / PLU | Oui | Code réel, comme texte |
| synonymes/mots-clés | Non | nom usuel; variante; faute fréquente |
| catégorie | Non | Fruits, Légumes, Herbes… |
| image | Non | URL HTTPS ou chemin d'une image déjà téléversée |
| précision | Non | Variété, format, bio ou conventionnel… |

Excel : le premier onglet est importé, première ligne = en-têtes. `.xls` ancien format n'est pas accepté : enregistrer en `.xlsx` ou CSV. Les formules sont refusées : coller les valeurs dans une copie avant import.

Conserver les codes au format Texte. Un format numérique à zéros fixes (`00000`) est également lu correctement. Des zéros déjà supprimés du fichier source ne peuvent pas être devinés.

Les noms de colonnes anglais `name`, `code`, `keywords`, `category`, `image`, `note` fonctionnent aussi. Accents et différences de casse dans les en-têtes sont normalisés.

Deux modes :

- **Ajouts seulement** : un code déjà présent reste inchangé.
- **Mettre à jour** : le code sert de clé. Les colonnes facultatives absentes du fichier conservent leur valeur; une cellule vide dans une colonne présente efface sa valeur. Les produits importés sont actifs et considérés comme données réelles.

L'import entier est rejeté si une ligne est invalide ou si le fichier contient deux fois le même code. Aucun demi-import. Si la base a changé depuis l'aperçu, relancer la vérification.

L'option **Désactiver les produits DEMO** conserve les anciennes fiches, mais les retire de l'interface caisse. Remplacer/désactiver séparément les procédures DEMO dans **Procédures**.

Les photos peuvent être ajoutées après import, produit par produit. Les photos téléversées sont conservées dans PostgreSQL; pas besoin de disque persistant Render. Une photo externe HTTPS reste dépendante du site qui l'héberge.

Avant un import réel, télécharger la sauvegarde depuis l'administration. Vérifier ensuite quelques codes de chaque catégorie contre la liste source officielle.
