const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { retentionCutoff, makeWorkbook, TABLES } = require('../dist/modules/maintenance/retention');
const pool = require('../dist/config/database-pool');
const { MaintenanceService } = require('../dist/modules/maintenance/maintenance.service');

test('calendar retention keeps current month and two previous months in UTC', () => {
  assert.equal(retentionCutoff(new Date('2026-10-31T23:59:59Z')), '2026-08-01T00:00:00.000Z');
  assert.equal(retentionCutoff(new Date('2026-01-01T00:00:00Z')), '2025-11-01T00:00:00.000Z');
  assert.equal(retentionCutoff(new Date('2024-04-30T12:00:00Z')), '2024-02-01T00:00:00.000Z');
  assert.equal(retentionCutoff(new Date('2026-09-01T00:00:00Z')), '2026-07-01T00:00:00.000Z');
});

test('Excel omits only the four daily_metrics columns and keeps remaining cells aligned', async () => {
  const row = { id: 'a', impressions: '0', clicks: '0', conversions: '0', revenue: '0', spend: '12.50', created_at: '2026-09-01T00:00:00+00:00' };
  const snapshots = TABLES.map(table => ({ table, columns: Object.keys(row), rows: [row], raw: [JSON.stringify(row)] }));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await makeWorkbook(snapshots));
  assert.deepEqual(workbook.worksheets[0].getRow(1).values.slice(1), ['id', 'spend', 'created_at']);
  assert.deepEqual(workbook.worksheets[0].getRow(2).values.slice(1), ['a', '12.50', row.created_at]);
  assert.deepEqual(workbook.worksheets[1].getRow(1).values.slice(1), Object.keys(row));
  assert.equal(snapshots[0].raw[0], JSON.stringify(row));
});

test('Excel preserves precision, timestamps, JSON and formula-like literal strings', async () => {
  const row = { id: '9007199254740993', created_at: '2026-09-01T21:31:38.029886+00:00', amount: '123456789012345.12345', text: '=1+1', snapshot: '{"comma":"a,b"}', empty: null };
  const snapshots = TABLES.map(table => ({ table, columns: Object.keys(row), rows: [row], raw: [JSON.stringify(row)] }));
  const buffer = await makeWorkbook(snapshots);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 4);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.rowCount, 2);
    assert.deepEqual(sheet.getRow(2).values.slice(1, 6), Object.values(row).slice(0, 5));
    assert.equal(sheet.getCell('D2').type, ExcelJS.ValueType.String);
  }
  snapshots[0].rows = [{ ...row, text: 'x'.repeat(32768) }];
  await assert.rejects(makeWorkbook(snapshots), /límite de Excel/);
});

test('backup is durable before deletion, failures roll back, and IDs cannot repeat', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mediapulse-retention-'));
  const previous = process.env.RETENTION_BACKUP_DIR;
  const original = pool.getSharedDatabasePool;
  process.env.RETENTION_BACKUP_DIR = root;
  let queries, id, recentChildren = false, failDelete = false;
  const client = { release() {}, async query(sql, params) {
    queries.push(sql);
    if (sql.startsWith('SELECT clock_timestamp')) return { rows: [{ now: '2026-10-12T12:00:00Z' }] };
    if (sql.includes('FROM pg_constraint')) return { rows: [{ child: TABLES[1], parent: TABLES[2], definition: 'FOREIGN KEY (manual_investment_line_id) REFERENCES manual_investment_lines(id) ON DELETE CASCADE' }] };
    if (sql.includes('FROM pg_trigger')) return { rows: [], rowCount: 0 };
    if (sql.includes('SELECT 1 FROM public.manual_investment_deviation_comments')) return { rows: [], rowCount: recentChildren ? 1 : 0 };
    if (sql.startsWith('SELECT count')) return { rows: [{ count: 1 }] };
    if (sql.includes('information_schema.columns')) return { rows: [{ column_name: 'id' }, { column_name: 'created_at' }] };
    if (sql.startsWith('SELECT row_to_json')) return { rows: [{ raw: '{"id":"a","created_at":"2026-06-01T00:00:00+00:00"}', cells: { id: 'a', created_at: '2026-06-01T00:00:00+00:00' } }] };
    if (sql.startsWith('DELETE')) {
      assert.match(sql, /WHERE created_at < \$1::timestamptz$/);
      assert.equal(params[0], '2026-08-01T00:00:00.000Z');
      for (const file of ['backup.xlsx', 'backup.json', 'prepared.json']) assert.ok((await fs.stat(path.join(root, id, file))).size > 0);
      if (failDelete) throw new Error('simulated database failure');
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  pool.getSharedDatabasePool = () => ({ connect: async () => client });
  try {
    const service = new MaintenanceService({ database: {} });
    queries = []; id = randomUUID();
    const result = await service.run(id, 'admin');
    assert.ok(result.excel.length);
    assert.equal(queries.filter(q => q.startsWith('DELETE')).length, 4);
    assert.ok(queries.includes('COMMIT'));
    assert.equal((await service.status(id)).status, 'completed');
    assert.deepEqual(await service.download(id), result.excel);
    await assert.rejects(service.run(id, 'admin'), /ID ya utilizado/);

    queries = []; id = randomUUID(); recentChildren = true;
    await assert.rejects(service.run(id, 'admin'), /comentarios vigentes/);
    assert.ok(queries.includes('ROLLBACK'));
    assert.ok(!queries.some(q => q.startsWith('DELETE')));

    queries = []; id = randomUUID(); recentChildren = false; failDelete = true;
    await assert.rejects(service.run(id, 'admin'), /simulated database failure/);
    assert.ok(queries.includes('ROLLBACK'));
    assert.ok(!queries.includes('COMMIT'));
    assert.equal((await service.status(id)).status, 'unconfirmed');
    assert.ok((await service.download(id)).length);

    queries = []; id = randomUUID(); failDelete = false;
    service.save = async () => { throw new Error('disk full'); };
    await assert.rejects(service.run(id, 'admin'), /disk full/);
    assert.ok(queries.includes('ROLLBACK'));
    assert.ok(!queries.some(q => q.startsWith('DELETE')));
  } finally {
    pool.getSharedDatabasePool = original;
    if (previous === undefined) delete process.env.RETENTION_BACKUP_DIR; else process.env.RETENTION_BACKUP_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
