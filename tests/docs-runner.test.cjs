const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const load = (name) => fs.readFileSync(path.join(root, name), 'utf8');

// 模拟 Google 文档：段首已经是「1.」「a)」「-」「*」时再打空格，就会转成列表并吃掉编号（与实测一致，「2.」不会触发）。
class FakeDoc {
  constructor() { this.lines = [{ text: '', list: false }]; this.line = 0; this.col = 0; this.lists = 0; }
  insert(text) {
    const line = this.lines[this.line];
    if ((text === ' ' || text === '\t') && !line.list && /^(?:[1aAiI][.)]|[-*])$/.test(line.text.slice(0, this.col))) {
      line.text = line.text.slice(this.col); line.list = true; this.col = 0; this.lists += 1;
      return;
    }
    line.text = line.text.slice(0, this.col) + text + line.text.slice(this.col);
    this.col += text.length;
  }
  enter() {
    const line = this.lines[this.line];
    this.lines.splice(this.line + 1, 0, { text: line.text.slice(this.col), list: line.list });
    line.text = line.text.slice(0, this.col); this.line += 1; this.col = 0;
  }
  backspace() {
    const line = this.lines[this.line];
    if (this.col > 0) { line.text = line.text.slice(0, this.col - 1) + line.text.slice(this.col); this.col -= 1; return; }
    if (line.list) { line.list = false; return; }
    assert.ok(this.line > 0, '退格越过了文档开头');
    const previous = this.lines[this.line - 1];
    this.col = previous.text.length; previous.text += line.text; this.lines.splice(this.line, 1); this.line -= 1;
  }
  del() {
    const line = this.lines[this.line];
    assert.ok(this.col < line.text.length, 'Delete 后面没有字');
    line.text = line.text.slice(0, this.col) + line.text.slice(this.col + 1);
  }
  move(step) {
    this.col += step;
    assert.ok(this.col >= 0 && this.col <= this.lines[this.line].text.length, '方向键移出了当前段落');
  }
  render() {
    let n = 0;
    return this.lines.map(line => (line.list ? `${++n}. ` : (n = 0, '')) + line.text).join('\n');
  }
}

function setup(random = Math.random) {
  const doc = new FakeDoc();
  const store = {};
  let listener = null;
  let finished = null;
  const target = {
    check: () => true, prepare: () => ({}), expectKeys: () => {}, progress: () => ({}),
    finish: (phase, message, completed, total) => { finished = { phase, message, completed, total }; }
  };
  const math = Object.create(Math); math.random = random;
  const chrome = {
    runtime: { id: 'ext', getURL: (p) => `chrome-extension://ext/${p}`, onMessage: { addListener: (fn) => { listener = fn; } } },
    scripting: { executeScript: async ({ args: [method, params] }) => [{ result: target[method](...params) }] },
    debugger: {
      attach: async () => {}, detach: async () => {},
      onDetach: { addListener: () => {}, removeListener: () => {} },
      sendCommand: async (_, method, params) => {
        if (method === 'Input.insertText') return doc.insert(params.text);
        if (params.type !== 'keyDown') return;
        if (params.key === 'Enter') doc.enter();
        else if (params.key === 'Backspace') doc.backspace();
        else if (params.key === 'Delete') doc.del();
        else if (params.key === 'ArrowLeft') doc.move(-1);
        else if (params.key === 'ArrowRight') doc.move(1);
        else if (params.text) doc.insert(params.text);
      }
    },
    tabs: {
      get: async (id) => ({ id, windowId: 1, active: true, url: 'https://docs.google.com/document/d/DOC123/edit?tab=t.0' }),
      onActivated: { addListener: () => {} }, onUpdated: { addListener: () => {} }, onRemoved: { addListener: () => {} }
    },
    storage: { local: { set: async (value) => Object.assign(store, value) } }
  };
  const context = vm.createContext({ chrome, Intl, Math: math, console, setTimeout: (fn) => setImmediate(fn), clearTimeout: () => {} });
  for (const file of ['i18n.js', 'sanitize.js', 'thinking.js', 'docs-runner.js']) vm.runInContext(load(file), context);
  const run = async (options) => {
    const response = await new Promise(resolve => listener({ type: 'docsStart', tabId: 7, options },
      { id: 'ext', url: 'chrome-extension://ext/popup.html' }, resolve));
    assert.ok(response.ok, response.error);
    while (!finished) await new Promise(resolve => setImmediate(resolve));
    return finished;
  };
  return { doc, store, run };
}
const classic = (text, extra = {}) => ({ text, min: 20, max: 20, typoRate: 0, pauseRate: 0, punctuation: false, rhythm: false, lang: 'zh', ...extra });
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const LIST_TEXT = '1. alpha\n2. beta\n- gamma\n* delta\na) eps\nI. roman\n普通 1. 句中\n\n1) 括号\n1. 中文';

(async () => {
  {
    const { doc, store, run } = setup();
    const result = await run(classic(LIST_TEXT));
    assert.equal(result.phase, 'done', result.message);
    assert.equal(doc.lists, 0, '不应触发自动列表');
    assert.equal(doc.render(), LIST_TEXT);
    assert.equal(store.docsResume.doc, 'DOC123');
    assert.equal(store.docsResume.sent, Array.from(LIST_TEXT).length);
    console.log('PASS docs classic mode keeps list markers as plain text and records resume by doc id');
  }
  for (let seed = 1; seed <= 25; seed += 1) {
    const { doc, run } = setup(seeded(seed));
    const result = await run(classic(LIST_TEXT, { typoRate: 15, pauseRate: 5 }));
    assert.equal(result.phase, 'done', result.message);
    assert.equal(doc.lists, 0, `seed ${seed} 触发了自动列表`);
    assert.equal(doc.render(), LIST_TEXT, `seed ${seed}`);
  }
  console.log('PASS docs classic mode with typos never triggers auto lists');
  for (let seed = 1; seed <= 40; seed += 1) {
    const { doc, run } = setup(seeded(seed));
    const result = await run({ text: LIST_TEXT, mode: 'thinking', lang: 'zh',
      params: { typoRate: 10, lateTypoRate: 15, reviseRate: 25, maxRevise: 6, thinkScale: 0.4, base: 30 } });
    assert.equal(result.phase, 'done', result.message);
    assert.equal(doc.lists, 0, `seed ${seed} 触发了自动列表`);
    assert.equal(doc.render(), LIST_TEXT, `seed ${seed}`);
  }
  console.log('PASS docs thinking mode with typos and revisions never triggers auto lists');
  {
    // 续打：上次正好停在「1.」之后、空格之前，文档里已经有这两个字，从第 3 个字接着打。
    const { doc, store, run } = setup();
    doc.insert('1'); doc.insert('.');
    const result = await run(classic(LIST_TEXT, { skipChars: 2 }));
    assert.equal(result.phase, 'done', result.message);
    assert.equal(doc.lists, 0, '续打时不应触发自动列表');
    assert.equal(doc.render(), LIST_TEXT);
    assert.equal(store.docsResume.sent, Array.from(LIST_TEXT).length);
    console.log('PASS docs resume continues from a stored offset');
  }
})().catch(error => { console.error(error); process.exit(1); });
