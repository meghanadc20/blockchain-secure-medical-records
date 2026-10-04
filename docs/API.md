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
