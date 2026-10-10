-- ============================================================
-- RIFT BANK — RIFT Integration, Pending Claims & Forensics (Migration 003)
-- Run after 001_rift_bank_schema.sql and 002_trust_score_schema.sql
-- ============================================================

-- ============================================================
-- 1. ADD RIFT COLUMNS TO LEDGER TRANSACTIONS
-- ============================================================
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS rift_operation_id TEXT,
  ADD COLUMN IF NOT EXISTS rift_status TEXT,
  ADD COLUMN IF NOT EXISTS risk_assessment JSONB,
  ADD COLUMN IF NOT EXISTS authorization_requirements JSONB,
  ADD COLUMN IF NOT EXISTS blockchain_evidence JSONB;

CREATE INDEX IF NOT EXISTS idx_ledger_tx_rift_op ON ledger_transactions(rift_operation_id);

-- ============================================================
-- 2. TRANSIT CLEARING ACCOUNTS (for funds in escrow/transit)
-- ============================================================
DO $$
DECLARE
  v_curr RECORD;
BEGIN
  FOR v_curr IN SELECT id FROM currencies LOOP
    IF NOT EXISTS (
      SELECT 1 FROM ledger_accounts
      WHERE account_type = 'TRANSIT_CLEARING' AND currency_id = v_curr.id
    ) THEN
      INSERT INTO ledger_accounts (account_type, currency_id, name)
      VALUES ('TRANSIT_CLEARING', v_curr.id, 'RIFT Transit & Escrow Clearing — ' || v_curr.id);
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 3. PENDING CLAIMS TABLE (Unregistered Recipient Escrow)
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_claims (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  sender_wallet_id      UUID NOT NULL REFERENCES wallets(id),
  recipient_email       TEXT NOT NULL,
  claim_token           TEXT UNIQUE NOT NULL,
  currency_id           TEXT NOT NULL REFERENCES currencies(id),
  amount                BIGINT NOT NULL CHECK (amount > 0),
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED')),
  claimed_by_wallet_id  UUID REFERENCES wallets(id),
  claimed_at            TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pending_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claims_select_sender" ON pending_claims;
CREATE POLICY "claims_select_sender" ON pending_claims
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM wallets w WHERE w.id = sender_wallet_id AND w.user_id = auth.uid())
    OR
    LOWER(recipient_email) = LOWER(auth.jwt()->>'email')
  );

CREATE INDEX IF NOT EXISTS idx_pending_claims_email ON pending_claims(LOWER(recipient_email));
CREATE INDEX IF NOT EXISTS idx_pending_claims_token ON pending_claims(claim_token);

