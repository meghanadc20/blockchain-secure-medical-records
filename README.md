# Blockchain-Based Secure Medical Data Sharing System

A patient-controlled platform for secure, auditable and integrity-verified medical data sharing.

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (served by Express) |
| Backend | Node.js, Express.js |
| Database | MongoDB Atlas + Mongoose (metadata only) |
| File storage | Supabase Storage (private bucket, AES-256-GCM encrypted files) |
| Auth | JWT + bcryptjs |
| Blockchain | Solidity smart contract on Ganache, Ethers.js, MetaMask (patient grant/revoke) |
| Integrity | SHA-256 |

Medical files are **never** stored on the blockchain. The chain stores only pseudonymous identifiers, record hashes, permissions (with expiry) and grant/revoke events.

## Project structure

```
backend/      Express API (src/config, models, middleware, controllers, routes, services, utils)
blockchain/   Solidity contract + deploy scripts
frontend/     Public pages + patient/, doctor/, admin/ dashboards
docs/         API.md, SETUP.md, TESTING.md
```

## Quick start

See [docs/SETUP.md](docs/SETUP.md).

```bash
cp .env.example .env      # fill in values
cd backend
npm install
npm run dev               # http://localhost:5000
```

## Build progress

- [x] Phase 1 — Project setup
- [ ] Phase 2 — Database
- [ ] Phase 3 — Authentication
- [ ] Phase 4 — Module 1: User, Doctor & Patient Management
- [ ] Phase 5 — Module 2: Medical Records & Patient History
- [ ] Phase 6 — Module 3: Secure Cloud Storage
- [ ] Phase 7 — Module 4: Sharing & Access Control
- [ ] Phase 8 — Module 5: Blockchain & Smart Contract
- [ ] Phase 9 — Module 6: Integrity & Audit
- [ ] Phase 10 — Module 7: Time-limited access
- [ ] Phase 11 — Testing
- [ ] Phase 12 — Final integration
