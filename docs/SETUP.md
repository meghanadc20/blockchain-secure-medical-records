# Setup

## Prerequisites
- Node.js 18+ (20 LTS or 22 recommended) and npm
- Git
- A MongoDB Atlas cluster (free tier) — Phase 2
- A Supabase project with a **private** bucket named `medical-records` — Phase 6
- Ganache and MetaMask (browser extension) — Phase 8

## 1. Environment
```bash
cp .env.example .env
```
Fill in values. `.env` is git-ignored. Never commit real secrets.

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # FILE_ENCRYPTION_KEY
```

## 2. Run
```bash
cd backend
npm install
npm run dev
```
Open http://localhost:5000. Health check: http://localhost:5000/api/health
(shows which config groups are present — never values).

## 3. GitHub
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
