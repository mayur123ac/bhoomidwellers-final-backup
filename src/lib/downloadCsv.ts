/**
 * Client-side CSV export for chart and table data.
 *
 * Lives here rather than inline in dashboard/page.tsx because the chart
 * components were split out into their own lazily-loaded module and still need
 * it; a shared 20-line util keeps recharts out of the initial bundle without
 * duplicating the exporter.
 */
export const downloadCSV = (data: any[], filename: string) => {
  if (!data || data.length === 0) {
    alert("No data to export.");
    return;
  }
  const headers = Object.keys(data[0]);
  const csvRows = data.map(row =>
    headers.map(fieldName => JSON.stringify(row[fieldName] ?? "")).join(",")
  );
  const csvString = [headers.join(","), ...csvRows].join("\r\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
