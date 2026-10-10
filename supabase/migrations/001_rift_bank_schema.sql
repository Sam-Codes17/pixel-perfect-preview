-- ============================================================
-- RIFT BANK — Complete Database Schema
-- Run this in the Supabase SQL Editor (project: gazjbspyjngfqdorlduh)
-- ============================================================

-- ============================================================
-- CURRENCIES
-- ============================================================
CREATE TABLE IF NOT EXISTS currencies (
  id          TEXT PRIMARY KEY,
  name        TEXT        NOT NULL,
  symbol      TEXT        NOT NULL,
  decimals    SMALLINT    NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  is_transferable BOOLEAN NOT NULL DEFAULT TRUE,
  exchange_rates  JSONB   NOT NULL DEFAULT '{}',
  initial_allocation BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO currencies (id, name, symbol, decimals, initial_allocation, exchange_rates) VALUES
  ('RFM',  'RIFT Money', 'RFM',  0, 10000000, '{"AUR":0.25,"NEX":0.5,"VELA":0.075}'),
  ('AUR',  'Auric',      'AUR',  0,  2500000, '{"RFM":4.0,"NEX":2.0,"VELA":0.3}'),
  ('NEX',  'Nexus',      'NEX',  0,  5000000, '{"RFM":2.0,"AUR":0.5,"VELA":0.15}'),
  ('VELA', 'Vela',       'VELA', 0,   750000, '{"RFM":13.333,"AUR":3.333,"NEX":6.667}')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- PROFILES (auto-created via trigger on auth.users insert)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  avatar_url  TEXT,
  role        TEXT  NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- WALLETS
-- ============================================================
CREATE TABLE IF NOT EXISTS wallets (
  id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID  NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  wallet_number  TEXT  UNIQUE NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  provisioned_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallets_select_own" ON wallets;
CREATE POLICY "wallets_select_own" ON wallets
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- WALLET BALANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_balances (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         UUID  NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  currency_id       TEXT  NOT NULL REFERENCES currencies(id),
  available_balance BIGINT NOT NULL DEFAULT 0,
  reserved_balance  BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(wallet_id, currency_id),
  CONSTRAINT non_negative_available CHECK (available_balance >= 0),
  CONSTRAINT non_negative_reserved  CHECK (reserved_balance  >= 0)
);

ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_balances_select_own" ON wallet_balances;
CREATE POLICY "wallet_balances_select_own" ON wallet_balances
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM wallets w WHERE w.id = wallet_id AND w.user_id = auth.uid())
  );

-- ============================================================
-- LEDGER ACCOUNTS (double-entry internal accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type TEXT NOT NULL CHECK (account_type IN ('SYSTEM_ISSUANCE','USER_WALLET','MERCHANT')),
  reference_id UUID,
  currency_id  TEXT NOT NULL REFERENCES currencies(id),
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LEDGER TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN (
    'INITIAL_ALLOCATION','TRANSFER','EXCHANGE_DEBIT','EXCHANGE_CREDIT',
    'CARD_PURCHASE','MERCHANT_CREDIT','REFUND'
  )),
  status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','PROCESSING','COMPLETED','REJECTED','FAILED','CANCELLED','EXPIRED'
  )),
  sender_wallet_id    UUID REFERENCES wallets(id),
  receiver_wallet_id  UUID REFERENCES wallets(id),
  currency_id         TEXT NOT NULL REFERENCES currencies(id),
  amount              BIGINT NOT NULL CHECK (amount > 0),
  fee_amount          BIGINT NOT NULL DEFAULT 0,
  idempotency_key     TEXT UNIQUE NOT NULL,
  reference           TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_txn_select_own" ON ledger_transactions;
CREATE POLICY "ledger_txn_select_own" ON ledger_transactions
  FOR SELECT USING (
    sender_wallet_id   IN (SELECT id FROM wallets WHERE user_id = auth.uid())
    OR
    receiver_wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid())
  );

-- ============================================================
-- LEDGER ENTRIES (double-entry debit/credit pairs)
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL REFERENCES ledger_transactions(id),
  ledger_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
  entry_type       TEXT NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
  currency_id      TEXT NOT NULL REFERENCES currencies(id),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MERCHANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS merchants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  slug                 TEXT UNIQUE NOT NULL,
  description          TEXT,
  category             TEXT,
  logo_emoji           TEXT DEFAULT '🏢',
  accepted_currencies  TEXT[] NOT NULL DEFAULT '{RFM}',
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merchants_select_active" ON merchants;
CREATE POLICY "merchants_select_active" ON merchants
  FOR SELECT USING (is_active = TRUE);

