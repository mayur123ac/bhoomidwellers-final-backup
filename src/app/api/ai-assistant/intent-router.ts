// intent-router.ts
import type { Lead } from "./analytics-engine";

type Intent = 'greeting' | 'lead_lookup' | 'analytics' | 'psychology' | 'general';

export function classifyIntent(query: string, _leads: Lead[]): Intent {
  const q = query.toLowerCase();
  if (/^(hi|hello|hey|good\s?(morning|afternoon|evening))/.test(q)) return 'greeting';
  if (/lead.?(#?\d+)|phone|mobile|called/.test(q)) return 'lead_lookup';
  if (/budget|conversion|ratio|breakdown|analytics|overview|summary|stats/.test(q)) return 'analytics';
  if (/how to|strategy|approach|convince|lost leads|why/.test(q)) return 'psychology';
  return 'general';
}

export type { Intent };