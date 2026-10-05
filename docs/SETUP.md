# MedChain — Setup

## Prerequisites
- Node.js 22 LTS or newer and npm
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

## 2. Create the admin account
Set `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (8+ chars, letters and numbers) in `.env`, then:
```bash
cd backend
npm run seed:admin
```
The admin logs in on the normal `/login` page and is redirected to the admin dashboard. There is no public admin link or registration.

## 3. Secure file storage (Supabase)
In `.env` set `SUPABASE_URL` (project URL), `SUPABASE_SERVICE_ROLE_KEY` (the **secret** server key — never put it in frontend code) and `FILE_ENCRYPTION_KEY` (64 hex chars). Then:
```bash
cd backend
npm run storage:setup
```
Back up `FILE_ENCRYPTION_KEY` safely — encrypted files cannot be decrypted without it.

## 3c. Local blockchain (Ganache) — test network only
Install the MetaMask browser extension and create a wallet used **only** for this project. Then, in `backend/`:
```bash
npm install            # installs ethers, ganache, solc
npm run chain          # terminal 1 — keep it open (local Ganache, chainId 1337)
npm run chain:deploy   # terminal 2 — once; saves CONTRACT_ADDRESS to .env
```
`.env` already holds `GANACHE_MNEMONIC`, `BLOCKCHAIN_RPC_URL`, `CHAIN_ID` and `PRIVATE_KEY` (first local test account). Never use these on a real network.
In the app, a patient links MetaMask on **Profile → Blockchain wallet** before sharing records.

## 3b. Run
```bash
cd backend
npm install
npm run dev
```
Open http://localhost:5000. Health check: http://localhost:5000/api/health
(shows which config groups are present — never values).

## 4. Tests
```bash
cd backend
npm test   # uses <MONGO_DB_NAME>_test
```

## 5. GitHub
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
