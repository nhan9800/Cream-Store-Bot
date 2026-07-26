# Deployment Guide - Cenar Store

## Prerequisites
- Node.js 20.x or higher
- Git & npm
- PM2 (for self-hosted / VibeHost deployment) or cPanel Node.js Selector

## Website Deployment (`cenar-website-main`)
1. **CI/CD Pipeline**: GitHub Actions `.github/workflows/ci.yml` runs automated build verification (`npm run build`) and unit tests (`npm test`) on every pull request and push to `main`.
2. **Production Build**:
   ```bash
   npm ci
   npm run build
   ```
3. **Environment Variables Required**:
   - `BOT_API_URL`
   - `BOT_API_KEY`
   - `NEXT_PUBLIC_SITE_URL=https://cenarstore.xyz`
   - `NEXT_PUBLIC_DISCORD_INVITE`
   - `NEXTAUTH_SECRET`
   - `PORT=3000`

## Bot Deployment (`Cream-Store-Bot-main`)
1. **Automated Production Deploy**: Triggered via `.github/workflows/deploy-production.yml` upon push to `main`.
2. **Manual Deploy via VibeHost Webhook**:
   ```bash
   curl -X POST "http://hcm3.vibehost.vn:20022/api/public/deploy" \
     -H "x-bot-api-key: $BOT_API_KEY"
   ```
3. **Health Check Probe**:
   ```bash
   curl "http://hcm3.vibehost.vn:20022/api/health"
   ```
