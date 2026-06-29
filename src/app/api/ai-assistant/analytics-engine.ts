// analytics-engine.ts
export function buildLeadAnalytics(leads: Lead[]) {
  const active = leads.filter(l => l.interest !== 'Not Interested' && l.interest !== 'Lost');
  
  // Config demand
  const configMap = leads.reduce((acc, l) => {
    const config = l.config || 'Unknown';
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
    .map(l => daysBetween(l.createdAt, l.visitDate));
  const avgVelocity = velocities.length 
    ? Math.round(velocities.reduce((a,b) => a+b, 0) / velocities.length) 
    : null;

  // Priority leads (visit scheduled + high budget + multiple follow-ups)
  const priorityLeads = leads
    .filter(l => l.visitDate || l.followUpCount > 2)
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
    topSources: getTopN(leads.map(l => l.source), 3),
    topLocations: getTopN(leads.map(l => l.location), 3),
  };
}