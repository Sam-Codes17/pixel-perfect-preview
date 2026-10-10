-- ============================================================
-- RIFT BANK — Combined Trust Score, Security & RIFT Platform Schema
-- Run in Supabase SQL Editor (Project: gazjbspyjngfqdorlduh)
-- Idempotent — Safe to execute on existing database
-- ============================================================

-- ============================================================
-- PART 0: BUGFIX FOR PROVISION_WALLET (Resolves 42702 ambiguity)
-- ============================================================
DROP FUNCTION IF EXISTS provision_wallet(UUID) CASCADE;

CREATE OR REPLACE FUNCTION provision_wallet(p_user_id UUID)
RETURNS TABLE(out_wallet_id UUID, out_wallet_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet_id      UUID;
  v_wallet_number  TEXT;
  v_currency       RECORD;
  v_system_acct_id UUID;
  v_user_acct_id   UUID;
  v_txn_id         UUID;
  v_idem_key       TEXT;
BEGIN
  -- Idempotency: already provisioned?
  SELECT w.id, w.wallet_number INTO v_wallet_id, v_wallet_number
  FROM wallets w WHERE w.user_id = p_user_id AND w.provisioned_at IS NOT NULL;

  IF FOUND THEN
    RETURN QUERY SELECT v_wallet_id, v_wallet_number;
    RETURN;
  END IF;

  -- Create or retrieve wallet
  IF EXISTS (SELECT 1 FROM wallets WHERE user_id = p_user_id) THEN
    SELECT w.id, w.wallet_number INTO v_wallet_id, v_wallet_number
    FROM wallets w WHERE w.user_id = p_user_id;
    UPDATE wallets SET provisioned_at = NOW() WHERE wallets.id = v_wallet_id;
  ELSE
    v_wallet_number := 'RIFT-' ||
      UPPER(SUBSTRING(MD5(p_user_id::TEXT || '1'), 1, 4)) || '-' ||
      UPPER(SUBSTRING(MD5(p_user_id::TEXT || '2'), 1, 4));
    INSERT INTO wallets (user_id, wallet_number, provisioned_at)
    VALUES (p_user_id, v_wallet_number, NOW())
    RETURNING wallets.id INTO v_wallet_id;
  END IF;

  -- Allocate each active currency
  FOR v_currency IN
    SELECT * FROM currencies WHERE is_active = TRUE AND initial_allocation > 0 ORDER BY id
  LOOP
    v_idem_key := 'init-' || p_user_id::TEXT || '-' || v_currency.id;

    CONTINUE WHEN EXISTS (SELECT 1 FROM ledger_transactions lt WHERE lt.idempotency_key = v_idem_key);

    -- Wallet balance (skip if already exists)
    INSERT INTO wallet_balances (wallet_id, currency_id, available_balance)
    VALUES (v_wallet_id, v_currency.id, v_currency.initial_allocation)
    ON CONFLICT (wallet_id, currency_id) DO NOTHING;

    -- System issuance account
    SELECT la.id INTO v_system_acct_id FROM ledger_accounts la
    WHERE la.account_type = 'SYSTEM_ISSUANCE' AND la.currency_id = v_currency.id LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO ledger_accounts (account_type, currency_id, name)
      VALUES ('SYSTEM_ISSUANCE', v_currency.id, 'RIFT System Issuance — ' || v_currency.id)
      RETURNING id INTO v_system_acct_id;
    END IF;

    -- User wallet account
    SELECT la.id INTO v_user_acct_id FROM ledger_accounts la
    WHERE la.account_type = 'USER_WALLET' AND la.reference_id = v_wallet_id AND la.currency_id = v_currency.id LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO ledger_accounts (account_type, reference_id, currency_id, name)
      VALUES ('USER_WALLET', v_wallet_id, v_currency.id, 'User Wallet — ' || v_currency.id)
      RETURNING id INTO v_user_acct_id;
    END IF;

    -- Ledger transaction
    INSERT INTO ledger_transactions (
      transaction_type, status, receiver_wallet_id, currency_id,
      amount, idempotency_key, reference, completed_at
    ) VALUES (
      'INITIAL_ALLOCATION', 'COMPLETED', v_wallet_id, v_currency.id,
      v_currency.initial_allocation, v_idem_key,
      'Initial RIFT ecosystem allocation', NOW()
    ) RETURNING id INTO v_txn_id;

    -- Double-entry: debit system, credit user
    INSERT INTO ledger_entries (transaction_id, ledger_account_id, entry_type, currency_id, amount)
    VALUES
      (v_txn_id, v_system_acct_id, 'DEBIT',  v_currency.id, v_currency.initial_allocation),
      (v_txn_id, v_user_acct_id,   'CREDIT', v_currency.id, v_currency.initial_allocation);
  END LOOP;

  RETURN QUERY SELECT v_wallet_id, v_wallet_number;
END;
$$;

-- ============================================================
-- PART 1: TRUST SCORE ENGINE & POLICY (Migration 002)
-- ============================================================

CREATE TABLE IF NOT EXISTS trust_score_policy (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  version       INTEGER NOT NULL UNIQUE,
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  config        JSONB   NOT NULL DEFAULT '{}',
  description   TEXT,
  created_by    UUID    REFERENCES profiles(id),
  activated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO trust_score_policy (version, is_active, activated_at, description, config) VALUES (
  1, TRUE, NOW(), 'Initial RIFT Trust Score policy v1',
  jsonb_build_object(
    'baseline_score',           700,
    'min_score',                0,
    'max_score',                1000,
    'new_profile_tx_threshold', 5,
    'levels', jsonb_build_array(
      jsonb_build_object('min',900,'max',1000,'label','EXCELLENT HISTORY',  'tone','excellent'),
      jsonb_build_object('min',800,'max',899, 'label','STRONG HISTORY',     'tone','strong'),
      jsonb_build_object('min',650,'max',799, 'label','ESTABLISHED',        'tone','established'),
      jsonb_build_object('min',450,'max',649, 'label','UNDER REVIEW',       'tone','review'),
      jsonb_build_object('min',250,'max',449, 'label','ELEVATED SCRUTINY',  'tone','scrutiny'),
      jsonb_build_object('min',0,  'max',249, 'label','RESTRICTED PROFILE', 'tone','restricted')
    ),
    'adjustments', jsonb_build_object(
      'completed_tx_streak',           5,
      'failed_tx_repeat',             -15,
      'idempotency_replay_confirmed', -40,
      'bypass_attempt_confirmed',     -50,
      'token_mapping_violation',      -30,
      'suspicious_burst',             -25,
      'invalid_auth_repeat',          -20,
      'sustained_compliance',         10,
      'false_positive_reversal',       0
    )
  )
) ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS trust_profiles (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID    NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  current_score    INTEGER NOT NULL DEFAULT 700
                   CHECK (current_score BETWEEN 0 AND 1000),
  score_version    INTEGER NOT NULL DEFAULT 0,
  policy_version   INTEGER NOT NULL DEFAULT 1
                   REFERENCES trust_score_policy(version),
  status_label     TEXT    NOT NULL DEFAULT 'LIMITED HISTORY',
  activity_trend   TEXT    NOT NULL DEFAULT 'STABLE'
                   CHECK (activity_trend IN ('IMPROVING','STABLE','DECLINING','UNKNOWN')),
  is_new_profile   BOOLEAN NOT NULL DEFAULT TRUE,
  total_adjustments INTEGER NOT NULL DEFAULT 0,
  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trust_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trust_profile_select_own" ON trust_profiles;
CREATE POLICY "trust_profile_select_own" ON trust_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS trust_score_adjustments (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key      TEXT    UNIQUE NOT NULL,
  previous_score       INTEGER NOT NULL CHECK (previous_score BETWEEN 0 AND 1000),
  score_delta          INTEGER NOT NULL,
  resulting_score      INTEGER NOT NULL CHECK (resulting_score BETWEEN 0 AND 1000),
  category             TEXT    NOT NULL CHECK (category IN (
    'TRANSACTION_RELIABILITY','SECURITY_COMPLIANCE','SUSPICIOUS_ACTIVITY',
    'ACCOUNT_SECURITY','HISTORICAL_CONSISTENCY','REVERSAL','RECALCULATION','INITIAL'
  )),
  is_provisional       BOOLEAN NOT NULL DEFAULT FALSE,
  explanation          TEXT    NOT NULL,
  rule_reference       TEXT,
  policy_version       INTEGER NOT NULL REFERENCES trust_score_policy(version),
  related_transaction_id UUID  REFERENCES ledger_transactions(id),
  related_incident_id  UUID,
  reversal_of          UUID    REFERENCES trust_score_adjustments(id),
  reversed_by          UUID    REFERENCES trust_score_adjustments(id),
  is_reversed          BOOLEAN NOT NULL DEFAULT FALSE,
  effective_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trust_score_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "adjustments_select_own" ON trust_score_adjustments;
CREATE POLICY "adjustments_select_own" ON trust_score_adjustments
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS rift_security_findings (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id       TEXT    UNIQUE,
  rift_transaction_id TEXT,
  detection_event_id TEXT,
  rule_id           TEXT,
  rule_name         TEXT,
  severity          TEXT    NOT NULL DEFAULT 'MEDIUM'
                    CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  finding_type      TEXT    NOT NULL,
  affected_wallet_id UUID   REFERENCES wallets(id),
  sender_wallet_id  UUID    REFERENCES wallets(id),
  receiver_wallet_id UUID   REFERENCES wallets(id),
  attributed_user_id UUID   REFERENCES profiles(id),
  attribution_role  TEXT    CHECK (attribution_role IN (
    'ORIGINATOR','SENDER','RECEIVER','COUNTERPARTY','UNKNOWN'
  )),
  status            TEXT    NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','UNDER_REVIEW','CONFIRMED','DISMISSED','FALSE_POSITIVE','CORRECTED')),
  confidence        TEXT    DEFAULT 'LOW'
                    CHECK (confidence IN ('LOW','MEDIUM','HIGH','CONFIRMED')),
  evidence          JSONB   NOT NULL DEFAULT '{}',
  finding_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT,
  score_adjustment_id UUID  REFERENCES trust_score_adjustments(id),
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rift_security_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "findings_select_own" ON rift_security_findings;
CREATE POLICY "findings_select_own" ON rift_security_findings
  FOR SELECT USING (auth.uid() = attributed_user_id);

CREATE TABLE IF NOT EXISTS trust_score_reviews (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  adjustment_id         UUID    NOT NULL REFERENCES trust_score_adjustments(id),
  finding_id            UUID    REFERENCES rift_security_findings(id),
  user_statement        TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','UNDER_REVIEW','RESOLVED','DISMISSED')),
  reviewer_decision     TEXT    CHECK (reviewer_decision IN ('UPHELD','REVERSED','PARTIAL')),
  reviewer_note         TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trust_score_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select_own" ON trust_score_reviews;
CREATE POLICY "reviews_select_own" ON trust_score_reviews
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "reviews_insert_own" ON trust_score_reviews;
CREATE POLICY "reviews_insert_own" ON trust_score_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS trust_score_recalculations (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID    NOT NULL REFERENCES profiles(id),
  trigger_reason TEXT    NOT NULL,
  score_before   INTEGER NOT NULL,
  score_after    INTEGER NOT NULL,
  policy_version INTEGER NOT NULL,
  triggered_by   UUID    REFERENCES profiles(id),
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Functions
CREATE OR REPLACE FUNCTION initialize_trust_profile(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_idem_key   TEXT;
  v_policy     RECORD;
BEGIN
  SELECT id INTO v_profile_id FROM trust_profiles WHERE user_id = p_user_id;
  IF FOUND THEN RETURN v_profile_id; END IF;

  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active scoring policy'; END IF;

  INSERT INTO trust_profiles (user_id, current_score, policy_version, status_label, is_new_profile)
  VALUES (p_user_id, (v_policy.config->>'baseline_score')::INT, v_policy.version, 'LIMITED HISTORY', TRUE)
  RETURNING id INTO v_profile_id;

  v_idem_key := 'init-trust-' || p_user_id::TEXT;
  INSERT INTO trust_score_adjustments (
    user_id, idempotency_key, previous_score, score_delta, resulting_score,
    category, explanation, policy_version, effective_at
  ) VALUES (
    p_user_id, v_idem_key, 0, (v_policy.config->>'baseline_score')::INT,
    (v_policy.config->>'baseline_score')::INT,
    'INITIAL', 'New RIFT ecosystem profile — baseline score assigned per configured policy.',
    v_policy.version, NOW()
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE trust_profiles SET total_adjustments = 1 WHERE id = v_profile_id;

  RETURN v_profile_id;
END;
$$;

DROP FUNCTION IF EXISTS apply_score_adjustment(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, UUID, UUID) CASCADE;

CREATE OR REPLACE FUNCTION apply_score_adjustment(
  p_user_id            UUID,
  p_idempotency_key    TEXT,
  p_delta              INTEGER,
  p_category           TEXT,
  p_explanation        TEXT,
  p_rule_reference     TEXT       DEFAULT NULL,
  p_is_provisional     BOOLEAN    DEFAULT FALSE,
  p_related_tx_id      UUID       DEFAULT NULL,
  p_related_incident_id UUID      DEFAULT NULL
)
RETURNS TABLE(adjustment_id UUID, previous_score INTEGER, score_delta INTEGER, resulting_score INTEGER, was_duplicate BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_adj_id       UUID;
  v_existing_adj UUID;
  v_profile      RECORD;
  v_policy       RECORD;
  v_prev_score   INTEGER;
  v_delta        INTEGER;
  v_new_score    INTEGER;
BEGIN
  SELECT tsa.id INTO v_existing_adj FROM trust_score_adjustments tsa WHERE tsa.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT tsa.previous_score, tsa.score_delta, tsa.resulting_score INTO v_prev_score, v_delta, v_new_score
    FROM trust_score_adjustments tsa WHERE tsa.id = v_existing_adj;
    RETURN QUERY SELECT v_existing_adj, v_prev_score, v_delta, v_new_score, TRUE;
    RETURN;
  END IF;

  PERFORM initialize_trust_profile(p_user_id);

  SELECT * INTO v_profile FROM trust_profiles tp WHERE tp.user_id = p_user_id FOR UPDATE;
  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;

  v_prev_score := v_profile.current_score;
  v_new_score  := GREATEST(0, LEAST(1000, v_prev_score + p_delta));

  INSERT INTO trust_score_adjustments (
    user_id, idempotency_key, previous_score, score_delta, resulting_score,
    category, is_provisional, explanation, rule_reference, policy_version,
    related_transaction_id, related_incident_id
  ) VALUES (
    p_user_id, p_idempotency_key, v_prev_score, p_delta, v_new_score,
    p_category, p_is_provisional, p_explanation, p_rule_reference,
    v_policy.version, p_related_tx_id, p_related_incident_id
  ) RETURNING id INTO v_adj_id;

  UPDATE trust_profiles
  SET current_score     = v_new_score,
      score_version     = score_version + 1,
      total_adjustments = total_adjustments + 1,
      last_calculated_at = NOW(),
      updated_at        = NOW(),
      activity_trend    = CASE
        WHEN p_delta > 0 THEN 'IMPROVING'
        WHEN p_delta < 0 THEN 'DECLINING'
        ELSE 'STABLE'
      END
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT v_adj_id, v_prev_score, p_delta, v_new_score, FALSE;
END;
$$;

DROP FUNCTION IF EXISTS reverse_score_adjustment(UUID, TEXT, UUID) CASCADE;

CREATE OR REPLACE FUNCTION reverse_score_adjustment(
  p_original_adj_id UUID,
  p_reason          TEXT,
  p_reviewer_id     UUID DEFAULT NULL
)
RETURNS TABLE(reversal_id UUID, resulting_score INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_adj         RECORD;
  v_rev_id      UUID;
  v_new_score   INTEGER;
  v_idem_key    TEXT;
BEGIN
  SELECT * INTO v_adj FROM trust_score_adjustments tsa WHERE tsa.id = p_original_adj_id AND tsa.is_reversed = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found or already reversed: %', p_original_adj_id;
  END IF;

  v_idem_key := 'reversal-' || p_original_adj_id::TEXT;

  SELECT tsa.id, tsa.resulting_score INTO v_rev_id, v_new_score
  FROM trust_score_adjustments tsa WHERE tsa.idempotency_key = v_idem_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_rev_id, v_new_score;
    RETURN;
  END IF;

  SELECT asa.adjustment_id, asa.resulting_score INTO v_rev_id, v_new_score
  FROM apply_score_adjustment(
    v_adj.user_id,
    v_idem_key,
    -v_adj.score_delta,
    'REVERSAL',
    p_reason,
    v_adj.rule_reference,
    FALSE,
    v_adj.related_transaction_id,
    v_adj.related_incident_id
  ) asa;

  UPDATE trust_score_adjustments SET is_reversed = TRUE, reversed_by = v_rev_id WHERE id = p_original_adj_id;
  UPDATE trust_score_adjustments SET reversal_of = p_original_adj_id WHERE id = v_rev_id;

  INSERT INTO trust_score_recalculations (
    user_id, trigger_reason, score_before, score_after, policy_version, triggered_by
  ) SELECT v_adj.user_id, p_reason, v_adj.resulting_score, v_new_score, tsp.version, p_reviewer_id
    FROM trust_score_policy tsp WHERE tsp.is_active = TRUE;

  RETURN QUERY SELECT v_rev_id, v_new_score;
END;
$$;

CREATE OR REPLACE FUNCTION recalculate_trust_score(
  p_user_id UUID,
  p_reason  TEXT DEFAULT 'Manual recalculation'
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_policy      RECORD;
  v_old_score   INTEGER;
  v_new_score   INTEGER;
BEGIN
  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;
  SELECT current_score INTO v_old_score FROM trust_profiles WHERE user_id = p_user_id;

  SELECT COALESCE(SUM(score_delta), 0) INTO v_new_score
  FROM trust_score_adjustments
  WHERE user_id = p_user_id AND is_reversed = FALSE;

  v_new_score := GREATEST(0, LEAST(1000, v_new_score));

  UPDATE trust_profiles
  SET current_score = v_new_score,
      last_calculated_at = NOW(),
      updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO trust_score_recalculations (
    user_id, trigger_reason, score_before, score_after, policy_version
  ) VALUES (p_user_id, p_reason, v_old_score, v_new_score, v_policy.version);

  RETURN v_new_score;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_trust_profile_label(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile    RECORD;
  v_policy     RECORD;
  v_level      JSONB;
  v_label      TEXT;
  v_tx_count   INTEGER;
  v_threshold  INTEGER;
BEGIN
  SELECT * INTO v_profile FROM trust_profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RETURN 'LIMITED HISTORY'; END IF;

  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;
  v_threshold := (v_policy.config->>'new_profile_tx_threshold')::INT;

  SELECT COUNT(*) INTO v_tx_count
  FROM ledger_transactions lt
  JOIN wallets w ON (w.id = lt.sender_wallet_id OR w.id = lt.receiver_wallet_id)
  WHERE w.user_id = p_user_id
    AND lt.status = 'COMPLETED'
    AND lt.transaction_type != 'INITIAL_ALLOCATION';

  IF v_tx_count < v_threshold THEN
    UPDATE trust_profiles SET status_label = 'LIMITED HISTORY', is_new_profile = TRUE WHERE user_id = p_user_id;
    RETURN 'LIMITED HISTORY';
  END IF;

  FOR v_level IN SELECT * FROM jsonb_array_elements(v_policy.config->'levels') LOOP
    IF v_profile.current_score >= (v_level->>'min')::INT
       AND v_profile.current_score <= (v_level->>'max')::INT THEN
      v_label := v_level->>'label';
      EXIT;
    END IF;
  END LOOP;

  v_label := COALESCE(v_label, 'ESTABLISHED');

  UPDATE trust_profiles
  SET status_label = v_label, is_new_profile = FALSE
  WHERE user_id = p_user_id;

  RETURN v_label;
END;
$$;

-- View
CREATE OR REPLACE VIEW trust_score_admin_view AS
SELECT
  tp.user_id,
  p.full_name,
  tp.current_score,
  tp.status_label,
  tp.activity_trend,
  tp.is_new_profile,
  tp.total_adjustments,
  tp.last_calculated_at,
  tp.policy_version,
  COUNT(DISTINCT rsf.id)   FILTER (WHERE rsf.status = 'OPEN')          AS open_findings,
  COUNT(DISTINCT rsf.id)   FILTER (WHERE rsf.status = 'CONFIRMED')     AS confirmed_findings,
  COUNT(DISTINCT tsr.id)   FILTER (WHERE tsr.status = 'PENDING')       AS pending_reviews
FROM trust_profiles tp
JOIN profiles p ON p.id = tp.user_id
LEFT JOIN rift_security_findings rsf ON rsf.attributed_user_id = tp.user_id
LEFT JOIN trust_score_reviews tsr ON tsr.user_id = tp.user_id
GROUP BY tp.user_id, p.full_name, tp.current_score, tp.status_label,
         tp.activity_trend, tp.is_new_profile, tp.total_adjustments,
         tp.last_calculated_at, tp.policy_version;

-- ============================================================
-- PART 2: RIFT INTEGRATION & PENDING CLAIMS ESCROW (Migration 003)
-- ============================================================

-- Expand check constraints to allow TRANSIT_CLEARING and HELD
ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_account_type_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_account_type_check
  CHECK (account_type IN ('SYSTEM_ISSUANCE','USER_WALLET','MERCHANT','TRANSIT_CLEARING'));

ALTER TABLE ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_status_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_status_check
  CHECK (status IN ('PENDING','PROCESSING','COMPLETED','REJECTED','FAILED','CANCELLED','EXPIRED','HELD'));

ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS rift_operation_id TEXT,
  ADD COLUMN IF NOT EXISTS rift_status TEXT,
  ADD COLUMN IF NOT EXISTS risk_assessment JSONB,
  ADD COLUMN IF NOT EXISTS authorization_requirements JSONB,
  ADD COLUMN IF NOT EXISTS blockchain_evidence JSONB;

CREATE INDEX IF NOT EXISTS idx_ledger_tx_rift_op ON ledger_transactions(rift_operation_id);

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

  SELECT id INTO v_txn_id FROM ledger_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT id, claim_token INTO v_claim_id, p_claim_token
    FROM pending_claims WHERE transaction_id = v_txn_id LIMIT 1;
    RETURN QUERY SELECT v_txn_id, v_claim_id, p_claim_token, 'HELD'::TEXT;
    RETURN;
  END IF;

  SELECT available_balance INTO v_sender_balance
  FROM wallet_balances
  WHERE wallet_id = p_sender_wallet_id AND currency_id = p_currency_id
  FOR UPDATE;

  IF v_sender_balance IS NULL OR v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Available % < Required %', COALESCE(v_sender_balance, 0), p_amount;
  END IF;

  UPDATE wallet_balances
  SET available_balance = available_balance - p_amount, updated_at = NOW()
  WHERE wallet_id = p_sender_wallet_id AND currency_id = p_currency_id;

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

  INSERT INTO pending_claims (
    transaction_id, sender_wallet_id, recipient_email, claim_token,
    currency_id, amount, status
  ) VALUES (
    v_txn_id, p_sender_wallet_id, v_clean_email, p_claim_token,
    p_currency_id, p_amount, 'PENDING'
  ) RETURNING id INTO v_claim_id;

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
    UPDATE pending_claims
    SET status = 'CLAIMED',
        claimed_by_wallet_id = p_wallet_id,
        claimed_at = NOW()
    WHERE id = v_claim.id;

    INSERT INTO wallet_balances (wallet_id, currency_id, available_balance)
    VALUES (p_wallet_id, v_claim.currency_id, v_claim.amount)
    ON CONFLICT (wallet_id, currency_id) DO UPDATE
      SET available_balance = wallet_balances.available_balance + v_claim.amount,
          updated_at = NOW();

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
      blockchain_evidence        = p_blockchain_evidence
  WHERE id = p_transaction_id;

  RETURN FOUND;
END;
$$;
