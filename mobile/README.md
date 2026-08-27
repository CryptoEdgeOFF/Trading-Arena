# BTF Arena Mobile

Application iOS/Android Capacitor qui consomme le même contrat API que la plateforme web.

## Données partagées

Les comptes, compétitions, trades, classements, statistiques et badges ne sont jamais stockés comme source de vérité dans l’application. Ils sont récupérés depuis le backend BTF avec le jeton Bearer du joueur.

- Staging : `npm run native:sync:staging` — API Railway, login test possible.
- Production / App Store : `npm run native:sync` — API `https://trading-arena-api-production.up.railway.app`, login test masqué.
- Chaque appareil possède son propre jeton de session. Une connexion OTP sur un autre appareil retrouve le même compte et toutes ses données serveur.

## Commandes

```bash
npm run dev
npm run build
npm run native:sync
npm run native:sync:staging
npm run ios
npm run android
```

Copier `.env.example` vers `.env` pour le travail local.

Le login test interne n’est actif que si `VITE_ENABLE_TEST_LOGIN=true` **et** `ALLOW_TEST_LOGIN=true` sur le backend staging. Ne jamais activer ça en production.

Fiche App Store Connect et notes de review : `APP_STORE.md`.
