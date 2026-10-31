const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({});
const source = fs.readFileSync(path.join(root, 'sanitize.js'), 'utf8');
vm.runInContext(source, context);
const sanitize = context.HumanTextSanitizer.sanitize;
const hidden = [
  '\u0000', '\u0008', '\u001b', '\u007f', // controls
  '­', '؜', '​', '‌', '‍', '‎', '‏',
  '‪', '‫', '‬', '‭', '‮', '⁠', '⁦', '⁧', '⁨', '⁩',
  '﻿', '️', '', '\ud800'
].join('');
const result = sanitize(`Hello${hidden},\t世界! café 🙂 © $ + = ™\r\n“Visible”—123…`);
assert.equal(result.text, 'Hello, 世界! café   $ + = \n“Visible”—123…');
assert.equal(result.replacedSpaces, 2);
assert.ok(result.removed >= 28);
assert.doesNotMatch(result.text.replace(/\n/gu, ''), /[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Surrogate}\p{Private_Use}]/u);
assert.equal(sanitize('\t​🙂').text, ' ');
assert.equal(sanitize('é').text, 'é');

// 字符级水印：看到什么就输入什么。
const tags = [...'WATERMARK'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
const selectors = '︀︁\u{e0100}\u{e0101}';
const marked = `Th​e re‌port${tags} is f⁠inal${selectors}. Done　now`;
assert.equal(sanitize(marked).text, 'The report is final. Done now');
assert.equal(sanitize('Тhе bаnk sеnt рауmеnt').text, 'The bank sent payment', '拉丁单词里的西里尔同形字母还原');
assert.equal(sanitize('Привет мир').text, 'Привет мир', '真正的俄文不改');
assert.equal(sanitize('Αθήνα').text, 'Αθήνα', '真正的希腊文不改');
assert.equal(sanitize('第１章 ＡＢＣ，你好。').text, '第1章 ABC，你好。', '全角字母数字还原，中文全角标点保留');
assert.equal(sanitize('price $5 + 3 = 8 <tag> a|b ~x ^y `z` ¥100 €2').text, 'price $5 + 3 = 8 <tag> a|b ~x ^y `z` ¥100 €2', '键盘符号与货币符号保留');
const counts = sanitize('bаd​');
assert.equal(counts.normalized, 1);
assert.equal(counts.removed, 1);

// 输入引擎里复制的那份清洗逻辑必须与 sanitize.js 完全一致。
const typist = fs.readFileSync(path.join(root, 'typist.js'), 'utf8');
const block = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
const core = (text) => block(text, 'const allowed', 'return { text, removed, replacedSpaces, normalized };')
  .replace('function sanitize(value)', 'SANITIZE').replace('const sanitize = (value) =>', 'SANITIZE');
assert.equal(core(typist), core(source), 'typist.js 的清洗逻辑与 sanitize.js 不一致');

console.log('PASS sanitizer: hidden-character watermarks removed, homoglyphs restored, visible text kept');
