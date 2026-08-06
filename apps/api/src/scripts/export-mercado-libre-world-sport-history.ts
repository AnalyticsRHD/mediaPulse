import 'reflect-metadata';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ExternalApisService } from '../common/external-apis/external-apis.service';

type ExportRow = {
  mes: string;
  consumo: number;
  moneda: 'ARS';
  cuentas: Array<{
    accountId: string | null;
    accountName: string;
    marca: string;
    consumo: number;
  }>;
};

const CLIENT = 'WORLD SPORT';
const START_MONTH = '2024-01';

function lastDayOfMonth(month: string, today: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return lastDay > today ? today : lastDay;
}

function monthsBetween(startMonth: string, endDate: string): string[] {
  const months: string[] = [];
  const [startYear, startMonthNumber] = startMonth.split('-').map(Number);
  const endMonth = endDate.slice(0, 7);
  const cursor = new Date(Date.UTC(startYear, startMonthNumber - 1, 1));

  while (cursor.toISOString().slice(0, 7) <= endMonth) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const externalApis = app.get(ExternalApisService);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const outputPath = resolve(process.argv[2] || 'exports/world-sport-mercado-libre-consumos-2024-hoy.json');
  const history: ExportRow[] = [];

  try {
    for (const month of monthsBetween(START_MONTH, today)) {
      const startDate = `${month}-01`;
      const endDate = lastDayOfMonth(month, today);
      process.stdout.write(`Consultando ${month}... `);

      const metrics = await externalApis.fetchAdsMetricsRange('mercadolibre', startDate, endDate);
      const matching = metrics.filter((metric) => metric.cliente.trim().toUpperCase() === CLIENT);
      const accounts = new Map<string, ExportRow['cuentas'][number]>();

      for (const metric of matching) {
        const accountId = metric.accountId || null;
        const accountName = metric.accountName || metric.referencia || metric.campaignName;
        const key = `${accountId || ''}||${accountName}||${metric.marca}`;
        const current = accounts.get(key) || {
          accountId,
          accountName,
          marca: metric.marca,
          consumo: 0
        };
        current.consumo += Number(metric.spend || 0);
        accounts.set(key, current);
      }

      const accountRows = [...accounts.values()]
        .map((row) => ({ ...row, consumo: Number(row.consumo.toFixed(2)) }))
        .sort((a, b) => a.accountName.localeCompare(b.accountName) || a.marca.localeCompare(b.marca));
      const consumo = Number(accountRows.reduce((sum, row) => sum + row.consumo, 0).toFixed(2));

      history.push({ mes: month, consumo, moneda: 'ARS', cuentas: accountRows });
      process.stdout.write(`${consumo}\n`);
    }

    const payload = {
      cliente: CLIENT,
      plataforma: 'MERCADO_LIBRE',
      desde: `${START_MONTH}-01`,
      hasta: today,
      moneda: 'ARS',
      generadoEn: new Date().toISOString(),
      meses: history
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    process.stdout.write(`Exportado: ${outputPath}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
