ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enquiry_primary_color TEXT,
  ADD COLUMN IF NOT EXISTS enquiry_secondary_color TEXT,
  ADD COLUMN IF NOT EXISTS enquiry_text_color TEXT;
