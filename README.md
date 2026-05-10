# Trading-Arena

Plateforme BTF Arena avec frontend Vite/React et backend Express temps réel.

## Local

```bash
npm install
npm run dev
```

Le frontend tourne sur Vite et proxy automatiquement `/api`, `/uploads` et `/ws` vers `http://localhost:3001`.

## Déploiement Recommandé

Le frontend peut rester sur Netlify. Le backend trading doit tourner sur un serveur Node persistant (Render, Railway, Fly.io, VPS, etc.) pour garder le moteur paper trading, les WebSockets marché, les timers, les SL/TP et les ordres limit actifs comme en local.

Backend persistant :

```bash
npm install
npm start
```

Variables backend à mettre sur Render/Railway :

```env
DATABASE_URL=...
DATABASE_SSL=true
ADMIN_CODE=...
RESEND_API_KEY=...
RESEND_FROM_EMAIL="BTF Trade <noreply@breakout-tv.com>"
APP_NAME="BTF Trade"
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=...
```

Frontend Netlify :

```env
VITE_API_URL=https://ton-backend.onrender.com
```

Sans `VITE_API_URL`, le frontend continue d'utiliser les routes relatives `/api` pour le mode local ou le fallback Netlify Functions.
