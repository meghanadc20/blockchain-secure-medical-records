# API Reference

Base URL: `/api`

All responses are JSON:

```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": { "code": "PERMISSION_EXPIRED", "message": "...", "details": [ ... ] } }
```

Authenticated endpoints require `Authorization: Bearer <JWT>`.

| Status | Meaning |
|---|---|
| 200/201 | Success / created |
| 400 | Validation error |
| 401 | Missing, invalid or expired token |
| 403 | Authenticated but not allowed (role, verification, permission) |
| 404 | Not found |
| 409 | Conflict (e.g. duplicate email) |
| 500 | Internal error (no internals exposed) |

---

## Health

### `GET /api/health`
Public. Liveness check.

```json
{ "success": true, "data": { "status": "ok", "database": "connected", "environment": "development", "uptimeSeconds": 12,
  "configLoaded": { "database": false, "auth": false, "storage": false, "blockchain": false } } }
```
`configLoaded` reports only whether each group of variables is set — never their values.

---

## Authentication

Passwords are hashed with bcrypt. Tokens are HS256 JWTs (issuer/audience checked), lifetime `JWT_EXPIRES_IN`.
The user and role are re-loaded from the database on every request — a role claim in the token is never trusted alone.

Successful register/login response:
```json
{ "success": true, "data": {
  "token": "<JWT>", "expiresIn": "2h",
  "user": { "id": "…", "name": "…", "email": "…", "role": "DOCTOR", "phone": "…", "walletAddress": null,
            "doctorProfile": { "specialization": "…", "licenseNumber": "…", "hospital": "…", "verificationStatus": "PENDING", "verifiedAt": null } },
  "redirectTo": "/doctor/dashboard" } }
```
`doctorProfile` is present only for doctors.

### `POST /api/auth/register/patient`
Public. Body: `name`, `email`, `password` (8–72 chars, letters + numbers), `phone`. Role is always `PATIENT`; any `role` field is ignored.
→ `201` · `400 VALIDATION_ERROR` · `409 DUPLICATE_EMAIL` · `429 TOO_MANY_REQUESTS`

### `POST /api/auth/register/doctor`
Public. Body: patient fields + `specialization`, `licenseNumber`, `hospital`. Creates the user and a `PENDING` doctor profile in one transaction.
→ `201` · `400 VALIDATION_ERROR` · `409 DUPLICATE_EMAIL | DUPLICATE_LICENSE`

### `POST /api/auth/login`
Public. Body: `email`, `password`. One endpoint for all roles; `redirectTo` tells the client where to go (admins → `/admin/dashboard`).
Rate-limited to 10 attempts per IP+email per 15 minutes.
→ `200` · `400 VALIDATION_ERROR` · `401 INVALID_CREDENTIALS` (same message for unknown email and wrong password) · `429`

### `GET /api/auth/me`
Authenticated. Returns `{ user, redirectTo }`.

### `POST /api/auth/logout`
Authenticated. Audits the logout; the client discards its token (JWTs are stateless and short-lived).

### Auth errors (all protected endpoints)
| Status | Code | When |
|---|---|---|
| 401 | `NO_TOKEN` | Missing `Authorization: Bearer` header |
| 401 | `INVALID_TOKEN` | Bad signature, malformed, or account deleted |
| 401 | `TOKEN_EXPIRED` | Token past its expiry |
| 403 | `FORBIDDEN_ROLE` | Role not allowed for this endpoint (audited as `ACCESS_DENIED`) |
| 403 | `DOCTOR_NOT_VERIFIED` | Doctor is `PENDING` or `REJECTED` (audited) |

### Admin account
There is no admin registration endpoint. Create the internal admin from `.env`:
```bash
npm run seed:admin                      # create if missing
npm run seed:admin -- --reset-password  # update password from .env
```

---

## Profiles (all roles)

### `GET /api/profile`
Authenticated. Returns `{ user }` (same shape as login; doctors include `doctorProfile`).

### `PATCH /api/profile`
Authenticated. Editable: `name`, `phone`; doctors also `specialization`, `hospital`.
`email`, `role`, `password`, `licenseNumber`, `verificationStatus`, `walletAddress` → `400 FIELD_NOT_EDITABLE`.
→ `200 { user }` · `400 VALIDATION_ERROR | NOTHING_TO_UPDATE` · audited as `PROFILE_UPDATED`.

