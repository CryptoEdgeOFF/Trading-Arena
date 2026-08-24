# BTF Arena Mobile

Application iOS/Android Capacitor qui consomme le même contrat API que la plateforme web.

## Données partagées

Les comptes, compétitions, trades, classements, statistiques et badges ne sont jamais stockés comme source de vérité dans l’application. Ils sont récupérés depuis le backend BTF avec le jeton Bearer du joueur.

- En développement : `VITE_API_URL` pointe vers Railway/Neon staging.
- En production : `VITE_API_URL` doit pointer vers le même backend de production que le site PC.
- Chaque appareil possède son propre jeton de session. Une connexion OTP sur un autre appareil retrouve le même compte et toutes ses données serveur.

## Commandes

```bash
npm run dev
npm run build
npm run native:sync
npm run ios
npm run android
```

Copier `.env.example` vers `.env` pour remplacer l’API cible localement.

Pour tester `ARTEMTEST987`, définir `VITE_ENABLE_TEST_LOGIN=true` localement et `ALLOW_TEST_LOGIN=true` uniquement sur le service Railway staging.
