// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MedicalAccessControl
 * @notice On-chain registry for the Blockchain-Based Secure Medical Data Sharing System.
 *
 * Stores ONLY:
 *  - pseudonymous identifiers (keccak256 of database ids) for patients, doctors and records,
 *  - the SHA-256 fingerprint of each record's original file,
 *  - patient wallet addresses (registered by the platform after a signature check),
 *  - time-limited access grants and their revocation.
 *
 * It NEVER stores medical files, diagnoses, prescriptions, names or any other medical content.
 *
 * Roles:
 *  - owner (platform backend): registers patient wallets and record fingerprints.
 *  - patient wallet: the ONLY address that can grant or revoke access to that patient's records.
 */
contract MedicalAccessControl {
    struct Record {
        bytes32 patientKey;
        bytes32 fileHash;      // SHA-256 of the original (unencrypted) file
        uint64 registeredAt;
        bool exists;
    }

    struct Grant {
        uint64 grantedAt;
        uint64 expiresAt;
        uint64 revokedAt;      // 0 = not revoked
        uint64 epoch;          // doctor epoch at grant time (see revokeDoctor)
        bool exists;
    }

    address public immutable owner;

    mapping(bytes32 => Record) private records;                                   // recordKey => Record
    mapping(bytes32 => address) public patientWallets;                            // patientKey => wallet
    mapping(bytes32 => mapping(bytes32 => Grant)) private grants;                 // recordKey => doctorKey => Grant
    mapping(bytes32 => mapping(bytes32 => uint64)) public doctorEpoch;            // patientKey => doctorKey => epoch

    event PatientWalletRegistered(bytes32 indexed patientKey, address indexed wallet, uint64 timestamp);
    event RecordRegistered(bytes32 indexed recordKey, bytes32 indexed patientKey, bytes32 fileHash, uint64 timestamp);
    event AccessGranted(bytes32 indexed recordKey, bytes32 indexed doctorKey, address indexed patientWallet, uint64 grantedAt, uint64 expiresAt);
    event AccessRevoked(bytes32 indexed recordKey, bytes32 indexed doctorKey, address indexed patientWallet, uint64 revokedAt);
    event DoctorRevoked(bytes32 indexed patientKey, bytes32 indexed doctorKey, address indexed patientWallet, uint64 newEpoch, uint64 timestamp);

    error NotOwner();
    error NotPatientWallet();
    error ZeroAddress();
    error RecordAlreadyRegistered();
    error RecordNotRegistered();
    error InvalidHash();
    error InvalidExpiry();
    error AlreadyActive();
    error NotActive();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ------------------------------------------------------------------ owner

    /// @notice Links a patient's wallet (after the platform verified a signature from it). Re-linking replaces the old wallet.
    function registerPatientWallet(bytes32 patientKey, address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        patientWallets[patientKey] = wallet;
        emit PatientWalletRegistered(patientKey, wallet, uint64(block.timestamp));
    }

    /// @notice Anchors a record's SHA-256 fingerprint. A fingerprint can never be overwritten.
    function registerRecord(bytes32 recordKey, bytes32 patientKey, bytes32 fileHash) external onlyOwner {
        if (records[recordKey].exists) revert RecordAlreadyRegistered();
        if (fileHash == bytes32(0)) revert InvalidHash();
        records[recordKey] = Record(patientKey, fileHash, uint64(block.timestamp), true);
        emit RecordRegistered(recordKey, patientKey, fileHash, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------- patient

    /// @notice Grants one doctor time-limited access to one record. Only the record owner's wallet may call this.
    function grantAccess(bytes32 recordKey, bytes32 doctorKey, uint64 expiresAt) external {
        Record storage r = records[recordKey];
        if (!r.exists) revert RecordNotRegistered();
        if (msg.sender != patientWallets[r.patientKey]) revert NotPatientWallet();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (_isActive(recordKey, doctorKey, r.patientKey)) revert AlreadyActive();

        grants[recordKey][doctorKey] = Grant(uint64(block.timestamp), expiresAt, 0, doctorEpoch[r.patientKey][doctorKey], true);
        emit AccessGranted(recordKey, doctorKey, msg.sender, uint64(block.timestamp), expiresAt);
    }

    /// @notice Revokes an active grant immediately.
    function revokeAccess(bytes32 recordKey, bytes32 doctorKey) external {
        Record storage r = records[recordKey];
        if (!r.exists) revert RecordNotRegistered();
        if (msg.sender != patientWallets[r.patientKey]) revert NotPatientWallet();
        if (!_isActive(recordKey, doctorKey, r.patientKey)) revert NotActive();

        grants[recordKey][doctorKey].revokedAt = uint64(block.timestamp);
        emit AccessRevoked(recordKey, doctorKey, msg.sender, uint64(block.timestamp));
    }

    /// @notice Invalidates EVERY existing grant this patient gave to this doctor (used when the patient revokes the doctor entirely).
    function revokeDoctor(bytes32 patientKey, bytes32 doctorKey) external {
        if (msg.sender != patientWallets[patientKey]) revert NotPatientWallet();
        uint64 next = doctorEpoch[patientKey][doctorKey] + 1;
        doctorEpoch[patientKey][doctorKey] = next;
        emit DoctorRevoked(patientKey, doctorKey, msg.sender, next, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ views

    /// @notice True only if a grant exists, is not revoked, is from the current doctor epoch and has not expired.
    function hasAccess(bytes32 recordKey, bytes32 doctorKey) external view returns (bool) {
        Record storage r = records[recordKey];
        if (!r.exists) return false;
        return _isActive(recordKey, doctorKey, r.patientKey);
    }

    function getRecord(bytes32 recordKey) external view returns (bytes32 patientKey, bytes32 fileHash, uint64 registeredAt, bool exists) {
        Record storage r = records[recordKey];
        return (r.patientKey, r.fileHash, r.registeredAt, r.exists);
    }

    function getGrant(bytes32 recordKey, bytes32 doctorKey)
        external
        view
        returns (uint64 grantedAt, uint64 expiresAt, uint64 revokedAt, uint64 epoch, bool exists)
    {
        Grant storage g = grants[recordKey][doctorKey];
        return (g.grantedAt, g.expiresAt, g.revokedAt, g.epoch, g.exists);
    }

    function _isActive(bytes32 recordKey, bytes32 doctorKey, bytes32 patientKey) private view returns (bool) {
        Grant storage g = grants[recordKey][doctorKey];
        return g.exists
            && g.revokedAt == 0
            && g.epoch == doctorEpoch[patientKey][doctorKey]
            && block.timestamp < g.expiresAt;
    }
}
