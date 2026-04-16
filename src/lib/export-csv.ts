/**
 * CSV Export Utility
 *
 * Shared helper for exporting tabular data as .csv files.
 * Used across Reports, Sales, Commissions, Packages, and Inventory pages.
 */

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => string | number | boolean | null | undefined;
}

/**
 * Converts an array of objects to a CSV string using defined columns.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => escapeCsvField(c.header)).join(',');
  const body = rows.map(row =>
    columns.map(col => {
      const val = col.accessor(row);
      return escapeCsvField(val == null ? '' : String(val));
    }).join(',')
  ).join('\n');
  return `${header}\n${body}`;
}

/**
 * Triggers a browser download of a CSV string.
 */
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Helper: wraps and escapes a CSV field value.
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Formats a number as Philippine Peso for CSV export.
 */
export function csvCurrency(n: number): string {
  return n.toFixed(2);
}

/**
 * Formats a date string for CSV export.
 */
export function csvDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleString('en-PH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
