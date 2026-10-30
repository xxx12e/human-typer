const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');

const source = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
const context = vm.createContext({ globalThis: {} });
vm.runInContext(source, context);
const i18n = context.globalThis.__typerI18n;
const { zh, en } = i18n.STRINGS;

const checks = [];
function test(name, body) { body(); checks.push(name); }
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const cjk = /[\u4e00-\u9fff]/;

test('中英文键完全一致', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(zhKeys.filter((key) => !(key in en)), [], '英文缺少这些键');
  assert.deepEqual(enKeys.filter((key) => !(key in zh)), [], '中文缺少这些键');
  assert.ok(zhKeys.length > 100, `键数量偏少：${zhKeys.length}`);
});

test('同一键的占位符一致', () => {
  for (const key of Object.keys(zh)) {
    assert.equal(placeholders(en[key]), placeholders(zh[key]), `占位符不一致：${key}`);
  }
});

test('英文文案不残留中文', () => {
  const allowed = new Set(['app.lang.switch']);
  for (const [key, value] of Object.entries(en)) {
    if (allowed.has(key)) continue;
    assert.ok(!cjk.test(value), `英文文案含中文：${key} → ${value}`);
  }
});

test('面板与代码里引用的键都存在', () => {
  const files = ['popup.html', 'popup.js', 'typist.js', 'thinking.js', 'docs-target.js', 'docs-runner.js'];
  const used = new Set();
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/data-i18n(?:-placeholder|-aria|-title)?="([\w.]+)"/g)) used.add(match[1]);
    for (const match of text.matchAll(/\b[tT]\('([\w.]+)'/g)) used.add(match[1]);
  }
  const missing = [...used].filter((key) => !(key in zh));
  assert.deepEqual(missing, [], `这些键没有定义：${missing.join(', ')}`);
  assert.ok(used.size > 90, `扫描到的键偏少：${used.size}`);
});

test('语言探测与回退', () => {
  assert.equal(i18n.detect('zh-CN'), 'zh');
  assert.equal(i18n.detect('en-US'), 'en');
  assert.equal(i18n.detect('fr'), 'zh');
  assert.equal(i18n.normalize('EN'), 'en');
  assert.equal(i18n.translate('en', 'progress.left', { percent: '12.34', time: '1.00s' }), '12.34% · 1.00s left');
  assert.equal(i18n.translate('zh', 'progress.left', { percent: '12.34', time: '1.00 秒' }), '12.34% · 剩余 1.00 秒');
  assert.equal(i18n.translate('en', 'missing.key'), 'missing.key', '缺少键时回退为键名');
});

console.log(`PASS ${checks.length} checks\n${checks.join('\n')}`);