---

## Admin — doctor verification
All routes require a valid JWT **and** role `ADMIN` (`401` / `403 FORBIDDEN_ROLE` otherwise).
There are no admin endpoints for medical records, consultations or permissions.

Doctor view: `{ doctorId, name, email, phone, specialization, licenseNumber, hospital, verificationStatus, verifiedAt, registeredAt, updatedAt }`

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/stats` | `{ doctors: { pending, approved, rejected, total }, patients }` — counts only |
| GET | `/api/admin/doctors?status=PENDING\|APPROVED\|REJECTED&q=&page=&limit=` | Paginated list (`{ items, total, page, limit, pages }`). Pending oldest first. `q` searches name, email, licence, hospital, specialization |
| GET | `/api/admin/doctors/:doctorId` | One doctor → `404 DOCTOR_NOT_FOUND`, `400 INVALID_ID` |
| PATCH | `/api/admin/doctors/:doctorId/approve` | → `APPROVED`, sets `verifiedAt`; audited `DOCTOR_APPROVED` |
| PATCH | `/api/admin/doctors/:doctorId/reject` | Body `{ reason? }` (≤500 chars) → `REJECTED`; audited `DOCTOR_REJECTED` with reason |

Approving/rejecting a doctor already in that status → `409 ALREADY_IN_STATUS`. Updates are conditional (`409 CONCURRENT_UPDATE` if changed meanwhile).

---

## Doctor–patient relationships (Module 1)

A verified doctor requests access to a patient; the patient approves, rejects or revokes.
Record-level, time-limited permissions (Module 4) can only exist while the relationship is `APPROVED`.

Relation view: `{ id, status, requestedAt, approvedAt, revokedAt, updatedAt, doctor?: { id, name, email, specialization, hospital, licenseNumber, verificationStatus }, patient?: { id, name, email } }`

| Method | Path | Who | Result |
|---|---|---|---|
| POST | `/api/relations/requests` | **Verified** doctor | Body `{ patientEmail }`. `201` new / `200` re-opened after REJECTED or REVOKED. `404 PATIENT_NOT_FOUND`, `409 REQUEST_ALREADY_PENDING`, `409 ALREADY_APPROVED`, `403 DOCTOR_NOT_VERIFIED`. Audited `ACCESS_REQUEST` |
| GET | `/api/relations/doctor?status=` | Doctor | Own requests/patients (`status` may be comma-separated) |
| GET | `/api/relations/patient?status=` | Patient | Requests and authorised doctors for this patient |
| PATCH | `/api/relations/:relationId/approve` | Owning patient | `PENDING → APPROVED`. `409 DOCTOR_NOT_VERIFIED` if the doctor lost verification. Audited `ACCESS_GRANTED` |
| PATCH | `/api/relations/:relationId/reject` | Owning patient | `PENDING → REJECTED`. Audited `ACCESS_REJECTED` |
| PATCH | `/api/relations/:relationId/revoke` | Owning patient | `APPROVED → REVOKED`; also revokes every live record permission for that doctor (`permissionsRevoked` in response). Audited `ACCESS_REVOKED` |

- Any other transition → `409 INVALID_STATUS_TRANSITION`.
- A relation belonging to another patient returns `404 RELATION_NOT_FOUND` (does not reveal it exists) and is audited as `ACCESS_DENIED`.
- Doctors cannot approve their own requests (`403`); admins cannot use these endpoints (`403`).

---

## Medical records — metadata (Module 2)

Record view: `{ id, patientId, title, recordType, description, fileName, mimeType, fileSize, hasFile, sha256Hash, blockchainTransactionHash, uploadedBy: { id, name, role }, createdAt, updatedAt }`.
Storage paths and encryption parameters are never returned.
`recordType`: `LAB_REPORT | IMAGING | PRESCRIPTION | DISCHARGE_SUMMARY | CONSULTATION_NOTE | VACCINATION | OTHER`.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/records?type=&q=&page=&limit=` | Patient | Own records, newest first |
| GET | `/api/records/:recordId` | Owning patient | `404 RECORD_NOT_FOUND` for missing or someone else's record (audited `ACCESS_DENIED`) |
| PATCH | `/api/records/:recordId` | Owning patient | Editable: `title`, `recordType`, `description`. File/hash fields → `400 FIELD_NOT_EDITABLE`. Audited `RECORD_UPDATED` |

