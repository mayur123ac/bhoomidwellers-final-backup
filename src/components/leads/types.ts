// components/leads/types.ts — Shared types for LeadDetailsPanel

export interface LeadPermissions {
  canEditContact: boolean;
  canEditPhone: boolean;
  canFillSalesform: boolean;
  canTrackLoan: boolean;
  canMarkClosing: boolean;
  canMarkLost: boolean;
  canRestoreLead: boolean;
  canReopenLead: boolean;
  canViewBooking: boolean;
  canCreateBooking: boolean;
  canDeleteLead: boolean;
  canAdvanceStage: boolean;
  canSendFollowUp: boolean;
  canDeleteFollowUp: boolean;
  canCall: boolean;
  canWhatsApp: boolean;
}

export interface LeadUser {
  id?: number;
  name?: string;
  email?: string;
  role: string;
}

export interface LeadDetailCallbacks {
  onBack: () => void;
  onRefetch: () => void;
  onShowToast: (msg: string) => void;
  fetchLoanDealData: (leadId: number | string) => void;
  onSendFollowUp: (note: string) => Promise<void>;
  onDeleteFollowUp: (id: number) => Promise<void>;
  onOpenBookingForm: (editMode?: boolean, existingBooking?: any) => void;
  onOpenLostModal: () => void;
  onOpenReminderModal: () => void;
  onOpenWhatsApp: () => void;
  onRestore: () => void;
  onReopen: () => void;
  onDeleteLead?: () => void;
  onSubmitSalesForm?: (data: any) => Promise<void>;
}

export interface LeadDetailData {
  lead: any;
  onLeadUpdate: (updater: (prev: any) => any) => void;
  followUps: any[];
  bookingData: any;
  loanDealBooking: any;
  loanDealLatest: any;
  attView: any;
}

export interface LeadDetailsTheme {
  isDark: boolean;
  theme: Record<string, any>;
}
