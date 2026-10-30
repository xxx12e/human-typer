const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'sanitize.js'), 'utf8'), context);
const sanitize = context.HumanTextSanitizer.sanitize;
const hidden = [
  '\u0000', '\u0008', '\u001b', '\u007f', // controls
  '\u00ad', '\u061c', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f',
  '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2060', '\u2066', '\u2067', '\u2068', '\u2069',
  '\ufeff', '\ufe0f', '\ue000', '\ud800'
].join('');
const result = sanitize(`Hello${hidden},\t世界!\u00a0cafe\u0301 🙂 © $ + = ™\r\n“Visible”—123…`);
assert.equal(result.text, 'Hello, 世界! café      \n“Visible”—123…');
assert.equal(result.replacedSpaces, 2);
assert.ok(result.removed >= 30);
assert.doesNotMatch(result.text.replace(/\n/gu, ''), /[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Surrogate}\p{Private_Use}\p{Symbol}]/u);
assert.match(result.text, /^[\p{Letter}\p{Number}\p{Punctuation} \n]+$/u);
assert.equal(sanitize('\t\u200b🙂').text, ' ');
assert.equal(sanitize('e\u0301').text, 'é');
console.log('PASS strict sanitizer: letters, numbers, punctuation, ASCII spaces and line feeds only');
