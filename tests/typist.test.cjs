const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(root, 'typist.js'), 'utf8');
const plannerSource = fs.readFileSync(path.join(root, 'thinking.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
function setup(value = '', selection = [value.length, value.length], random = () => 0, planner = false) {
  class TextControl extends EventTarget {
    constructor() {
      super(); this._value = value; this.selectionStart = selection[0]; this.selectionEnd = selection[1];
      this.isConnected = true; this.disabled = false; this.readOnly = false; this.maxLength = -1;
    }
    get value() { return this._value; }
    set value(v) { this._value = v; }
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  }
  class Input extends TextControl {}
  class Textarea extends TextControl {}
  for (const type of [Input, Textarea]) {
    Object.defineProperty(type.prototype, 'value', Object.getOwnPropertyDescriptor(TextControl.prototype, 'value'));
  }
  class FakeInputEvent extends Event {
    constructor(type, options) { super(type, options); this.inputType = options.inputType; this.data = options.data; }
  }
  const target = new Textarea();
  const document = new EventTarget(); document.activeElement = target;
  const queue = new Map(), delays = [], events = [];
  let id = 0;
  target.addEventListener('input', (event) => events.push([event.inputType, event.data, target.value]));
  const math = Object.create(Math); math.random = random;
  const context = vm.createContext({ document, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    InputEvent: FakeInputEvent, AbortController, Intl, Math: math,
    setTimeout: (fn, delay) => { delays.push(delay); queue.set(++id, fn); return id; },
    clearTimeout: (timer) => queue.delete(timer)
  });
  vm.runInContext(i18nSource, context);
  vm.runInContext(source, context);
  if (planner) vm.runInContext(plannerSource, context);
  const tick = () => { const next = queue.entries().next().value; if (next) { queue.delete(next[0]); next[1](); } };
  const flush = () => { let count = 0; while (queue.size) { assert.ok(count++ < 1000); tick(); } };
  const start = (text, options = {}) => context.__edgeHumanTyper.start({
    text, min: 80, max: 220, typoRate: 15, pauseRate: 3, punctuation: true, rhythm: true, ...options
  });
  return { target, document, context, queue, delays, events, start, tick, flush };
}
const checks = [];
function test(name, body) { body(); checks.push(name); }
test('错字经退格纠正；清洗并保留原文本和选区外内容', () => {
  const s = setup('前旧后', [1, 2]); s.start('a在👨‍👩‍👧‍👦e\u0301\nB'); s.flush();
  assert.equal(s.target.value, '前a在é\nB后');
  assert.equal(s.events.filter(([type]) => type === 'deleteContentBackward').length, 3);
  assert.equal(s.events.find(([type]) => type === 'deleteContentBackward')[1], null);
});
test('关闭错字和思考停顿；基础间隔落在设置范围', () => {
  const s = setup(); s.start('abcdef', { typoRate: 0, pauseRate: 0, punctuation: false }); s.flush();
  assert.equal(s.target.value, 'abcdef');
  assert.ok(s.events.every(([type]) => type === 'insertText'));
  assert.ok(s.delays.slice(1).every((delay) => delay >= 80 && delay <= 220));
});
test('思考、换行产生额外停顿', () => {
  const s = setup(); s.start('\na', { typoRate: 0 }); s.flush();
  assert.ok(s.delays[1] >= 1580);
});
test('错字出现后停止，不再退格或继续输入', () => {
  const s = setup('前后', [1, 1]); s.start('abc'); s.tick();
  const stoppedValue = s.target.value; s.context.__edgeHumanTyper.stop(); s.flush();
  assert.equal(s.target.value, stoppedValue); assert.equal(s.events.length, 1);
});
test('网页改变光标时停止，避免删除其他文字', () => {
  const s = setup('前后', [1, 1]); s.start('abc'); s.tick();
  const previous = s.target.value; s.target.setSelectionRange(0, 0); s.flush();
  assert.equal(s.target.value, previous);
});
test('网页改变值时停止', () => {
  const s = setup(); s.start('abc'); s.tick(); s.target.value = '网页更新'; s.flush();
  assert.equal(s.target.value, '网页更新');
});
test('beforeinput 取消时不写入', () => {
  const s = setup(); s.target.addEventListener('beforeinput', (event) => event.preventDefault());
  s.start('abc'); s.flush(); assert.equal(s.target.value, '');
});
test('beforeinput 改变光标时停止', () => {
  const s = setup('前后', [1, 1]);
  s.target.addEventListener('beforeinput', () => s.target.setSelectionRange(0, 0));
  s.start('abc'); s.flush(); assert.equal(s.target.value, '前后');
});
test('maxlength 限制下完成可容纳字符的纠正', () => {
  const s = setup(); s.target.maxLength = 1; s.start('ab'); s.flush();
  assert.equal(s.target.value, 'a');
});
test('再次开始取消旧任务', () => {
  const s = setup(); s.start('abc'); s.start('xyz', { typoRate: 0 }); s.flush();
  assert.equal(s.target.value, 'xyz');
});
test('切换目标后停止', () => {
  const s = setup(); s.start('abc'); s.document.activeElement = null; s.flush();
  assert.equal(s.target.value, '');
});
// 边想边打：完整走一遍规划器给出的计划。
function planOptions(params = {}, extra = {}) {
  return { mode: 'thinking', params: { reviseRate: 0, typoRate: 0, ...params }, ...extra };
}
test('边想边打：按计划完成输入，回改与错字后文字仍与原文一致', () => {
  const s = setup('', [0, 0], () => 0, true);
  const text = 'abc，de。fg';
  s.start(text, planOptions({ reviseRate: 100, maxRevise: 3, typoRate: 100, lateTypoRate: 50 }));
  s.flush();
  assert.equal(s.target.value, text);
  const erases = s.events.filter(([type]) => type === 'deleteContentBackward').length;
  const inserts = s.events.filter(([type]) => type === 'insertText').length;
  assert.ok(erases > 0, '应出现回改或纠错退格');
  assert.ok(inserts >= Array.from(text).length + erases, '回改与纠错后必须把删掉的字符重新打回来');
});
test('边想边打：回改不会删除会话起点之前的已有文字', () => {
  const s = setup('前后', [1, 1], () => 0, true);
  s.start('这是一段会反复回改的文字。', planOptions({ reviseRate: 100, maxRevise: 12, typoRate: 100, lateTypoRate: 100 }));
  s.flush();
  assert.equal(s.target.value, '前这是一段会反复回改的文字。后');
  assert.ok(s.events.every(([, , value]) => value.startsWith('前') && value.endsWith('后')), '任何中间状态都不得碰到选区外的文字');
});
test('边想边打：网页改值或取消输入时仍然立即停止', () => {
  const first = setup('', [0, 0], () => 0, true);
  first.start('abcdef', planOptions());
  first.tick();
  const stopped = first.target.value;
  first.target.value = '网页更新';
  first.flush();
  assert.equal(first.target.value, '网页更新');
  assert.ok(stopped.length > 0);
  const second = setup('', [0, 0], () => 0, true);
  second.target.addEventListener('beforeinput', (event) => event.preventDefault());
  second.start('abcdef', planOptions());
  second.flush();
  assert.equal(second.target.value, '');
});
test('边想边打：规划器缺失或文字过长时给出明确错误，不开始输入', () => {
  const missing = setup(); missing.start('abc', { mode: 'thinking' });
  assert.equal(missing.context.__edgeHumanTyper.getState().phase, 'error');
  assert.equal(missing.target.value, '');
  const long = setup('', [0, 0], () => 0, true);
  long.start('a'.repeat(long.context.__edgeHumanTyperThinking.maxPlanChars + 1), { mode: 'thinking' });
  assert.equal(long.context.__edgeHumanTyper.getState().phase, 'error');
  assert.equal(long.target.value, '');
});
test('边想边打：总时长预算下仍然保真完成，且完成信息说明缩放倍率', () => {
  const s = setup('', [0, 0], () => 0, true);
  const text = '预算测试，包含分句。还有第二句。';
  s.start(text, planOptions({ reviseRate: 100, maxRevise: 4, typoRate: 50, lateTypoRate: 50 }, { budgetMs: 20000 }));
  s.flush();
  assert.equal(s.target.value, text);
  const state = s.context.__edgeHumanTyper.getState();
  assert.equal(state.phase, 'done');
  assert.match(state.message, /已按总时长预算缩放停顿 ×\d+\.\d{2}/);
});
test('边想边打：停止后不再继续写入', () => {
  const s = setup('', [0, 0], () => 0, true);
  s.start('这是一段文字。', planOptions({ reviseRate: 100, maxRevise: 4 }));
  for (let index = 0; index < 6; index += 1) s.tick();
  const snapshot = s.target.value;
  s.context.__edgeHumanTyper.stop();
  s.flush();
  assert.equal(s.target.value, snapshot);
});
// 续打检测：开始时判断目标里是否已经写好了要输入文字的开头。
const inspectOf = (s, text) => s.context.__edgeHumanTyper.inspect({ text });
test('续打检测：光标前的内容与待输入文字开头一致时给出跳过长度', () => {
  const text = '第一段已经打好了。第二段需要继续输入。';
  const typed = '第一段已经打好了。';
  const s = setup(typed, [typed.length, typed.length]);
  const report = inspectOf(s, text);
  assert.equal(report.ok, true);
  assert.equal(report.total, Array.from(text).length);
  assert.equal(report.skip, Array.from(typed).length);
  assert.equal(report.remaining, Array.from(text).length - Array.from(typed).length);
  assert.equal(report.matched, true);
  assert.equal(report.already, false);
  assert.equal(report.next.startsWith('第二段'), true);
  assert.equal(report.preview.endsWith(typed), true);
});
test('续打检测：尾随换行、过短重合与光标后的重复内容', () => {
  const text = '第一段。\n第二段继续。';
  const typed = '第一段。\n';
  const s = setup(typed, [typed.length, typed.length]);
  assert.equal(inspectOf(s, text).skip, Array.from(typed).length, '段末换行也应算作已输入');
  const short = setup('你好', [2, 2]);
  assert.equal(inspectOf(short, '你好，世界，这是一段更长的文字。').matched, false, '少于 5 个字不打扰用户');
  const whole = '整段文字都已经在框里了，不必重复。';
  const duplicated = setup(whole + '\n' + whole, [Array.from(whole).length, Array.from(whole).length]);
  const report = inspectOf(duplicated, whole);
  assert.equal(report.already, true, '光标后已有整段文字时应提示重复');
  assert.equal(report.skip, report.total);
});
test('续打检测：无关内容不触发；跳过后只输入剩下的部分且不动开头', () => {
  const text = '第一段已经打好了。第二段需要继续输入。';
  const typed = '第一段已经打好了。';
  const skip = Array.from(typed).length;
  assert.equal(inspectOf(setup('完全无关的旧内容', [7, 7]), text).matched, false);
  const s = setup(typed, [skip, skip], () => 0, true);
  s.start(text, planOptions({ reviseRate: 0, typoRate: 0 }, { skipChars: skip }));
  s.flush();
  assert.equal(s.target.value, text, '续打后整体文字应与目标一致');
  const state = s.context.__edgeHumanTyper.getState();
  assert.equal(state.phase, 'done');
  assert.match(state.message, /已跳过开头 9 个字符/);
  assert.ok(s.events.length >= Array.from(text).length - skip);
  assert.ok(s.events.every(([, , value]) => value.startsWith(typed)), '不得删除已经写好的开头');
});
test('续打检测：跳过全部内容时拒绝开始，避免重复输入', () => {
  const text = '已经全部输入过的文字。';
  const s = setup(text, [text.length, text.length]);
  const report = inspectOf(s, text);
  assert.equal(report.already, true);
  assert.equal(report.remaining, 0);
  s.start(text, { ...planOptions(), skipChars: Array.from(text).length });
  assert.equal(s.context.__edgeHumanTyper.getState().phase, 'error');
  assert.equal(s.target.value, text);
});
test('进度按时间计算：计划模式给出计划总时长，常规模式给出估算剩余时间', () => {
  const planned = setup('', [0, 0], () => 0, true);
  const text = '第一句，包含分句。第二句结束。';
  planned.start(text, planOptions({ reviseRate: 0, typoRate: 0 }));
  const early = planned.context.__edgeHumanTyper.getState();
  assert.equal(early.exact, true, '计划模式的时间进度应当是精确的');
  assert.ok(early.totalMs > 0 && early.remainingMs > 0);
  assert.ok(early.remainingMs <= early.totalMs);
  for (let index = 0; index < 12; index += 1) planned.tick();
  const later = planned.context.__edgeHumanTyper.getState();
  assert.ok(later.remainingMs < early.remainingMs, '剩余时间应随步骤推进而减少');
  planned.flush();
  const done = planned.context.__edgeHumanTyper.getState();
  assert.equal(done.remainingMs, 0, '完成后剩余时间归零');
  assert.equal(done.phase, 'done');
  const classic = setup();
  classic.start('abcdef', { typoRate: 0, pauseRate: 0, punctuation: false });
  const guess = classic.context.__edgeHumanTyper.getState();
  assert.equal(guess.exact, false, '常规模式的时间进度只能是估算');
  assert.ok(guess.totalMs > 0 && guess.remainingMs > 0);
  for (let index = 0; index < 3; index += 1) classic.tick();
  assert.ok(classic.context.__edgeHumanTyper.getState().remainingMs < guess.remainingMs);
});
console.log(`PASS ${checks.length} checks\n${checks.join('\n')}`);
