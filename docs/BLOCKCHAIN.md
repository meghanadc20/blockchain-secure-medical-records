# MedChain — Blockchain layer (Module 5)

**Network:** a LOCAL Ganache test chain only (chainId 1337, `http://127.0.0.1:8545`). No real network, no real funds.
The deploy script and the backend's test-ether funding refuse to run on any chain other than 1337/31337.

## What goes on-chain — and what never does
| On-chain | Never on-chain |
|---|---|
| `patientKey = keccak256("patient:<id>")`, `doctorKey`, `recordKey` (pseudonymous) | Medical files, images, PDFs |
| SHA-256 fingerprint of each record's original file | Diagnoses, prescriptions, treatment notes |
| Patient wallet address (after signature proof) | Names, emails, phone numbers |
| Grants: granted-at, expires-at, revoked-at | Any medical history |

## Contract: `blockchain/contracts/MedicalAccessControl.sol`
| Function | Who | Purpose |
|---|---|---|
| `registerPatientWallet(patientKey, wallet)` | owner (backend) | Link a wallet whose ownership was proven by signature |
| `registerRecord(recordKey, patientKey, fileHash)` | owner | Anchor a record fingerprint (can never be overwritten) |
| `grantAccess(recordKey, doctorKey, expiresAt)` | **patient wallet only** | Time-limited access to one record for one doctor |
| `revokeAccess(recordKey, doctorKey)` | **patient wallet only** | End a grant immediately |
| `revokeDoctor(patientKey, doctorKey)` | **patient wallet only** | Invalidate every grant this patient gave the doctor (epoch bump) |
| `hasAccess(recordKey, doctorKey)` | view | exists ∧ not revoked ∧ current epoch ∧ `block.timestamp < expiresAt` |

Events: `PatientWalletRegistered`, `RecordRegistered`, `AccessGranted`, `AccessRevoked`, `DoctorRevoked`.

## Hybrid signing
- **Backend (contract owner, `PRIVATE_KEY`)** signs only wallet registration and fingerprint anchoring.
- **Patient (MetaMask)** signs every grant and revocation. The backend never trusts the browser: it loads the transaction **receipt**, checks it succeeded, was sent to our contract, came from the patient's linked wallet, and contains the exact event (record, doctor, expiry). Each transaction hash can be used once.

## Flows
```
Share:   POST /api/permissions/prepare → MetaMask grantAccess() → POST /api/permissions {txHash} → receipt verified → stored
Revoke:  GET  /api/permissions/:id/revoke/prepare → MetaMask revokeAccess() → PATCH .../revoke {txHash} → verified
Doctor:  GET  /api/relations/:id/revoke/prepare → MetaMask revokeDoctor() (if any on-chain grant is active) → PATCH .../revoke {txHash}
Read:    JWT → verified doctor → APPROVED relation → MongoDB permission (GRANTED, unexpired) → contract hasAccess() → file
```
Every check fails closed: if the chain cannot be reached, doctor reads return `503 BLOCKCHAIN_UNAVAILABLE`.
Uploads still succeed when the chain is down (anchoring `PENDING`); the fingerprint is anchored automatically before the record can be shared.

## Commands (run in `backend/`)
```bash
npm run chain           # start local Ganache (keep the window open); state persists in blockchain/.ganache-db
npm run chain:deploy    # deploy the contract, saves CONTRACT_ADDRESS to .env (keys never printed)
npm run chain:compile   # recompile the contract → src/blockchain/MedicalAccessControl.json
```
Ganache may print *"This version of µWS is not compatible… Falling back to a NodeJS implementation"* — harmless.

## MetaMask
Patients link a wallet on **Profile → Blockchain wallet**: MetaMask switches to (or adds) *Ganache (local test network)*, the patient signs a free message, the backend registers the wallet on-chain and sends it 1 **test** ETH for fees.
