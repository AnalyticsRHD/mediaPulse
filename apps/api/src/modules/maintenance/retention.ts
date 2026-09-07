import ExcelJS from 'exceljs';

export const TABLES = [
  'daily_metrics', 'manual_investment_deviation_comments',
  'manual_investment_lines', 'manual_investment_logs'
] as const;
export const DELETE_ORDER = [TABLES[1], TABLES[3], TABLES[2], TABLES[0]];
export type Snapshot = { table: string; columns: string[]; rows: Record<string, string | null>[]; raw: string[] };

const OMITTED_METRIC_COLUMNS = new Set(['impressions', 'clicks', 'conversions', 'revenue']);

// Calendar months in UTC: October retains August, September and October.
export function retentionCutoff(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString();
}

export async function makeWorkbook(snapshots: Snapshot[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const names = ['daily_metrics', 'Comentarios', 'Lineas', 'Logs'];
  for (const [index, snapshot] of snapshots.entries()) {
    const sheet = workbook.addWorksheet(names[index], { views: [{ state: 'frozen', ySplit: 1 }] });
    const columns = snapshot.columns.filter(key => snapshot.table !== 'daily_metrics' || !OMITTED_METRIC_COLUMNS.has(key));
    sheet.columns = columns.map(key => ({ header: key, key, width: key.endsWith('_at') ? 36 : 28 }));
    for (const row of snapshot.rows) {
      const values = columns.map(key => row[key]);
      for (const value of values) {
        if (value !== null && value.length > 32767) throw new Error('Una celda supera el límite de Excel; no se eliminaron datos.');
      }
      // Preserve microseconds, timezone, exact decimals and identifiers as literal text.
      sheet.addRow(values);
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24364B' } };
    sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(1).height = 40;
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: snapshot.rows.length + 1, column: columns.length } };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
