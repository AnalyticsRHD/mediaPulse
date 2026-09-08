const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, project: require('node:path').join(__dirname, '../tsconfig.json') });
const { InvestmentsService } = require('../dist/modules/investments/investments.service');
const { BrandMappingService } = require('../dist/common/brand-mapping/brand-mapping.service');

test('Caleta consumption excludes the same ad set name from another brand', () => {
  const line = { anunciante: 'ZONA FRANCA', marca: 'As Automotores', plataforma: 'META',
    campana: 'AR_ADV+_GEO_EDAD_CALETA', objetivo: 'Leads-mensajes', mes: '2026-09' };
  const metrics = ['monthly', 'daily'].flatMap(granularity => [
    { marca: 'As Automotores', spend: granularity === 'monthly' ? 41934.27 : 1589.03 },
    { marca: 'Zona Franca', spend: granularity === 'monthly' ? 38562.56 : 1369.68 }
  ].map(metric => ({ ...metric, cliente: 'ZONA FRANCA', referencia: 'Zona Franca',
    plataforma: 'META', adSetName: line.campana, objetivo: line.objetivo, granularity,
    date: granularity === 'monthly' ? '2026-09-01' : '2026-09-08', coverageEndDate: '2026-09-08' })));
  const service = new InvestmentsService({ findAll: () => metrics }, Object.create(BrandMappingService.prototype), {});
  const snapshot = service.getConsumptionSnapshot(line, '2026-09-01', '2026-09-08', 'thisMonth');
  assert.equal(snapshot.consumo, 41934.27);
  assert.equal(snapshot.consumoDia, 1589.03);
  assert.equal(service.getConsumptionSnapshot(line, '2026-09-08', '2026-09-08', 'custom').consumo, 1589.03);
  const other = { ...line, marca: 'Zona Franca' };
  assert.equal(service.getConsumptionSnapshot(other, '2026-09-01', '2026-09-08', 'thisMonth').consumo, 38562.56);
});
