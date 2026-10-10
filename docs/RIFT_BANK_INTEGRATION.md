# RIFT Bank & RIFT Integration Specification
**Document Version:** 1.0.0  
**Target Specification:** RIFT Real-time Interchain Fraud Tracking (FUSION 2026, CSB-01)  
**Parent Ecosystem:** RIFT Security Architecture  
**Authoritative Scope:** Financial Simulator Bridge & Cross-Chain Authorization Adapter

---

## 1. Architectural Boundaries and Responsibility Matrix

| Responsibility Domain | RIFT Bank Owner | RIFT Security Platform Owner |
| :--- | :--- | :--- |
| **Fictional Clients & Personas** | **YES** (Ledger / Client DB) | NO |
| **Simulated Accounts & Balances** | **YES** (Internal DB) | NO |
| **Double-Entry Financial Ledger** | **YES** (Authoritative) | NO |
| **Transfer Intent Generation** | **YES** (Initiator) | NO |
| **Cross-Chain Exploit Detection** | NO | **YES** (RIFT WATCH / Core) |
| **Real-time Event Ingestion** | NO | **YES** |
| **Transaction Risk Assessment** | NO | **YES** (Autonomous scoring) |
| **Security Alerts & Anomaly Scoring** | NO | **YES** |
| **RIFT KEY Authorization Protocol** | NO (Submits & observes) | **YES** (Enforces policy) |
| **Blockchain Execution Policy** | NO | **YES** |
| **Local-Chain Transaction Submission** | NO | **YES** (Designated node) |
| **Forensic Evidence & Investigation** | NO (Consumes receipts) | **YES** (Investigation DB) |

### Strict Operational Principles:
1. **No Duplicate Detection Engine:** RIFT Bank shall not score risk or run independent heuristic fraud detection.
2. **No Fabricated Chain Hashes:** RIFT Bank shall never generate synthetic tx hashes or pretend execution succeeded.
3. **Graceful Offline Degradation:** If RIFT is offline, RIFT Bank displays `RIFT CONNECTION UNAVAILABLE`, allows read-only ledger browsing, and blocks cross-chain executions.
4. **Idempotency Guarantee:** Every transfer intent carries a client-generated UUID `idempotency_key`.

---

## 2. API Contract & Endpoints

Base URL: Configured via `RIFT_API_BASE_URL` (Default local development: `http://localhost:8001/api/v1/rift`)  
Authentication: HTTP Header `X-RIFT-API-Key: <configured_key>`

### 2.1 Health & Status Check
- **Endpoint:** `GET /health`
- **Response:**
```json
{
  "status": "healthy",
  "service": "RIFT Real-time Interchain Fraud Tracking",
  "version": "2026.1-CSB01",
  "chains_supported": [31337, 31338],
  "policy_engine_active": true,
  "rift_key_service": "online"
}
```

### 2.2 Submit Transfer Intent
- **Endpoint:** `POST /transfers/intent`
- **Request Body (`TransferIntentRequest`):**
```json
{
  "transfer_id": "tx_req_AlexanderVeyron_20261009_001",
  "idempotency_key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "client_id": "cli_alexander_veyron",
  "source_account_id": "acc_veyron_treasury_usd",
  "destination_account_id": "ext_beneficiary_swiss_vault",
  "asset": "TEST_USD",
  "amount_base_units": "25000000000",
  "amount_display": "250000000.00",
  "source_chain_id": 31337,
  "destination_chain_id": 31338,
  "destination_address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "requested_by": "Alexander Veyron (Authorized Client)"
}
```

- **Response (`TransferIntentResponse`):**
```json
{
  "rift_operation_id": "rift_op_8fa21c43",
  "transfer_id": "tx_req_AlexanderVeyron_20261009_001",
  "status": "AWAITING_AUTHORIZATION",
  "risk_assessment": {
    "risk_score": 0.42,
    "risk_level": "ELEVATED",
    "factors": [
      "High value transaction exceeds $100M threshold",
      "Cross-chain bridge interaction between Chain 31337 and Chain 31338",
      "Known counterparty liquidity pool"
    ],
    "policy_matched": "POL_HIGH_VALUE_THRESHOLD_RIFT_KEY_MANDATORY"
  },
  "authorization_requirements": {
    "required": true,
    "mechanism": "RIFT_KEY_MFA",
    "auth_url": "/authorization/rift-key/rift_op_8fa21c43",
    "expires_at": "2026-10-09T14:30:00Z"
  },
  "created_at": "2026-10-09T13:30:00Z"
}
```

### 2.3 Authorize Transfer (RIFT KEY)
- **Endpoint:** `POST /operations/{rift_operation_id}/authorize`
- **Request Body:**
```json
{
  "auth_token": "RIFT-KEY-SEC-AUTH-773821",
  "approver": "Alexander Veyron (Biometric Signer)",
  "comments": "Approved treasury transfer for institutional bond purchase"
}
```
- **Response:**
```json
{
  "rift_operation_id": "rift_op_8fa21c43",
  "status": "AUTHORIZED",
  "message": "Authorization verified. Local-chain execution queued."
}
```

