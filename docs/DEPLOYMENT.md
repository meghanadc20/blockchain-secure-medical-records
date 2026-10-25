# Deploying MedChain for a public demo (₹0)

| Piece | Free service used |
|---|---|
| Backend **and** frontend (one web service) | Render free web service (`*.onrender.com`) |
| Database | Existing MongoDB Atlas free cluster — separate database `medchain_demo` |
| Encrypted files | Existing Supabase Storage private bucket `medical-records` |
| Blockchain | Ethereum **Sepolia** test network via a free Alchemy RPC URL |
| Gas | Free Sepolia test ETH from a faucet (no real money) |

Local development is unchanged: Ganache (`npm run chain`) with chain id 1337 and the values in `.env`.
The deployment values live in **separate** `.env` keys (`SEPOLIA_*`, `DEMO_MONGO_DB_NAME`, `RENDER_*`)
and are turned into a git-ignored `.env.render` that you upload to Render. No secret is ever
committed, printed, pasted into chat, or sent to the browser (the Alchemy URL contains an API key,
so `/api/blockchain/config` never returns it on Sepolia; MetaMask reaches Sepolia on its own).

## 1. Free Sepolia RPC URL (Alchemy)
1. Sign up at <https://www.alchemy.com> (free plan, no card).
2. Create an app → chain **Ethereum**, network **Sepolia**.
3. Copy its HTTPS URL (`https://eth-sepolia.g.alchemy.com/v2/…`) and put it in `.env`:
   `SEPOLIA_RPC_URL=<that URL>`

## 2. Platform wallet + free test ETH
```bash
cd backend
npm run chain:sepolia-wallet     # creates SEPOLIA_PRIVATE_KEY in .env, prints only the ADDRESS
```
Fund the printed address from a free Sepolia faucet, for example
<https://faucets.chain.link/sepolia>, <https://faucet.quicknode.com/ethereum/sepolia> or the
browser-mining faucet <https://sepolia-faucet.pk910.de/> (these don't need mainnet ETH).
About **0.05–0.1 Sepolia ETH** is plenty for a demo. Run `npm run chain:sepolia-wallet` again to see the balance.

## 3. Deploy the contract to Sepolia
```bash
npm run chain:deploy:sepolia     # refuses any chain except 11155111; saves SEPOLIA_CONTRACT_ADDRESS
```

## 4. Prepare the demo database (existing data is not touched)
```bash
MONGO_DB_NAME=medchain_demo npm run db:indexes
MONGO_DB_NAME=medchain_demo npm run seed:admin
```
(PowerShell: `$env:MONGO_DB_NAME="medchain_demo"; npm run db:indexes; npm run seed:admin`.)

In Atlas → **Network Access**, allow `0.0.0.0/0` (Render's free plan has no fixed IP).

## 5. Build the Render environment file
```bash
npm run render:env               # writes ../.env.render (git-ignored), prints variable NAMES only
```

## 6. Create the Render web service
1. Sign in at <https://render.com> with GitHub (free "Hobby" workspace).
2. **New → Web Service** → pick `blockchain-secure-medical-records`.
3. Settings: Branch `main`, Root Directory *(empty)*, Runtime **Node**,
   Build Command `cd backend && npm ci --omit=dev`, Start Command `cd backend && npm start`,
   Instance Type **Free**.
4. **Environment Variables → Add from .env** → paste the contents of `.env.render` from your own
   computer (open it in Notepad) → Add. Don't set `PORT`; Render provides it.
5. **Advanced → Health Check Path**: `/api/health`.
6. **Deploy Web Service**. When it says *Live*, open `https://<name>.onrender.com/api/health`
   — `database` should be `connected` and `blockchain.reachable` `true`.
7. Optional: put that URL in `.env` as `RENDER_URL`, rerun `npm run render:env`, and update `CORS_ORIGIN` on Render.

(`render.yaml` in the repo describes the same service as a Blueprint.)

## 7. MetaMask for demo users
- MetaMask → network list → *Show test networks* → **Sepolia**.
- Each patient wallet needs a little Sepolia ETH for sharing/revoking. When a wallet is linked the
  platform sends it `TESTNET_WALLET_FUNDING_ETH` (default 0.005) from the platform wallet; set it
  empty to disable, and use a faucet instead.

## Free-tier behaviour to expect
- The service **sleeps after 15 minutes** without traffic; the next visit takes about a minute to
  wake. Open the site a few minutes before a demo.
- 750 free instance hours per month (enough for one always-on service).
- Sepolia blocks take ~12 s, so uploads, wallet linking, sharing and revoking take 15–60 s each.
- Supabase pauses free projects after about a week of inactivity — restore it from the Supabase
  dashboard before a demo if needed.
- The expiry sweep only runs while the service is awake; expired access is still denied at
  request time (lazy expiry + the on-chain expiry check).
