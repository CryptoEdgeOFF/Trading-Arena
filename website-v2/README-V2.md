# BTF Arena — Site web v2 (copie complète, nouveau style esport)

Copie complète de l'app web actuelle (plateforme compete, terminal de trading,
classements, admin…) avec en plus une **nouvelle page d'accueil esport** alignée
sur le style de l'app mobile (rating Bronze → Legend, saisons, Paris Major).

**Ce dossier est totalement isolé du site en production.** Rien ici n'est branché
au build existant à la racine ni à son déploiement. Le site live n'est pas affecté.

## Ce qui change par rapport au site actuel

- `/` affiche la nouvelle landing esport (`src/components/HomeLanding.tsx`)
  au lieu de rediriger vers `/compete`.
- Toutes les autres routes sont identiques : `/compete`, `/trade`, `/trade-demo`,
  `/compete/leaderboard/:id`, etc.
- Nouveaux assets optimisés dans `public/landing/` (badges webp, arènes 3D, vidéo Major).

## Lancer en local

L'app a besoin de l'API locale sur le port 3001 (lancée depuis la racine du repo) :

```bash
# depuis la racine si l'API ne tourne pas déjà :
npm run dev:server

# puis dans ce dossier :
npm run dev:client   # sert le site sur http://localhost:8090
```

## Déployer (sans toucher au site actuel)

Créer un **nouveau site Netlify** dont le dossier de base est `website-v2/`.
La commande et le dossier de publication sont déjà définis dans
`website-v2/netlify.toml`.

Configurer obligatoirement :

```bash
API_PROXY_TARGET=https://adresse-du-backend-btf
```

Le build génère alors les proxies `/api`, `/uploads` et `/spectate`, puis le
fallback SPA. Sans cette variable, le build reste valide pour une prévisualisation
statique mais les fonctions `/compete` dépendantes de l'API ne fonctionneront pas
en production. Le chat garde un polling REST de secours si l'hébergeur ne relaie
pas les WebSockets.

Ne pas remplacer le déploiement actuel tant que l'arène en cours n'est pas
terminée.
