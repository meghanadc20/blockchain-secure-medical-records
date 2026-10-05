# MedChain — Database (MongoDB Atlas + Mongoose)

Follows the Backend Schema document. Field names are unchanged; approved **additions** are marked ➕.

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | name, email, passwordHash (hidden), role (PATIENT/DOCTOR/ADMIN), phone, ➕ walletAddress | email (unique), walletAddress (unique, sparse), role |
| `doctorProfiles` | userId → users, specialization, licenseNumber, hospital, verificationStatus (PENDING/APPROVED/REJECTED), verifiedAt | userId (unique), licenseNumber (unique), verificationStatus+createdAt |
| `doctorPatientRelations` | doctorId, patientId → users, status (PENDING/APPROVED/REJECTED/REVOKED), requestedAt, approvedAt, revokedAt | doctorId+patientId (unique), patientId+status, doctorId+status |
| `medicalRecords` | patientId, uploadedBy → users, title, recordType, description, fileName, storagePath, mimeType, fileSize, sha256Hash, ➕ encryptionIv, ➕ encryptionAuthTag, ➕ blockchainTransactionHash | patientId+createdAt, uploadedBy, storagePath (unique, sparse) |
| `consultations` | patientId, doctorId → users, recordId → medicalRecords, consultationDate, diagnosis, prescription, treatmentNotes | patientId+consultationDate, doctorId+consultationDate |
| `accessPermissions` | recordId, patientId, doctorId, status (GRANTED/REVOKED/EXPIRED), grantedAt, expiresAt (required), revokedAt, blockchainTransactionHash, ➕ revokeTransactionHash | recordId+doctorId (unique where GRANTED), doctorId+status+expiresAt, patientId+status |
| `auditLogs` | actorId, actorRole, action, patientId, doctorId, recordId, timestamp, ipAddress, blockchainTransactionHash, metadata | patientId+timestamp, actorId+timestamp, recordId+timestamp, action+timestamp |

## Rules enforced at the model level
- `passwordHash`, `storagePath`, `encryptionIv`, `encryptionAuthTag` are never included in JSON output.
- `accessPermissions.expiresAt` must be after `grantedAt`; `isActive()` treats a past `expiresAt` as inactive even before the status is updated to EXPIRED.
- Only one live `GRANTED` permission per doctor per record; revoked/expired history is kept.
- `auditLogs` are append-only: updates and deletes throw.

## Commands
```bash
npm run db:indexes   # create/sync indexes in MONGO_DB_NAME
npm test             # runs against <MONGO_DB_NAME>_test, cleared before and after
```
