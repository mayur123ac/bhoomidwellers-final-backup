// lib/import/types.ts
// Type definitions for the staged Excel import pipeline.

export type ImportStatus =
  | 'uploaded' | 'parsing' | 'parsed' | 'ready_for_review'
  | 'committing' | 'completed' | 'failed' | 'cancelled'
  | 'rolling_back' | 'rolled_back';

export type ValidationStatus = 'pending' | 'valid' | 'invalid';
export type ProposedAction = 'create' | 'update' | 'skip' | 'manual_review' | 'error';
export type FinalAction = 'created' | 'updated' | 'skipped' | 'failed' | 'rolled_back';

export interface ImportJob {
  id: string;
  organization_id: string;
  uploaded_by_id: number;
  uploaded_by_name: string;
  filename: string;
  file_hash: string | null;
  file_size_bytes: number | null;
  import_type: string;
  target_entity: string;
  status: ImportStatus;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_rows: number;
  updated_rows: number;
  skipped_rows: number;
  failed_rows: number;
  sheet_name: string | null;
  column_mapping: Record<string, string> | null;
  assigned_to: string | null;
  overseeing_site_head: string | null;
  error_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRow {
  id: string;
  import_job_id: string;
  organization_id: string;
  source_row_number: number;
  source_sheet: string | null;
  raw_data: Record<string, any>;
  normalized_data: Record<string, any> | null;
  validation_status: ValidationStatus;
  proposed_action: ProposedAction;
  final_action: FinalAction | null;
  matched_record_id: number | null;
  target_record_id: number | null;
  warnings: string[];
  errors: string[];
  created_at: string;
}

export interface ImportError {
  id: string;
  import_job_id: string;
  import_row_id: string | null;
  source_row_number: number | null;
  source_field: string | null;
  error_code: string;
  error_message: string;
  severity: 'error' | 'warning' | 'info';
  original_value: string | null;
  normalized_value: string | null;
  created_at: string;
}

export interface StageResult {
  jobId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  sheetName: string;
}

export interface CommitResult {
  jobId: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface RollbackResult {
  jobId: string;
  rolledBack: number;
}

export interface ImportTemplate {
  id: string;
  organization_id: string;
  name: string;
  import_type: string;
  target_entity: string;
  mappings: Record<string, string>;
  ignored_columns: string[];
  value_mappings: Record<string, Record<string, string>>;
  date_format: string;
  is_default: boolean;
  version: number;
  created_by_id: number | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// Valid state transitions
export const VALID_TRANSITIONS: Record<ImportStatus, ImportStatus[]> = {
  uploaded: ['parsing', 'cancelled'],
  parsing: ['ready_for_review', 'failed'],
  parsed: ['ready_for_review'],
  ready_for_review: ['committing', 'cancelled'],
  committing: ['completed', 'failed'],
  completed: ['rolling_back'],
  failed: ['cancelled'],
  cancelled: [],
  rolling_back: ['rolled_back', 'failed'],
  rolled_back: [],
};