Uploading files (Module 3) and doctor access through permissions (Module 4) are added later.

## Consultations (Module 2)

Consultation view: `{ id, patient: { id, name, email }, doctor: { id, name, specialization, hospital }, recordId, consultationDate, diagnosis, prescription, treatmentNotes, createdAt }`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/consultations` | **Verified** doctor with an **APPROVED** relationship to the patient | Body: `patientId`, `consultationDate` (not in the future), at least one of `diagnosis` (≤5000), `prescription` (≤5000), `treatmentNotes` (≤10000); optional `recordId` (must belong to the patient). `403 PERMISSION_DENIED` without an approved relationship. Audited `CONSULTATION_ADDED` (no medical text in the audit log) |
| GET | `/api/consultations?patientId=&doctorId=&page=&limit=` | Patient: all own (filter `doctorId`). Doctor: only ones they authored, only for patients currently APPROVED (filter `patientId`, `403` if not approved) | Newest first. Doctor reads audited `RECORD_VIEW` |
| GET | `/api/consultations/:consultationId` | Owning patient, or authoring doctor while APPROVED | Other doctors / patients → `404`. Author after revocation → `403 PERMISSION_REVOKED` |

Consultations are append-only: there are no update or delete endpoints. Corrections are added as a new consultation. Admins have no access.

## Patient history timeline (Module 2)

### `GET /api/history?type=ALL|RECORD|CONSULTATION&from=YYYY-MM-DD&to=YYYY-MM-DD`
Patient only (own data). Returns `{ items: [{ kind: 'RECORD' | 'CONSULTATION', date, record? , consultation? }], counts: { records, consultations }, truncated }`, newest first (records by upload date, consultations by consultation date; `to` is inclusive). Max 500 items.

---

## Secure file storage (Module 3)

**Flow on upload:** original file → SHA-256 fingerprint (stored as `sha256Hash`) → AES-256-GCM encryption with a fresh random IV (IV + auth tag stored server-side only) → ciphertext uploaded to the **private** Supabase bucket at `{patientId}/{recordId}/encrypted-file` → metadata saved in MongoDB.
If storage fails nothing is saved; if the database write fails the uploaded object is deleted.
Hashing is an integrity fingerprint, not encryption. Nothing is stored on a blockchain in this module.

### `POST /api/records` (multipart/form-data)
Fields: `file` (PDF/JPEG/PNG, ≤10 MB — the real content is checked by magic bytes), `title` (2–150), `recordType`, `description?` (≤2000), `patientId` (required for doctors).
- Patient: uploads for themselves (a different `patientId` → `403`).
- Doctor: must be verified **and** have an APPROVED relationship with `patientId`. The record belongs to the patient; the doctor still needs a record permission (Module 4) to open it.

→ `201 { record }` · `400 FILE_REQUIRED | UNSUPPORTED_FILE_TYPE | FILE_CONTENT_MISMATCH | VALIDATION_ERROR | INVALID_UPLOAD` · `413 FILE_TOO_LARGE` · `403 PERMISSION_DENIED | DOCTOR_NOT_VERIFIED` · `502 STORAGE_ERROR`. Audited `RECORD_UPLOAD` (type and size only — no file name or content).

### `GET /api/records/:recordId/file?disposition=attachment|inline`
Controlled retrieval: access check → download ciphertext → decrypt (the GCM auth tag rejects any modified ciphertext) → **SHA-256 integrity check against the on-chain fingerprint (Module 6)** → stream with `Cache-Control: no-store`. Tampered files are never delivered (`409 TAMPER_DETECTED`).
- Owning patient: allowed. Other patients: `404`. Doctors: only with a live record permission (see Module 4) — otherwise `403 PERMISSION_DENIED | PERMISSION_EXPIRED | PERMISSION_REVOKED | DOCTOR_NOT_VERIFIED`. Admins: `403`.
- `404 FILE_NOT_FOUND` if the record has no file or the object is missing · `409 TAMPER_DETECTED` if the ciphertext, the file content or the stored hash was altered (audited) · `502 STORAGE_ERROR`.
- Successful reads audited `RECORD_VIEW` (`metadata.type = FILE`).

### Storage setup
```bash
npm run storage:setup   # creates/enforces the private bucket (SUPABASE_BUCKET), 11 MB limit, octet-stream only
```
Tests use a separate `medical-records-test` bucket that is created and deleted by the test run.

---

## Record sharing & access control (Module 4)

A doctor can read a patient's record (metadata via `GET /api/records/:id`, file via `GET /api/records/:id/file`) **only when all hold**:
1. the doctor is verified (`APPROVED` by the admin),
2. the doctor–patient relationship is `APPROVED`,
3. a permission for that record and doctor has status `GRANTED`,
4. `expiresAt` is in the future.

Checks run on every request, so revocation and expiry take effect immediately. A `GRANTED` permission found past its expiry is marked `EXPIRED` at that moment (audited `ACCESS_EXPIRED`, `detectedBy: ACCESS_CHECK`); a background sweep every 60 s does the same for idle permissions (`actorRole: SYSTEM`, `detectedBy: SWEEP`). Revoking the doctor–patient relationship revokes all of that doctor's record permissions for the patient.

Doctor-to-doctor sharing is patient-mediated: each doctor needs their own approved relationship and their own grant.

Permission view: `{ id, status: ACTIVE|EXPIRED|REVOKED, storedStatus: GRANTED|EXPIRED|REVOKED, grantedAt, expiresAt, revokedAt, blockchainTransactionHash, revokeTransactionHash, record: { id, title, recordType, hasFile, fileName, createdAt }, doctor: { id, name, email }, patient: { id, name, email } }`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/permissions` | Owning patient | Body `{ recordId, doctorId, expiresAt }`; expiry 5 min – 1 year ahead. `201`. `404 RECORD_NOT_FOUND / DOCTOR_NOT_FOUND`, `409 DOCTOR_NOT_VERIFIED / RELATION_NOT_APPROVED / ALREADY_GRANTED`, `400 VALIDATION_ERROR`. Audited `ACCESS_GRANTED` (`scope: RECORD`) |
| PATCH | `/api/permissions/:permissionId/revoke` | Owning patient | `GRANTED → REVOKED`. `409 INVALID_STATUS_TRANSITION` if already revoked/expired; another patient's → `404`. Audited `ACCESS_REVOKED` |
| GET | `/api/permissions?recordId=&doctorId=&status=ACTIVE\|EXPIRED\|REVOKED` | Patient | Own grants, newest first |
| GET | `/api/permissions/doctor?status=` | Verified doctor | Records shared with this doctor (patients with an APPROVED relationship only) |