INSERT INTO merchants (name, slug, description, category, logo_emoji, accepted_currencies) VALUES
  ('RIFT Digital',       'rift-digital',       'Digital goods, software licenses and downloads',          'Digital',       '💻', '{RFM,AUR,NEX}'),
  ('RIFT Cloud',         'rift-cloud',         'Cloud hosting, storage and compute services',              'Technology',    '☁️', '{RFM,NEX}'),
  ('RIFT Market',        'rift-market',        'General merchandise and everyday essentials',              'Retail',        '🛒', '{RFM,AUR,VELA}'),
  ('RIFT Travel',        'rift-travel',        'Flights, hotels and travel packages in the RIFT world',   'Travel',        '✈️', '{RFM,AUR}'),
  ('RIFT Subscriptions', 'rift-subscriptions', 'Premium subscriptions, memberships and recurring services','Subscriptions','⭐', '{RFM,NEX,VELA}')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- VIRTUAL CARDS
-- ============================================================
CREATE TABLE IF NOT EXISTS virtual_cards (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id               UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  card_name               TEXT NOT NULL,
  masked_number           TEXT NOT NULL,
  cardholder_name         TEXT NOT NULL,
  expiry_month            SMALLINT NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year             SMALLINT NOT NULL,
  currency_id             TEXT NOT NULL DEFAULT 'RFM' REFERENCES currencies(id),
  status                  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FROZEN','TERMINATED')),
  spending_limit_daily    BIGINT CHECK (spending_limit_daily IS NULL OR spending_limit_daily > 0),
  spending_limit_monthly  BIGINT CHECK (spending_limit_monthly IS NULL OR spending_limit_monthly > 0),
  online_purchases_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE virtual_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "virtual_cards_select_own" ON virtual_cards;
CREATE POLICY "virtual_cards_select_own" ON virtual_cards
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM wallets w WHERE w.id = wallet_id AND w.user_id = auth.uid())
  );

-- ============================================================
-- MERCHANT ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS merchant_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id          UUID NOT NULL REFERENCES merchants(id),
  wallet_id            UUID NOT NULL REFERENCES wallets(id),
  card_id              UUID REFERENCES virtual_cards(id),
  ledger_transaction_id UUID REFERENCES ledger_transactions(id),
  amount               BIGINT NOT NULL CHECK (amount > 0),
  currency_id          TEXT NOT NULL REFERENCES currencies(id),
  status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED','CANCELLED')),
  items                JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE merchant_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merchant_orders_select_own" ON merchant_orders;
CREATE POLICY "merchant_orders_select_own" ON merchant_orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM wallets w WHERE w.id = wallet_id AND w.user_id = auth.uid())
  );

-- ============================================================
-- CARD TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS card_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id               UUID NOT NULL REFERENCES virtual_cards(id),
  merchant_id           UUID REFERENCES merchants(id),
  order_id              UUID REFERENCES merchant_orders(id),
  ledger_transaction_id UUID REFERENCES ledger_transactions(id),
  amount                BIGINT NOT NULL CHECK (amount > 0),
  currency_id           TEXT NOT NULL REFERENCES currencies(id),
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','DECLINED','REFUNDED')),
  description           TEXT,
  decline_reason        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE card_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "card_txn_select_own" ON card_transactions;
CREATE POLICY "card_txn_select_own" ON card_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM virtual_cards vc
      JOIN wallets w ON w.id = vc.wallet_id
      WHERE vc.id = card_id AND w.user_id = auth.uid()
    )
  );

-- ============================================================
-- CURRENCY EXCHANGE QUOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS currency_exchange_quotes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id        UUID NOT NULL REFERENCES wallets(id),
  from_currency_id TEXT NOT NULL REFERENCES currencies(id),
  to_currency_id   TEXT NOT NULL REFERENCES currencies(id),
  from_amount      BIGINT NOT NULL CHECK (from_amount > 0),
  to_amount        BIGINT NOT NULL CHECK (to_amount > 0),
  rate             NUMERIC(20,8) NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  used             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE currency_exchange_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_select_own" ON currency_exchange_quotes;
CREATE POLICY "quotes_select_own" ON currency_exchange_quotes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM wallets w WHERE w.id = wallet_id AND w.user_id = auth.uid())
  );

-- ============================================================
-- AUDIT EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id),
  event_type  TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DATABASE FUNCTIONS
-- ============================================================

