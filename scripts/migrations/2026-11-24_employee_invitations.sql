-- Employee invitations: secure, expiring, single-use tokens for account setup.
--
-- The token_hash column stores SHA-256(token) so the plaintext never lands in
-- the database. The token itself is sent only via email and in the accept URL.

CREATE TABLE IF NOT EXISTS employee_invitations (
  id            SERIAL       PRIMARY KEY,
  user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT         NOT NULL,
  organization_id UUID       NOT NULL,
  invited_by    INTEGER      NOT NULL REFERENCES users(id),
  email         TEXT         NOT NULL,
  expires_at    TIMESTAMPTZ  NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_invitations_token_hash
  ON employee_invitations (token_hash)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_invitations_user_id
  ON employee_invitations (user_id);
