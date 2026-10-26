const UNIT_REGEX = /^([\d\s\-,.]+)\s*(lakh|lakhs|lac|lacs|crore|crores|cr|thousand)\b/i;
function formatBudget(budget, unit) {
  const b = String(budget ?? '').trim();
  if (!b) return '';
  if (b === 'NOT DISCLOSED' || b === 'Not Disclosed' || b === 'Pending' || b === 'N/A') return b;
  if (unit) {
    const u = unit.trim().toLowerCase();
    const label = u === 'lakh' ? 'Lakh' : u === 'crore' ? 'Crore' : u === 'thousand' ? 'Thousand' : null;
    return label ? `₹${b} ${label}` : `₹${b}`;
  }
  const match = b.match(UNIT_REGEX);
  if (match) {
    const amount = match[1].trim();
    const rawUnit = match[2].toLowerCase();
    const label =
      rawUnit === 'lakh' || rawUnit === 'lakhs' || rawUnit === 'lac' || rawUnit === 'lacs' ? 'Lakh'
      : rawUnit === 'crore' || rawUnit === 'crores' || rawUnit === 'cr' ? 'Crore'
      : 'Thousand';
    return `₹${amount} ${label}`;
  }
  return `₹${b}`;
}

const tests = [
  '35lac', '50lacs', '1cr', '1.7cr', '80lacs', '35 lakh', '50 LAKH',
  '1.10 CR', '60-65 lakhs', '90Lakh', '2.75CR', '38lac*', '5Cr', '1.20 Cr',
  'NOT DISCLOSED', 'Pending', '55 LAKH', '1.4 CRORE', '35LAC', '80LAC',
  '1CR', '1.75cr', '50 lakh', '3o lakh', '45- 50 lakh', '55 lakh to 60 lakh',
];
for (const b of tests) {
  console.log(b.padEnd(25) + ' => ' + formatBudget(b, null));
}
