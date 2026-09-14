CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 totp_secret TEXT, totp_pending TEXT, totp_pending_at TIMESTAMPTZ,
 totp_last_step BIGINT NOT NULL DEFAULT -1, legacy_imported BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS organizations (
 id UUID PRIMARY KEY, name TEXT NOT NULL,
 owner_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS organization_members (
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','operator','viewer')),
 joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(organization_id,user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user ON organization_members(user_id,joined_at);
CREATE TABLE IF NOT EXISTS sessions (
 id_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL, authenticated BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL,
 last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip TEXT NOT NULL, user_agent TEXT NOT NULL
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS email_tokens (
 token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL,
 PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE IF NOT EXISTS security_events (
 id BIGSERIAL PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 event TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS security_events_user ON security_events(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS request_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_invitations (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),
 token_hash TEXT UNIQUE NOT NULL, created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 expires_at TIMESTAMPTZ NOT NULL, accepted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS organization_invitations_org ON organization_invitations(organization_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending
  ON organization_invitations(organization_id,email) WHERE accepted_at IS NULL;
CREATE TABLE IF NOT EXISTS organization_audit_log (
 id BIGSERIAL PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL, event TEXT NOT NULL,
 target_type TEXT, target_id TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 ip TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS organization_audit_recent ON organization_audit_log(organization_id,created_at DESC);
CREATE TABLE IF NOT EXISTS exchange_connections (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 exchange TEXT NOT NULL, name TEXT NOT NULL,
 key_hint TEXT NOT NULL, credentials TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_checked TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'connected',
 UNIQUE(user_id,name)
);
CREATE INDEX IF NOT EXISTS exchange_connections_user ON exchange_connections(user_id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exchange_connections_exchange_check') THEN
    ALTER TABLE exchange_connections DROP CONSTRAINT exchange_connections_exchange_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exchange_connections_supported') THEN
    ALTER TABLE exchange_connections ADD CONSTRAINT exchange_connections_supported CHECK(exchange IN ('bitget','bybit','gate','okx','binance'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS user_settings (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, settings JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_transactions (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL,
 from_address TEXT NOT NULL, to_address TEXT, nonce BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), missing_checks INTEGER NOT NULL DEFAULT 0,
 replacement_hash TEXT, tx_data JSONB NOT NULL, PRIMARY KEY(user_id,hash)
);
CREATE INDEX IF NOT EXISTS user_tx_pending ON user_transactions(user_id,from_address,nonce) WHERE status='pending';
CREATE INDEX IF NOT EXISTS user_tx_recent ON user_transactions(user_id,first_seen DESC);
CREATE TABLE IF NOT EXISTS user_pending_queue (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 from_address TEXT NOT NULL, nonce BIGINT NOT NULL,
 first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 resolved_at TIMESTAMPTZ, source TEXT NOT NULL DEFAULT 'nonce-reconciliation',
 PRIMARY KEY(user_id,from_address,nonce)
);
CREATE INDEX IF NOT EXISTS user_pending_queue_open
  ON user_pending_queue(user_id,from_address,nonce) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS user_monitor_state (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS user_alert_log (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, scope_key TEXT NOT NULL,
 last_sent TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,kind,scope_key)
);
CREATE TABLE IF NOT EXISTS user_push_subscriptions (
 endpoint TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
 subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
