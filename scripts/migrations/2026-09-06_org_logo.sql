ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_key TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT;
