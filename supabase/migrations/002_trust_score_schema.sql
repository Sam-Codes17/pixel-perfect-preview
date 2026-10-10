-- ============================================================
-- RIFT BANK — Trust Score Schema (Migration 002)
-- Run after 001_rift_bank_schema.sql
-- ============================================================

-- ============================================================
-- SCORING POLICY CONFIGURATION (versioned, backend-managed)
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

-- Insert v1 policy (activate it)
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

-- ============================================================
-- USER TRUST PROFILES
-- ============================================================
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

-- ============================================================
-- SCORE ADJUSTMENT RECORDS (full audit trail, idempotent)
-- ============================================================
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

-- ============================================================
-- RIFT SECURITY FINDINGS (adapter — consumes external events)
-- ============================================================
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

-- ============================================================
-- SCORE REVIEW REQUESTS (user-initiated disputes)
-- ============================================================
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

-- ============================================================
-- SCORE RECALCULATION LOG
-- ============================================================
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

-- ============================================================
-- FUNCTION: initialize_trust_profile (idempotent)
-- ============================================================
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

  -- Record the initialization adjustment
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

-- ============================================================
-- FUNCTION: apply_score_adjustment (atomic, idempotent, clamped)
-- ============================================================
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
RETURNS TABLE(adjustment_id UUID, previous_score INTEGER, resulting_score INTEGER, was_duplicate BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_adj_id       UUID;
  v_existing_adj UUID;
  v_profile      RECORD;
  v_policy       RECORD;
  v_prev_score   INTEGER;
  v_new_score    INTEGER;
BEGIN
  -- Idempotency
  SELECT id INTO v_existing_adj FROM trust_score_adjustments WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT previous_score, resulting_score INTO v_prev_score, v_new_score
    FROM trust_score_adjustments WHERE id = v_existing_adj;
    RETURN QUERY SELECT v_existing_adj, v_prev_score, v_new_score, TRUE;
    RETURN;
  END IF;

  -- Ensure profile exists
  PERFORM initialize_trust_profile(p_user_id);

  SELECT * INTO v_profile FROM trust_profiles WHERE user_id = p_user_id FOR UPDATE;
  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;

  v_prev_score := v_profile.current_score;
  v_new_score  := GREATEST(0, LEAST(1000, v_prev_score + p_delta));

  -- Insert adjustment record
  INSERT INTO trust_score_adjustments (
    user_id, idempotency_key, previous_score, score_delta, resulting_score,
    category, is_provisional, explanation, rule_reference, policy_version,
    related_transaction_id, related_incident_id
  ) VALUES (
    p_user_id, p_idempotency_key, v_prev_score, p_delta, v_new_score,
    p_category, p_is_provisional, p_explanation, p_rule_reference,
    v_policy.version, p_related_tx_id, p_related_incident_id
  ) RETURNING id INTO v_adj_id;

  -- Update profile score
  UPDATE trust_profiles
  SET current_score    = v_new_score,
      score_version    = score_version + 1,
      total_adjustments = total_adjustments + 1,
      last_calculated_at = NOW(),
      updated_at       = NOW(),
      activity_trend   = CASE
        WHEN p_delta > 0 THEN 'IMPROVING'
        WHEN p_delta < 0 THEN 'DECLINING'
        ELSE 'STABLE'
      END
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT v_adj_id, v_prev_score, v_new_score, FALSE;
END;
$$;

-- ============================================================
-- FUNCTION: reverse_adjustment (for false positive / correction)
-- ============================================================
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
  SELECT * INTO v_adj FROM trust_score_adjustments WHERE id = p_original_adj_id AND is_reversed = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found or already reversed: %', p_original_adj_id;
  END IF;

  v_idem_key := 'reversal-' || p_original_adj_id::TEXT;

  SELECT id, resulting_score INTO v_rev_id, v_new_score
  FROM trust_score_adjustments WHERE idempotency_key = v_idem_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_rev_id, v_new_score;
    RETURN;
  END IF;

  -- Apply inverse delta
  SELECT adjustment_id, resulting_score INTO v_rev_id, v_new_score
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
  );

  -- Link original ↔ reversal
  UPDATE trust_score_adjustments SET is_reversed = TRUE, reversed_by = v_rev_id WHERE id = p_original_adj_id;
  UPDATE trust_score_adjustments SET reversal_of = p_original_adj_id WHERE id = v_rev_id;

  -- Log recalculation
  INSERT INTO trust_score_recalculations (
    user_id, trigger_reason, score_before, score_after, policy_version, triggered_by
  ) SELECT v_adj.user_id, p_reason, v_adj.resulting_score, v_new_score, policy_version, p_reviewer_id
    FROM trust_score_policy WHERE is_active = TRUE;

  RETURN QUERY SELECT v_rev_id, v_new_score;
END;
$$;

-- ============================================================
-- FUNCTION: recalculate_trust_score (full replay from adjustments)
-- ============================================================
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
  v_adj         RECORD;
