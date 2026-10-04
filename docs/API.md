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
