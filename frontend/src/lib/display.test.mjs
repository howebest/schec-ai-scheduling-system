import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMetric, sourceLabel, statusLabel } from './display.js';

test('将已知任务状态显示为简体中文，未知值保留原值', () => {
  assert.equal(statusLabel('succeeded'), '已完成');
  assert.equal(statusLabel('running'), '运行中');
  assert.equal(statusLabel('custom'), 'custom');
});

test('明确区分合成演示数据与已验收基准', () => {
  assert.equal(sourceLabel('synthetic_demo'), '合成演示');
  assert.equal(sourceLabel('accepted_baseline'), '已验收基准');
});

test('空值显示为无可计算值，百分比和小时保留单位', () => {
  assert.equal(formatMetric(null, '%'), '无可计算值');
  assert.equal(formatMetric(85.28, '%'), '85.28%');
  assert.equal(formatMetric(8, 'h'), '8 h');
});
