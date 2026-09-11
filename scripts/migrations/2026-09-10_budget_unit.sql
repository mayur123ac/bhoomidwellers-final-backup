ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS budget_unit TEXT
    CHECK (budget_unit IN ('thousand', 'lakh', 'crore'));
