import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ConfigService } from '../../config/config.service';
import { getSharedDatabasePool } from '../../config/database-pool';
import { DELETE_ORDER, makeWorkbook, retentionCutoff, Snapshot, TABLES } from './retention';

@Injectable()
export class MaintenanceService {
  constructor(private readonly config: ConfigService) {}

  private directory(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException();
    const root = process.env.RETENTION_BACKUP_DIR;
    if (!root || !isAbsolute(root)) throw new ServiceUnavailableException('Configurá RETENTION_BACKUP_DIR con un directorio absoluto en almacenamiento persistente.');
    return join(root, id);
  }

  private async save(path: string, content: string | Buffer) {
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  }

  async download(id: string): Promise<Buffer> {
    try { return await readFile(join(this.directory(id), 'backup.xlsx')); }
    catch (error: any) { if (error.code === 'ENOENT') throw new NotFoundException('Respaldo no encontrado'); throw error; }
  }

  async status(id: string) {
    const directory = this.directory(id);
    try { return JSON.parse(await readFile(join(directory, 'completed.json'), 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    try {
      const prepared = JSON.parse(await readFile(join(directory, 'prepared.json'), 'utf8'));
      return { ...prepared, status: 'unconfirmed', message: 'Respaldo disponible. El resultado del borrado no está confirmado; no repetir automáticamente.' };
    } catch (error: any) { if (error.code === 'ENOENT') throw new NotFoundException('Operación sin respaldo confirmado'); throw error; }
  }

  async run(id: string, userId: string) {
    const directory = this.directory(id);
    await mkdir(join(directory, '..'), { recursive: true, mode: 0o700 });
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error: any) { if (error.code === 'EEXIST') throw new ConflictException('ID ya utilizado. Consultá su estado o descargá el respaldo; no se repite el borrado.'); throw error; }
    const client = await getSharedDatabasePool(this.config.database).connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '120s'");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      // Do not silently export a subset when the configured database role is subject to RLS.
      await client.query('SET LOCAL row_security = off');
      // Block writes for the full snapshot/backup/delete operation; reads remain available.
      await client.query(`LOCK TABLE ${TABLES.map(t => `public.${t}`).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
      const { rows: clock } = await client.query('SELECT clock_timestamp() AS now');
      const cutoff = retentionCutoff(new Date(clock[0].now));

      // Fail closed on dependencies not covered by this backup (including indirect cascades).
      const dependencies = await client.query(`SELECT conrelid::regclass::text AS child,
        confrelid::regclass::text AS parent, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE contype = 'f' AND confrelid = ANY($1::regclass[])`, [TABLES.map(t => `public.${t}`)]);
      for (const dependency of dependencies.rows) {
        const child = dependency.child.replace(/^public\./, '');
        const parent = dependency.parent.replace(/^public\./, '');
        if (child !== TABLES[1] || parent !== TABLES[2] ||
          !/^FOREIGN KEY \(manual_investment_line_id\) REFERENCES (public\.)?manual_investment_lines\(id\) ON DELETE CASCADE$/.test(dependency.definition)) {
          throw new ConflictException('Hay relaciones adicionales con estas tablas. Revisarlas antes de habilitar la limpieza.');
        }
      }
      const triggers = await client.query(`SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
        AND tgenabled <> 'D' AND tgrelid = ANY($1::regclass[]) AND (tgtype::int & 8) <> 0 LIMIT 1`, [TABLES.map(t => `public.${t}`)]);
      if (triggers.rowCount) throw new ConflictException('Hay triggers de DELETE que requieren revisión antes de limpiar.');
      const recentChildren = await client.query(`SELECT 1 FROM public.manual_investment_deviation_comments c
        JOIN public.manual_investment_lines l ON l.id = c.manual_investment_line_id
        WHERE l.created_at < $1::timestamptz AND (c.created_at >= $1::timestamptz OR c.created_at IS NULL) LIMIT 1`, [cutoff]);
      if (recentChildren.rowCount) throw new ConflictException('Una inversión antigua tiene comentarios vigentes. Se canceló todo para conservarlos.');

      const snapshots: Snapshot[] = [];
      for (const table of TABLES) {
        const count = await client.query(`SELECT count(*)::int AS count FROM public.${table}`);
        if (count.rows[0].count > 100000) throw new ConflictException('Más de 100.000 filas en una tabla: requiere exportación por streaming; no se eliminaron datos.');
        const columns = await client.query(`SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
        const result = await client.query(`SELECT row_to_json(t)::text AS raw,
          (SELECT json_object_agg(key, value) FROM jsonb_each_text(to_jsonb(t))) AS cells
          FROM public.${table} t ORDER BY id`);
        snapshots.push({ table, columns: columns.rows.map(c => c.column_name), rows: result.rows.map(r => r.cells), raw: result.rows.map(r => r.raw) });
      }
      const excel = await makeWorkbook(snapshots);
      const archive = JSON.stringify({ version: 1, cutoff, tables: snapshots.map(s => ({ table: s.table, rows: s.raw })) });
      await this.save(join(directory, 'backup.json'), archive);
      await this.save(join(directory, 'backup.xlsx'), excel);
      const metadata = { id, userId, cutoff, timezone: 'UTC', createdAt: new Date(clock[0].now).toISOString(),
        counts: Object.fromEntries(snapshots.map(s => [s.table, s.rows.length])),
        sha256: createHash('sha256').update(excel).digest('hex'),
        archiveSha256: createHash('sha256').update(archive).digest('hex') };
      await this.save(join(directory, 'prepared.json'), JSON.stringify(metadata));
      // Verify persisted bytes before the first DELETE.
      const saved = await readFile(join(directory, 'backup.xlsx'));
      const raw = await readFile(join(directory, 'backup.json'));
      if (createHash('sha256').update(saved).digest('hex') !== metadata.sha256 ||
          createHash('sha256').update(raw).digest('hex') !== metadata.archiveSha256) throw new Error('Falló la verificación del respaldo');
      const deleted: Record<string, number> = {};
      for (const table of DELETE_ORDER) {
        const result = await client.query(`DELETE FROM public.${table} WHERE created_at < $1::timestamptz`, [cutoff]);
        deleted[table] = result.rowCount || 0;
      }
      await client.query('COMMIT');
      committed = true;
      await this.save(join(directory, 'completed.json'), JSON.stringify({ ...metadata, status: 'completed', deleted }));
      return { excel, cutoff, createdAt: metadata.createdAt };
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
