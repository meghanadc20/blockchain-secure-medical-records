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
{ "success": true, "data": { "status": "ok", "environment": "development", "uptimeSeconds": 12,
  "configLoaded": { "database": false, "auth": false, "storage": false, "blockchain": false } } }
```
`configLoaded` reports only whether each group of variables is set — never their values.
