// analytics-engine.ts

export type Lead = {
  interest?: string;
  config?: string;
  budget?: string;
  visitDate?: string;
  createdAt?: string;
  followUpCount?: number;
  source?: string;
  location?: string;
  [key: string]: unknown;
};

export function buildLeadAnalytics(leads: Lead[]) {
  const active = leads.filter(l => l.interest !== 'Not Interested' && l.interest !== 'Lost');
  
  // Config demand
  const configMap = leads.reduce((acc, l) => {
    const config = (l.config as string) || 'Unknown';
    acc[config] = (acc[config] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Budget stats
  const budgets = leads
    .map(l => parseBudget(l.budget)) // handle "50L", "1.2Cr" etc.
    .filter(Boolean) as number[];
  const avgBudget = budgets.length ? budgets.reduce((a,b) => a+b, 0) / budgets.length : 0;

  // Site visit ratio
  const withVisit = leads.filter(l => l.visitDate).length;
  const siteVisitRatio = leads.length ? ((withVisit / leads.length) * 100).toFixed(1) : '0';

  // Pipeline velocity (lead entry → visit date in days)
  const velocities = leads
    .filter(l => l.visitDate && l.createdAt)
    .map(l => daysBetween(l.createdAt as string, l.visitDate as string));
  const avgVelocity = velocities.length 
    ? Math.round(velocities.reduce((a,b) => a+b, 0) / velocities.length) 
    : null;

  // Priority leads (visit scheduled + high budget + multiple follow-ups)
  const priorityLeads = leads
    .filter(l => l.visitDate || (l.followUpCount ?? 0) > 2)
    .sort((a, b) => (parseBudget(b.budget) || 0) - (parseBudget(a.budget) || 0))
    .slice(0, 5);

  return {
    total: leads.length,
    active: active.length,
    interested: leads.filter(l => l.interest === 'Interested').length,
    notInterested: leads.filter(l => l.interest === 'Not Interested').length,
    lost: leads.filter(l => l.interest === 'Lost').length,
    configBreakdown: configMap,
    avgBudget,
    siteVisitRatio,
    avgVelocity,
    priorityLeads,
    topSources: getTopN(leads.map(l => l.source as string), 3),
    topLocations: getTopN(leads.map(l => l.location as string), 3),
  };
}

function parseBudget(budget?: string): number | null {
  if (!budget) return null;
  const b = budget.trim().toLowerCase();
  const crMatch = b.match(/([\d.]+)\s*cr/);
  if (crMatch) return parseFloat(crMatch[1]) * 100;
  const lakhMatch = b.match(/([\d.]+)\s*l/);
  if (lakhMatch) return parseFloat(lakhMatch[1]);
  const num = parseFloat(b);
  return isNaN(num) ? null : num;
}

function daysBetween(a: string, b: string): number {
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function getTopN(arr: string[], n: number): string[] {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    if (item) counts[item] = (counts[item] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}