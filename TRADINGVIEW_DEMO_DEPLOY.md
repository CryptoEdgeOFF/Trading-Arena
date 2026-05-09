# TradingView Demo Deployment

Demo page:

```txt
/demo-trading
```

Purpose:

- Public paper trading demo for TradingView review.
- No signup, no competition, no admin, no real funds.
- Frontend-only state persisted in `localStorage`.
- TradingView widget is displayed in the main chart area.

Recommended free deployment:

1. Push this repository to GitHub.
2. Create a new Netlify site from the GitHub repository.
3. Netlify build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Open the generated Netlify URL:

```txt
https://<your-site-name>.netlify.app/demo-trading
```

The `netlify.toml` file handles React Router fallback, so direct visits to `/demo-trading` work.