### 2.4 Query Operation Status & Forensic Evidence
- **Endpoint:** `GET /operations/{rift_operation_id}`
- **Response (`OperationStatusResponse`):**
```json
{
  "rift_operation_id": "rift_op_8fa21c43",
  "transfer_id": "tx_req_AlexanderVeyron_20261009_001",
  "status": "COMPLETED",
  "state_history": [
    {"state": "SUBMITTED", "timestamp": "2026-10-09T13:30:00Z"},
    {"state": "RISK_ASSESSMENT_PENDING", "timestamp": "2026-10-09T13:30:01Z"},
    {"state": "AWAITING_AUTHORIZATION", "timestamp": "2026-10-09T13:30:02Z"},
    {"state": "AUTHORIZED", "timestamp": "2026-10-09T13:30:15Z"},
    {"state": "SOURCE_TRANSACTION_PENDING", "timestamp": "2026-10-09T13:30:16Z"},
    {"state": "SOURCE_TRANSACTION_CONFIRMED", "timestamp": "2026-10-09T13:30:18Z"},
    {"state": "DESTINATION_TRANSACTION_PENDING", "timestamp": "2026-10-09T13:30:19Z"},
    {"state": "COMPLETED", "timestamp": "2026-10-09T13:30:22Z"}
  ],
  "blockchain_evidence": {
    "source": {
      "chain_id": 31337,
      "chain_name": "Ethereum Local L1 (Anvil-31337)",
      "tx_hash": "0x4e6b21789c1a5b4819d9c57d76a7e089d71c6d831512fb94711f7c234b6b23d1",
      "contract_address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      "block_number": 10482,
      "block_hash": "0x9812739418a09bca719238471928374918237498172938471928374981729384",
      "status": "CONFIRMED",
      "gas_used": "64812",
      "timestamp": "2026-10-09T13:30:18Z"
    },
    "destination": {
      "chain_id": 31338,
      "chain_name": "Base Local L2 (Anvil-31338)",
      "tx_hash": "0x89d71c6d831512fb94711f7c234b6b23d14e6b21789c1a5b4819d9c57d76a7e0",
      "contract_address": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      "block_number": 8912,
      "block_hash": "0x12739418a09bca71923847192837491823749817293847192837498172938498",
      "status": "CONFIRMED",
      "gas_used": "58204",
      "timestamp": "2026-10-09T13:30:22Z"
    }
  },
  "forensic_summary": {
    "events_intercepted": [
      "BridgeDepositInitiated(sender=0xAlexanderTreasury, amount=25000000000, targetChain=31338)",
      "BridgeReleaseFinalized(recipient=0x70997970, amount=25000000000, nonce=1084)"
    ],
    "reconciliation_hash": "0xcc29381710928390192837461928374019283746"
  }
}
```

---

## 3. Allowed Operation Lifecycle State Transitions

```
[DRAFT]
   │
   ▼
[SUBMITTED]
   │
   ▼
[RISK_ASSESSMENT_PENDING]
   │
   ├──> High Risk Policy ──> [REJECTED]
   │
   ▼
[AWAITING_AUTHORIZATION] (RIFT KEY)
   │
   ├──> Denied / Expired ──> [REJECTED]
   │
   ▼
[AUTHORIZED]
   │
   ▼
[SOURCE_TRANSACTION_PENDING]
   │
   ├──> Local Chain 1 Failure ──> [FAILED]
   │
   ▼
[SOURCE_TRANSACTION_CONFIRMED]
   │
   ▼
[DESTINATION_TRANSACTION_PENDING]
   │
   ├──> Local Chain 2 Failure ──> [RECONCILIATION_REQUIRED]
   │
   ▼
[COMPLETED]
```

---

## 4. Ledger Impact & Transition Mapping

| Operation Status | Bank Financial Ledger Impact | Account Available Balance |
| :--- | :--- | :--- |
| `DRAFT` | No ledger impact | Full |
| `SUBMITTED` | Pending reservation created | Reserved (deducted from available) |
| `RISK_ASSESSMENT_PENDING`| Reservation remains | Reserved |
| `AWAITING_AUTHORIZATION`| Reservation remains | Reserved |
| `REJECTED` | Reservation released | Returned to available |
| `FAILED` | Reservation released | Returned to available |
| `AUTHORIZED` | Reservation remains | Reserved |
| `SOURCE_TRANSACTION_CONFIRMED` | Transit pending | Reserved |
| `COMPLETED` | Settlement posted: Debits source, credits Transit Clearing | Permanently deducted |
| `RECONCILIATION_REQUIRED` | Marked for manual audit; balance locked | Reserved / Flagged |

---

## 5. Error Handling & Offline Behavior

1. **Connection Failure / Timeout:**
   - Bank marks operation as `RIFT_UNREACHABLE`.
   - UI displays banner: `RIFT CONNECTION UNAVAILABLE`.
   - Never auto-succeed or simulate fictional tx hashes.
   - User may retry or cancel intent, releasing reservations.

2. **HTTP 409 Conflict (Duplicate Idempotency Key):**
   - Bank returns existing stored operation state without duplicating ledger entries.

3. **HTTP 422 Validation Error:**
   - Invalid chain ID, unknown asset, or malformed address rejected immediately.