-- Trigger: auto-create profile on new auth user
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- FUNCTION: provision_wallet (idempotent — safe to call multiple times)
-- ============================================================
CREATE OR REPLACE FUNCTION provision_wallet(p_user_id UUID)
RETURNS TABLE(wallet_id UUID, wallet_number TEXT)
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
    SELECT id, wallets.wallet_number INTO v_wallet_id, v_wallet_number
    FROM wallets WHERE user_id = p_user_id;
    UPDATE wallets SET provisioned_at = NOW() WHERE id = v_wallet_id;
  ELSE
    v_wallet_number := 'RIFT-' ||
      UPPER(SUBSTRING(MD5(p_user_id::TEXT || '1'), 1, 4)) || '-' ||
      UPPER(SUBSTRING(MD5(p_user_id::TEXT || '2'), 1, 4));
    INSERT INTO wallets (user_id, wallet_number, provisioned_at)
    VALUES (p_user_id, v_wallet_number, NOW())
    RETURNING id INTO v_wallet_id;
  END IF;

  -- Allocate each active currency
  FOR v_currency IN
    SELECT * FROM currencies WHERE is_active = TRUE AND initial_allocation > 0 ORDER BY id
  LOOP
    v_idem_key := 'init-' || p_user_id::TEXT || '-' || v_currency.id;

    CONTINUE WHEN EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = v_idem_key);

    -- Wallet balance (skip if already exists)
    INSERT INTO wallet_balances (wallet_id, currency_id, available_balance)
    VALUES (v_wallet_id, v_currency.id, v_currency.initial_allocation)
    ON CONFLICT (wallet_id, currency_id) DO NOTHING;

    -- System issuance account
    SELECT id INTO v_system_acct_id FROM ledger_accounts
    WHERE account_type = 'SYSTEM_ISSUANCE' AND currency_id = v_currency.id LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO ledger_accounts (account_type, currency_id, name)
      VALUES ('SYSTEM_ISSUANCE', v_currency.id, 'RIFT System Issuance — ' || v_currency.id)
      RETURNING id INTO v_system_acct_id;
    END IF;

    -- User wallet account
    SELECT id INTO v_user_acct_id FROM ledger_accounts
    WHERE account_type = 'USER_WALLET' AND reference_id = v_wallet_id AND currency_id = v_currency.id LIMIT 1;
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
-- FUNCTION: execute_transfer (atomic, idempotent)
-- ============================================================
CREATE OR REPLACE FUNCTION execute_transfer(
  p_sender_wallet_id   UUID,
  p_receiver_wallet_id UUID,
  p_currency_id        TEXT,
  p_amount             BIGINT,
  p_idempotency_key    TEXT,
  p_reference          TEXT DEFAULT NULL
)
RETURNS TABLE(transaction_id UUID, txn_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_txn_id         UUID;
  v_existing_status TEXT;
  v_sender_balance  BIGINT;
  v_sender_acct_id  UUID;
  v_receiver_acct_id UUID;
BEGIN
  -- Idempotency
  SELECT id, status INTO v_txn_id, v_existing_status
  FROM ledger_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_txn_id, v_existing_status;
    RETURN;
  END IF;

  -- Lock and check sender balance
  SELECT available_balance INTO v_sender_balance
  FROM wallet_balances
  WHERE wallet_id = p_sender_wallet_id AND currency_id = p_currency_id
  FOR UPDATE;

  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: No % balance on sender wallet', p_currency_id;
  END IF;
  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Available % < Required %', v_sender_balance, p_amount;
  END IF;

  -- Create transaction record
  INSERT INTO ledger_transactions (
    transaction_type, status, sender_wallet_id, receiver_wallet_id,
    currency_id, amount, idempotency_key, reference
  ) VALUES (
    'TRANSFER', 'PROCESSING', p_sender_wallet_id, p_receiver_wallet_id,
    p_currency_id, p_amount, p_idempotency_key, p_reference
  ) RETURNING id INTO v_txn_id;

  -- Debit sender
  UPDATE wallet_balances
  SET available_balance = available_balance - p_amount, updated_at = NOW()
  WHERE wallet_id = p_sender_wallet_id AND currency_id = p_currency_id;

  -- Credit receiver (upsert)
  INSERT INTO wallet_balances (wallet_id, currency_id, available_balance)
  VALUES (p_receiver_wallet_id, p_currency_id, p_amount)
  ON CONFLICT (wallet_id, currency_id) DO UPDATE
    SET available_balance = wallet_balances.available_balance + p_amount, updated_at = NOW();

  -- Ledger accounts
  SELECT id INTO v_sender_acct_id FROM ledger_accounts
  WHERE account_type='USER_WALLET' AND reference_id=p_sender_wallet_id AND currency_id=p_currency_id LIMIT 1;

  SELECT id INTO v_receiver_acct_id FROM ledger_accounts
  WHERE account_type='USER_WALLET' AND reference_id=p_receiver_wallet_id AND currency_id=p_currency_id LIMIT 1;

  IF v_sender_acct_id IS NOT NULL THEN
    INSERT INTO ledger_entries (transaction_id, ledger_account_id, entry_type, currency_id, amount)
    VALUES (v_txn_id, v_sender_acct_id, 'DEBIT', p_currency_id, p_amount);
  END IF;

  IF v_receiver_acct_id IS NOT NULL THEN
    INSERT INTO ledger_entries (transaction_id, ledger_account_id, entry_type, currency_id, amount)
    VALUES (v_txn_id, v_receiver_acct_id, 'CREDIT', p_currency_id, p_amount);
  END IF;

  -- Complete
  UPDATE ledger_transactions SET status='COMPLETED', completed_at=NOW() WHERE id=v_txn_id;

  RETURN QUERY SELECT v_txn_id, 'COMPLETED'::TEXT;
END;
$$;

-- ============================================================
-- FUNCTION: execute_exchange (atomic, idempotent, quote-gated)
-- ============================================================
CREATE OR REPLACE FUNCTION execute_exchange(
  p_wallet_id       UUID,
  p_quote_id        UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE(transaction_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quote        RECORD;
  v_from_balance BIGINT;
  v_debit_txn_id UUID;
BEGIN
  -- Idempotency
  SELECT id INTO v_debit_txn_id FROM ledger_transactions WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN QUERY SELECT v_debit_txn_id; RETURN; END IF;

  -- Lock and validate quote
  SELECT * INTO v_quote FROM currency_exchange_quotes
  WHERE id=p_quote_id AND wallet_id=p_wallet_id AND used=FALSE AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUOTE_EXPIRED_OR_INVALID';
  END IF;

  UPDATE currency_exchange_quotes SET used=TRUE WHERE id=p_quote_id;

  -- Check from balance
  SELECT available_balance INTO v_from_balance
  FROM wallet_balances
  WHERE wallet_id=p_wallet_id AND currency_id=v_quote.from_currency_id
  FOR UPDATE;

  IF v_from_balance IS NULL OR v_from_balance < v_quote.from_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  -- Debit from
  UPDATE wallet_balances
  SET available_balance = available_balance - v_quote.from_amount, updated_at=NOW()
  WHERE wallet_id=p_wallet_id AND currency_id=v_quote.from_currency_id;

  -- Credit to (upsert)
  INSERT INTO wallet_balances (wallet_id, currency_id, available_balance)
  VALUES (p_wallet_id, v_quote.to_currency_id, v_quote.to_amount)
  ON CONFLICT (wallet_id, currency_id) DO UPDATE
    SET available_balance = wallet_balances.available_balance + v_quote.to_amount, updated_at=NOW();

  -- Transaction records
  INSERT INTO ledger_transactions (
    transaction_type, status, sender_wallet_id, currency_id,
    amount, idempotency_key, reference, metadata, completed_at
  ) VALUES (
    'EXCHANGE_DEBIT', 'COMPLETED', p_wallet_id, v_quote.from_currency_id,
    v_quote.from_amount, p_idempotency_key,
    'Exchange: ' || v_quote.from_currency_id || ' → ' || v_quote.to_currency_id,
    jsonb_build_object('quote_id',p_quote_id,'to_currency',v_quote.to_currency_id,
                       'to_amount',v_quote.to_amount,'rate',v_quote.rate), NOW()
  ) RETURNING id INTO v_debit_txn_id;

  INSERT INTO ledger_transactions (
    transaction_type, status, receiver_wallet_id, currency_id,
    amount, idempotency_key, reference, metadata, completed_at
  ) VALUES (
    'EXCHANGE_CREDIT', 'COMPLETED', p_wallet_id, v_quote.to_currency_id,
    v_quote.to_amount, p_idempotency_key || '-credit',
    'Exchange: ' || v_quote.from_currency_id || ' → ' || v_quote.to_currency_id,
    jsonb_build_object('quote_id',p_quote_id,'from_currency',v_quote.from_currency_id,
                       'from_amount',v_quote.from_amount,'rate',v_quote.rate), NOW()
  );

  RETURN QUERY SELECT v_debit_txn_id;
END;
$$;

-- ============================================================
-- FUNCTION: authorize_card_purchase (atomic auth + debit)
-- ============================================================
CREATE OR REPLACE FUNCTION authorize_card_purchase(
  p_card_id          UUID,
  p_merchant_id      UUID,
  p_amount           BIGINT,
  p_currency_id      TEXT,
  p_idempotency_key  TEXT,
  p_description      TEXT DEFAULT NULL
)
RETURNS TABLE(transaction_id UUID, approved BOOLEAN, decline_reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_card        RECORD;
  v_merchant    RECORD;
  v_wallet_id   UUID;
  v_balance     BIGINT;
  v_daily_spent BIGINT;
  v_txn_id      UUID;
  v_order_id    UUID;
  v_decline     TEXT;
BEGIN
  -- Get card
  SELECT * INTO v_card FROM virtual_cards WHERE id = p_card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CARD_NOT_FOUND'; END IF;
  v_wallet_id := v_card.wallet_id;

  -- Get merchant
  SELECT * INTO v_merchant FROM merchants WHERE id = p_merchant_id AND is_active = TRUE;
  IF NOT FOUND THEN v_decline := 'Merchant not found or inactive'; END IF;

  -- Authorization checks (sequential, first failure wins)
  IF v_decline IS NULL AND v_card.status = 'FROZEN'     THEN v_decline := 'Card is frozen'; END IF;
  IF v_decline IS NULL AND v_card.status = 'TERMINATED' THEN v_decline := 'Card is terminated'; END IF;
  IF v_decline IS NULL AND NOT v_card.online_purchases_enabled THEN v_decline := 'Online purchases disabled on this card'; END IF;
  IF v_decline IS NULL AND NOT (p_currency_id = ANY(v_merchant.accepted_currencies)) THEN
    v_decline := 'Currency ' || p_currency_id || ' not accepted by this merchant';
  END IF;

  -- Balance check
  IF v_decline IS NULL THEN
    SELECT available_balance INTO v_balance
    FROM wallet_balances
    WHERE wallet_id = v_wallet_id AND currency_id = p_currency_id FOR UPDATE;
    IF v_balance IS NULL OR v_balance < p_amount THEN
      v_decline := 'Insufficient balance';
    END IF;
  END IF;

  -- Daily limit check
  IF v_decline IS NULL AND v_card.spending_limit_daily IS NOT NULL THEN
    SELECT COALESCE(SUM(ct.amount), 0) INTO v_daily_spent
    FROM card_transactions ct
    WHERE ct.card_id = p_card_id AND ct.status = 'APPROVED'
      AND ct.created_at >= NOW() - INTERVAL '24 hours';
    IF v_daily_spent + p_amount > v_card.spending_limit_daily THEN
      v_decline := 'Daily spending limit exceeded';
    END IF;
  END IF;

  -- Declined path
  IF v_decline IS NOT NULL THEN
    INSERT INTO card_transactions
      (card_id, merchant_id, amount, currency_id, status, description, decline_reason)
    VALUES (p_card_id, p_merchant_id, p_amount, p_currency_id, 'DECLINED', p_description, v_decline)
    RETURNING id INTO v_txn_id;
    RETURN QUERY SELECT v_txn_id, FALSE, v_decline;
    RETURN;
  END IF;

  -- Approved: debit wallet
  UPDATE wallet_balances
  SET available_balance = available_balance - p_amount, updated_at = NOW()
  WHERE wallet_id = v_wallet_id AND currency_id = p_currency_id;

  -- Ledger transaction
  INSERT INTO ledger_transactions (
    transaction_type, status, sender_wallet_id, currency_id,
    amount, idempotency_key, reference, metadata, completed_at
  ) VALUES (
    'CARD_PURCHASE', 'COMPLETED', v_wallet_id, p_currency_id,
    p_amount, p_idempotency_key, p_description,
    jsonb_build_object('card_id', p_card_id, 'merchant_id', p_merchant_id), NOW()
  ) RETURNING id INTO v_txn_id;

  -- Merchant order
  INSERT INTO merchant_orders
    (merchant_id, wallet_id, card_id, ledger_transaction_id, amount, currency_id, status)
  VALUES (p_merchant_id, v_wallet_id, p_card_id, v_txn_id, p_amount, p_currency_id, 'COMPLETED')
  RETURNING id INTO v_order_id;

  -- Card transaction record
  INSERT INTO card_transactions
    (card_id, merchant_id, order_id, ledger_transaction_id, amount, currency_id, status, description)
  VALUES (p_card_id, p_merchant_id, v_order_id, v_txn_id, p_amount, p_currency_id, 'APPROVED', p_description);

  RETURN QUERY SELECT v_txn_id, TRUE, NULL::TEXT;
END;
$$;
