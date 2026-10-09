import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const catalogUrl = new URL('./catalog.json', import.meta.url);
const reportRoot = fileURLToPath(new URL('../../../public/model-reports/', import.meta.url));

function readCatalog() {
  assert.ok(existsSync(catalogUrl), '模型管理页应有随包版本与报告目录');
  return JSON.parse(readFileSync(catalogUrl, 'utf8'));
}

test('模型目录区分可调用运筹模型与已训练机器学习模型', () => {
  const catalog = readCatalog();

  assert.deepEqual(catalog.trainedModels, []);
  assert.equal(catalog.optimizationModel.version, 'SCHEC-MIP-V1.0');
  assert.equal(catalog.optimizationModel.fullCycle.variables, 168765);
  assert.equal(catalog.optimizationModel.fullCycle.constraints, 148325);
  assert.deepEqual(catalog.versionChain.map((item) => item.version), [
    'SCHEC-INPUT-V1.0', 'SCHEC-MIP-V1.0', 'SCHEC-SOLVE-V1.1',
    'SCHEC-RESCHED-V1.0', 'SCHEC-VALID-V3.0', 'SCHEC-KPI-V1.0.1', 'SCHEC-PKG-V1.0',
  ]);
});

test('阶段报告保留文件版本、正文版本和离线原件', () => {
  const catalog = readCatalog();
  const kpiReport = catalog.reports.find((item) => item.id === 'kpi-visualization');
  const deliveryReport = catalog.reports.find((item) => item.id === 'model-delivery');

  assert.equal(kpiReport.fileVersion, 'SCHEC-KPI-V1.0.1');
  assert.equal(kpiReport.documentVersion, 'SCHEC-KPI-V1.0');
  assert.equal(deliveryReport.fileVersion, 'SCHEC-DELIVERY-V1.0');
  for (const report of catalog.reports) {
    assert.ok(existsSync(`${reportRoot}/${report.assetFile}`), `${report.assetFile} 应随前端静态资源交付`);
    assert.match(report.evidenceScope, /仿真|模拟/);
  }
});

test('模型目录展示覆盖率双口径及完整来源限制', () => {
  const catalog = readCatalog();

  assert.equal(catalog.baseline.coverage.solver.ratePercent, 85.28);
  assert.equal(catalog.baseline.coverage.solver.demandPersonShifts, 11912);
  assert.equal(catalog.baseline.coverage.independent.ratePercent, 85.03);
  assert.equal(catalog.baseline.coverage.independent.demandPersonShifts, 11948);
  assert.equal(catalog.baseline.overtime.employeeMonthsOver36Hours, 0);
  assert.match(catalog.baseline.sourceNote, /不构成实际工厂绩效证据/);
});