`GET /api/records` (patient) now also returns `activeShares` per record.
Denied reads are audited `ACCESS_DENIED` with `reason` = `PERMISSION_DENIED | PERMISSION_EXPIRED | PERMISSION_REVOKED | NOT_RECORD_OWNER`.

---

## Blockchain (Module 5)

See [BLOCKCHAIN.md](BLOCKCHAIN.md) for the contract and flows.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/blockchain/config` | Authenticated | `{ contractAddress, chainId, rpcUrl, abi, localTestNetwork }` — public info only. `503 BLOCKCHAIN_UNAVAILABLE` |
| POST | `/api/blockchain/wallet/challenge` | Patient | Body `{ address }` → `{ message, challengeToken }` (10 min) |
| POST | `/api/blockchain/wallet/link` | Patient | Body `{ address, signature, challengeToken }`. Verifies the signature, registers the wallet on-chain, funds it with local **test** ether. `400 SIGNATURE_INVALID / CHALLENGE_INVALID`, `409 WALLET_IN_USE`. Audited `WALLET_LINKED` with tx hash |
| POST | `/api/permissions/prepare` | Patient | Same body/validation as a grant. Requires a linked wallet (`409 WALLET_NOT_LINKED`), anchors the record if pending. Returns `{ contractAddress, chainId, wallet, method: 'grantAccess', args: [recordKey, doctorKey, expiresAtSeconds], expiresAt }` |
| POST | `/api/permissions` | Patient | Now **requires** `txHash` of the signed `grantAccess`. Verified from the receipt (`400 BLOCKCHAIN_TX_INVALID`, `409 TX_ALREADY_USED`, `409 BLOCKCHAIN_STATE_MISMATCH`). Stores `blockchainTransactionHash` |
| GET | `/api/permissions/:id/revoke/prepare` | Patient | `{ needsChainTx: false }` or the `revokeAccess` call to sign |
| PATCH | `/api/permissions/:id/revoke` | Patient | Body `{ txHash }` required when the grant is active on-chain (`400 TX_REQUIRED`). Stores `revokeTransactionHash` |
| GET | `/api/relations/:id/revoke/prepare` | Patient | `{ needsChainTx }` and, if needed, the `revokeDoctor` call |
| PATCH | `/api/relations/:id/revoke` | Patient | Body `{ txHash }` required if the doctor holds active on-chain grants |

Upload responses include `anchoring: 'ANCHORED' | 'PENDING'`; records carry `blockchainTransactionHash` once anchored (audited `RECORD_HASH_ANCHORED`).
Doctor reads additionally fail with `403 PERMISSION_NOT_ON_CHAIN`, `403 BLOCKCHAIN_PERMISSION_DENIED` or `503 BLOCKCHAIN_UNAVAILABLE`.
`GET /api/health` → `data.blockchain`: `{ configured, reachable, chainId, localTestNetwork, contractAddress, contractDeployed, signerIsOwner, blockNumber }`.

---

## Integrity verification (Module 6)

```
stored ciphertext → AES-256-GCM decrypt → retrieved original → SHA-256 → currentHash
currentHash == trusted hash (on-chain fingerprint anchored at upload)  → INTEGRITY_VERIFIED
otherwise                                                              → TAMPER_DETECTED
```
Tampering is reported with a `stage`:
- `DECRYPTION` — the encrypted object in storage was modified (GCM authentication tag mismatch);
- `FILE_HASH` — the decrypted file's SHA-256 differs from the trusted fingerprint (e.g. an insider re-encrypted different content, even if they also rewrote the MongoDB hash);
- `METADATA_HASH` — the file matches the chain, but the MongoDB copy of the hash was altered.

If the record is not anchored yet, or the chain is unreachable, the MongoDB hash is used and the result says `trustedSource: "DATABASE"` with a `warning`.
Hashing is a fingerprint, not encryption; encryption (AES-256-GCM) is separate.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/records/:recordId/verify` | Owning patient, or doctor with live access | `{ integrity: { status, algorithm, currentHash, storedHash, blockchainHash, trustedSource, anchorTransactionHash, stage?, reason?, warning?, checkedAt } }` |
| GET | `/api/records/:recordId/file` | (as above) | Headers `X-Integrity-Status`, `X-Integrity-Source`, `X-File-SHA256` |

Every check is audited `HASH_VERIFICATION` (`metadata.result`, `trustedSource`, `purpose: VERIFY | DOWNLOAD`); tampering also writes `TAMPER_DETECTED`.
Record lists (`GET /api/records`, `GET /api/permissions/doctor`) include `lastIntegrityCheck: { status, trustedSource, checkedAt }`.

## Audit trail (Module 6)

Audit logs are append-only (updates and deletes are blocked at the model level).

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/audit?category=&action=&recordId=&from=&to=&page=&limit=` | Patient | All events about the patient's data, newest first. `category`: `ACCESS`, `VIEWS`, `SECURITY`, `INTEGRITY`, `RECORDS`, `ACCOUNT`. Entry: `{ id, action, timestamp, actor: { role, name }, doctor, record: { id, title }, blockchainTransactionHash, details }` — IP addresses are not exposed and `details` is a safe whitelist |
| GET | `/api/audit/summary` | Patient | `{ last30Days: { doctorViews, deniedAttempts, integrityChecks }, tamperAlerts }` |

Doctors and admins have no access to patients' audit trails (`403`).