BEGIN
  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;

  SELECT current_score INTO v_old_score FROM trust_profiles WHERE user_id = p_user_id;

  -- Replay: sum all non-reversed adjustments from scratch
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

-- ============================================================
-- FUNCTION: update_trust_profile_label (compute status label)
-- Call after score changes.
-- ============================================================
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

  -- Count completed transactions
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

  -- Find matching level
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

-- ============================================================
-- TRIGGER: auto-initialize trust profile when wallet is provisioned
-- ============================================================
CREATE OR REPLACE FUNCTION handle_wallet_provisioned()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.provisioned_at IS NOT NULL AND (OLD.provisioned_at IS NULL OR OLD IS NULL) THEN
    PERFORM initialize_trust_profile(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_wallet_provisioned ON wallets;
CREATE TRIGGER on_wallet_provisioned
  AFTER INSERT OR UPDATE OF provisioned_at ON wallets
  FOR EACH ROW EXECUTE FUNCTION handle_wallet_provisioned();

-- ============================================================
-- TRIGGER: score event on completed ledger transaction
-- Awards/deducts on meaningful transaction outcomes
-- ============================================================
CREATE OR REPLACE FUNCTION handle_ledger_transaction_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet_user UUID;
  v_idem_key    TEXT;
  v_policy      RECORD;
  v_delta       INTEGER;
BEGIN
  -- Only fire on status transitions TO COMPLETED or FAILED
  IF NEW.status NOT IN ('COMPLETED','FAILED') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;

  -- Award sender for completed TRANSFER
  IF NEW.status = 'COMPLETED' AND NEW.transaction_type = 'TRANSFER'
     AND NEW.sender_wallet_id IS NOT NULL THEN
    SELECT user_id INTO v_wallet_user FROM wallets WHERE id = NEW.sender_wallet_id;
    IF FOUND THEN
      v_idem_key := 'tx-complete-' || NEW.id::TEXT || '-sender';
      -- Small positive signal only every 5 completed transfers (streak)
      PERFORM apply_score_adjustment(
        v_wallet_user, v_idem_key,
        (v_policy.config->'adjustments'->>'completed_tx_streak')::INT / 5,
        'TRANSACTION_RELIABILITY',
        'Successful transfer completed.',
        'RULE:TX_COMPLETE', FALSE, NEW.id, NULL
      );
      PERFORM refresh_trust_profile_label(v_wallet_user);
    END IF;
  END IF;

  -- Penalise sender for repeated FAILED transactions
  IF NEW.status = 'FAILED' AND NEW.sender_wallet_id IS NOT NULL THEN
    SELECT user_id INTO v_wallet_user FROM wallets WHERE id = NEW.sender_wallet_id;
    IF FOUND THEN
      v_idem_key := 'tx-failed-' || NEW.id::TEXT;
      PERFORM apply_score_adjustment(
        v_wallet_user, v_idem_key,
        (v_policy.config->'adjustments'->>'failed_tx_repeat')::INT,
        'TRANSACTION_RELIABILITY',
        'Transaction failed — repeated failures may indicate an issue requiring review.',
        'RULE:TX_FAIL', FALSE, NEW.id, NULL
      );
      PERFORM refresh_trust_profile_label(v_wallet_user);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_ledger_tx_status_change ON ledger_transactions;
CREATE TRIGGER on_ledger_tx_status_change
  AFTER UPDATE OF status ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION handle_ledger_transaction_complete();

-- ============================================================
-- TRIGGER: score event on card transaction outcome
-- ============================================================
CREATE OR REPLACE FUNCTION handle_card_transaction_outcome()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet_user UUID;
  v_idem_key    TEXT;
  v_policy      RECORD;
BEGIN
  IF NEW.status NOT IN ('DECLINED') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT * INTO v_policy FROM trust_score_policy WHERE is_active = TRUE LIMIT 1;

  -- Repeated declines are a weak negative signal
  SELECT w.user_id INTO v_wallet_user
  FROM virtual_cards vc JOIN wallets w ON w.id = vc.wallet_id
  WHERE vc.id = NEW.card_id;

  IF FOUND THEN
    v_idem_key := 'card-declined-' || NEW.id::TEXT;
    PERFORM apply_score_adjustment(
      v_wallet_user, v_idem_key,
      -3,
      'ACCOUNT_SECURITY',
      'Card transaction declined: ' || COALESCE(NEW.decline_reason, 'unknown reason') || '. Repeated declines trigger review.',
      'RULE:CARD_DECLINE', FALSE, NULL, NULL
    );
    PERFORM refresh_trust_profile_label(v_wallet_user);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_card_txn_outcome ON card_transactions;
CREATE TRIGGER on_card_txn_outcome
  AFTER INSERT OR UPDATE OF status ON card_transactions
  FOR EACH ROW EXECUTE FUNCTION handle_card_transaction_outcome();

-- ============================================================
-- VIEW: trust_dashboard (admin-only via service role)
-- ============================================================
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
