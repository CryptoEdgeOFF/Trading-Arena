# Fiche App Store — BTF Arena

Copier-coller dans App Store Connect (`com.btfarena.app`, version **1.0**, build **1**).
L’app est **iPhone uniquement**, portrait.

## Identité

| Champ | Valeur |
|---|---|
| Nom | BTF Arena |
| Sous-titre (30 car.) | Compétition de trading |
| Bundle ID | `com.btfarena.app` |
| SKU | `btfarena-ios` |
| Catégorie principale | Finance |
| Catégorie secondaire | Divertissement |
| Page d’assistance | https://btfarena.com |
| URL marketing | https://btfarena.com |
| Confidentialité | https://btfarena.com/confidentialite |
| CGU | https://btfarena.com/cgu |
| Copyright | © 2026 BTF Arena |

## Description FR (4000 car. max)

BTF Arena est la compétition de trading en ligne 100 % gratuite : crypto, forex, indices, actions et matières premières.

Affronte des traders du monde entier dans des arènes paper trading. Grimpe au classement en temps réel, construis ton BTF Rating et gagne des lots exclusifs. Inscription gratuite, sans dépôt et sans courtage réel.

• Rejoins des arènes publiques ou privées
• Trade en paper trading depuis le terminal mobile
• Suis ton rang, tes badges et tes saisons
• Discute avec la communauté et partage tes analyses
• Réclame tes payouts et découvre les deals partenaires

BTF Arena n’est pas un broker et n’exécute aucun ordre sur les marchés réels. Les compétitions utilisent un capital virtuel. Les lots et payouts sont des récompenses promotionnelles, pas des gains de trading réel.

Un seul compte fonctionne sur iPhone et sur btfarena.com.

## Description EN

BTF Arena is a free online trading competition: crypto, forex, indices, stocks and commodities.

Compete with traders worldwide in paper-trading arenas. Climb the live leaderboard, build your BTF Rating and win exclusive prizes. Free to join, no deposit, no real brokerage.

• Join public or private arenas
• Paper trade from the mobile terminal
• Track your rank, badges and seasons
• Chat with the community and share your analysis
• Claim payouts and unlock partner deals

BTF Arena is not a broker and does not place live market orders. Competitions use virtual capital. Prizes and payouts are promotional rewards, not profits from real trading.

One account works on iPhone and on btfarena.com.

## Texte promotionnel (170 car.)

FR : Compétition de trading gratuite. Rejoins une arène, trade en paper, grimpe au classement et gagne des lots. Sans dépôt.

EN : Free trading competition. Join an arena, paper trade, climb the leaderboard and win prizes. No deposit.

## Mots-clés (100 car. max, sans espaces après les virgules)

FR : trading,compétition,crypto,forex,tournoi,classement,paper trading,arène
EN : trading,competition,crypto,forex,tournament,leaderboard,paper trading

## Captures d’écran iPhone

Prévoir 3 à 10 captures **portrait** pour l’iPhone 6,9" (1320 × 2868) — suffisant pour iPhone only.

1. Accueil / arènes live
2. Terminal de trading
3. Classement d’une arène
4. Rang / saison / badges
5. Chat communauté
6. Profil + payouts ou deals

Pas besoin de captures iPad (l’app n’est plus déclarée iPad).

## Questionnaire âge

Réponses recommandées — **17+** à cause des lots en cash et du chat UGC.

| Question | Réponse |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Profanity or Crude Humor | Infrequent/Mild (chat) |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Alcohol, Tobacco, or Drug Use or References | None |
| Simulated Gambling | None — paper trading, not a casino |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Unrestricted Web Access | Yes (liens deals partenaires) |
| Gambling and Contests | Frequent/Intense (lots / cash prizes) |
| User-Generated Content | Yes (chat, photos, reports) |
| Messaging and Chat | Yes, filtered + report/block |

Préciser dans les notes de review : ce n’est **pas** un broker, **pas** du gambling, capital virtuel uniquement.

## Confidentialité App Store

Données collectées, liées à l’identité, **sans tracking** :

- Adresse e-mail — fonctionnalités de l’app
- Numéro de téléphone — fonctionnalités de l’app
- Nom — fonctionnalités de l’app
- Identifiant utilisateur — fonctionnalités de l’app
- Identifiant de l’appareil (push) — fonctionnalités de l’app
- Photos — chat communautaire
- Contenu utilisateur (messages) — fonctionnalités de l’app
- Infos financières autres (PnL paper, payouts) — fonctionnalités de l’app

Pas de tracking publicitaire. Pas d’App Tracking Transparency.

## Export compliance

`ITSAppUsesNonExemptEncryption = false` est déjà dans l’app.
Dans App Store Connect : **No** (HTTPS standard uniquement, pas de crypto maison).

## Notes pour l’équipe de review (EN)

BTF Arena is a free paper-trading competition. Players use virtual capital only. The app is not a broker and does not execute real market orders. Cash prizes are promotional rewards paid after a competition ends.

Sign in with email OTP, then SMS OTP on first signup.

Demo account for review (production):
Email: apple.review@btfarena.com
Code: 847293
No SMS step. The account is already entered in Ninja Trader Cup #3. Paper trading opens when that arena goes live.

How to test:
1. Open the app and create / log in with the demo account.
2. Home → join a public arena if registration is open, or open an already joined arena.
3. Trade tab → place a paper market or limit order.
4. Rank / leaderboard → view standings.
5. Community → send a text message (optional photo).
6. Profile → journal, payouts, deals, team.

Push notifications use Apple Push Notification service (production). Please allow notifications when prompted.

Legal:
https://btfarena.com/cgu
https://btfarena.com/confidentialite

Contact: [À REMPLIR — e-mail support Apple]

## Compte reviewer

Compte prod sans OTP réel. Apple se connecte comme un utilisateur normal :

- E-mail : `apple.review@btfarena.com`
- Code : `847293`
- Pas de SMS
- Déjà inscrit à Ninja Trader Cup #3

Coller ces identifiants dans App Store Connect → App Review Information.

Le backend production doit être déployé avec ce compte (variables optionnelles `APPLE_REVIEW_EMAIL` / `APPLE_REVIEW_CODE`).

## Archive Xcode

```bash
cd mobile
npm run native:sync
```

Puis Xcode → schéma **App** → destination **Any iOS Device** → Product → Archive → Distribute App → App Store Connect.

Vérifier avant l’archive :

- Bundle `com.btfarena.app`
- Version 1.0 (1)
- Signing Team `2985W9RSPP`, Release
- `aps-environment = production`
- Le JS bundlé contient `trading-arena-api-production.up.railway.app` et **pas** l’URL Railway staging