-- ============================================================
-- 4. FUNCTION: execute_pending_transfer
-- Atomically debits sender into transit escrow and creates claim
-- ============================================================
CREATE OR REPLACE FUNCTION execute_pending_transfer(
  p_sender_wallet_id   UUID,
  p_recipient_email    TEXT,
  p_currency_id        TEXT,
  p_amount             BIGINT,
  p_idempotency_key    TEXT,
  p_claim_token        TEXT,
  p_reference          TEXT DEFAULT NULL
)
RETURNS TABLE(transaction_id UUID, claim_id UUID, claim_token TEXT, txn_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_txn_id           UUID;
  v_claim_id         UUID;
  v_sender_balance   BIGINT;
  v_sender_acct_id   UUID;
  v_transit_acct_id  UUID;
  v_clean_email      TEXT;
BEGIN
  v_clean_email := LOWER(TRIM(p_recipient_email));

  -- Idempotency
  SELECT id INTO v_txn_id FROM ledger_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT id, claim_token INTO v_claim_id, p_claim_token
    FROM pending_claims WHERE transaction_id = v_txn_id LIMIT 1;
    RETURN QUERY SELECT v_txn_id, v_claim_id, p_claim_token, 'HELD'::TEXT;
    RETURN;
  END IF;

  -- Lock sender balance
  SELECT available_balance INTO v_sender_balance
  FROM wallet_balances
  WHERE wallet_id = p_sender_wallet_id AND currency_id = p_currency_id
  FOR UPDATE;

  IF v_sender_balance IS NULL OR v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Available % < Required %', COALESCE(v_sender_balance, 0), p_amount;
  END IF;

  -- Debit sender wallet balance
  UPDATE wallet_balances
  SET available_balance = available_balance - p_amount, updated_at = NOW()
  WHERE wallet_id = p_sender_wallet_id AND currency_id = p_currency_id;

  -- Create ledger transaction in HELD state
  INSERT INTO ledger_transactions (
    transaction_type, status, sender_wallet_id, currency_id,
    amount, idempotency_key, reference, metadata
  ) VALUES (
    'TRANSFER', 'HELD', p_sender_wallet_id, p_currency_id,
    p_amount, p_idempotency_key, p_reference,
    jsonb_build_object(
      'recipient_email', v_clean_email,
      'claim_token', p_claim_token,
      'is_pending_claim', TRUE
    )
  ) RETURNING id INTO v_txn_id;

  -- Create pending claim
  INSERT INTO pending_claims (
    transaction_id, sender_wallet_id, recipient_email, claim_token,
    currency_id, amount, status
  ) VALUES (
    v_txn_id, p_sender_wallet_id, v_clean_email, p_claim_token,
    p_currency_id, p_amount, 'PENDING'
  ) RETURNING id INTO v_claim_id;

  -- Double-entry: Debit sender account, Credit transit clearing account
  SELECT id INTO v_sender_acct_id FROM ledger_accounts
  WHERE account_type = 'USER_WALLET' AND reference_id = p_sender_wallet_id AND currency_id = p_currency_id LIMIT 1;

  SELECT id INTO v_transit_acct_id FROM ledger_accounts
  WHERE account_type = 'TRANSIT_CLEARING' AND currency_id = p_currency_id LIMIT 1;

  IF v_sender_acct_id IS NOT NULL AND v_transit_acct_id IS NOT NULL THEN
    INSERT INTO ledger_entries (transaction_id, ledger_account_id, entry_type, currency_id, amount)
    VALUES
      (v_txn_id, v_sender_acct_id,  'DEBIT',  p_currency_id, p_amount),
      (v_txn_id, v_transit_acct_id, 'CREDIT', p_currency_id, p_amount);
  END IF;

  RETURN QUERY SELECT v_txn_id, v_claim_id, p_claim_token, 'HELD'::TEXT;
END;
$$;

-- ============================================================
-- 5. FUNCTION: claim_pending_transfers
-- Resolves all pending claims for an authenticated user's email
-- ============================================================
CREATE OR REPLACE FUNCTION claim_pending_transfers(
  p_wallet_id UUID,
  p_email     TEXT
)
RETURNS TABLE(claims_claimed INTEGER, total_credited BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claim           RECORD;
  v_count           INTEGER := 0;
  v_total           BIGINT := 0;
  v_clean_email     TEXT;
  v_user_acct_id    UUID;
  v_transit_acct_id UUID;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));

  FOR v_claim IN
    SELECT * FROM pending_claims
    WHERE LOWER(recipient_email) = v_clean_email
      AND status = 'PENDING'
      AND expires_at > NOW()
    FOR UPDATE
  LOOP
    -- 1. Mark claim as claimed
    UPDATE pending_claims
    SET status = 'CLAIMED',
        claimed_by_wallet_id = p_wallet_id,
        claimed_at = NOW()
    WHERE id = v_claim.id;

    -- 2. Credit recipient wallet balance
    INSERT INTO wallet_balances (wallet_id, currency_id, available_balance)
    VALUES (p_wallet_id, v_claim.currency_id, v_claim.amount)
    ON CONFLICT (wallet_id, currency_id) DO UPDATE
      SET available_balance = wallet_balances.available_balance + v_claim.amount,
          updated_at = NOW();

    -- 3. Complete the original transaction without duplicating
    UPDATE ledger_transactions
    SET status = 'COMPLETED',
        receiver_wallet_id = p_wallet_id,
        completed_at = NOW(),
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::JSONB),
          '{claimed_by_wallet_id}',
          to_jsonb(p_wallet_id::TEXT)
        )
    WHERE id = v_claim.transaction_id;

    -- 4. Double-entry: Debit transit clearing, Credit recipient user account
    SELECT id INTO v_transit_acct_id FROM ledger_accounts
    WHERE account_type = 'TRANSIT_CLEARING' AND currency_id = v_claim.currency_id LIMIT 1;

    SELECT id INTO v_user_acct_id FROM ledger_accounts
    WHERE account_type = 'USER_WALLET' AND reference_id = p_wallet_id AND currency_id = v_claim.currency_id LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO ledger_accounts (account_type, reference_id, currency_id, name)
      VALUES ('USER_WALLET', p_wallet_id, v_claim.currency_id, 'User Wallet — ' || v_claim.currency_id)
      RETURNING id INTO v_user_acct_id;
    END IF;

    IF v_transit_acct_id IS NOT NULL AND v_user_acct_id IS NOT NULL THEN
      INSERT INTO ledger_entries (transaction_id, ledger_account_id, entry_type, currency_id, amount)
      VALUES
        (v_claim.transaction_id, v_transit_acct_id, 'DEBIT',  v_claim.currency_id, v_claim.amount),
        (v_claim.transaction_id, v_user_acct_id,    'CREDIT', v_claim.currency_id, v_claim.amount);
    END IF;

    v_count := v_count + 1;
    v_total := v_total + v_claim.amount;
  END LOOP;

  RETURN QUERY SELECT v_count, v_total;
END;
$$;

-- ============================================================
-- 6. FUNCTION: record_rift_transaction_evidence
-- Persists verified RIFT operation telemetry & forensic evidence
-- ============================================================
CREATE OR REPLACE FUNCTION record_rift_transaction_evidence(
  p_transaction_id      UUID,
  p_rift_operation_id   TEXT,
  p_rift_status         TEXT,
  p_risk_assessment     JSONB,
  p_auth_requirements   JSONB,
  p_blockchain_evidence JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE ledger_transactions
  SET rift_operation_id          = p_rift_operation_id,
      rift_status                = p_rift_status,
      risk_assessment            = p_risk_assessment,
      authorization_requirements = p_auth_requirements,
      blockchain_evidence        = p_blockchain_evidence,
      updated_at                 = NOW()
  WHERE id = p_transaction_id;

  RETURN FOUND;
END;
$$;
