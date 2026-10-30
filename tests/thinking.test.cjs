const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(root, 'thinking.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
function setup(random = () => 0.5) {
  const math = Object.create(Math);
  math.random = random;
  const context = vm.createContext({ Math: math, Intl, console });
  vm.runInContext(i18nSource, context);
  vm.runInContext(source, context);
  return context.__edgeHumanTyperThinking;
}
// 按计划逐步执行，返回最终写入的文字。任何一次越界退格都会立刻断言失败。
function execute(plan) {
  const written = [];
  const erases = [];
  for (const step of plan.steps) {
    if (step.op === 'insert') written.push(step.char);
    else {
      assert.ok(written.length > 0, '退格越过了本次输入的起点');
      erases.push(written.length);
      written.pop();
    }
  }
  return { text: written.join(''), erases, plan };
}
const checks = [];
function test(name, body) { body(); checks.push(name); }

test('计划可复现：同一文本、参数与种子产生完全相同的计划', () => {
  const planner = setup();
  const request = { text: '我们在做一个人打字模拟器，想法会边走边变。\n所以要允许回改。', seed: 20260911,
    params: { reviseRate: 20, typoRate: 5, lateTypoRate: 20 } };
  const first = planner.buildPlan(request);
  const second = planner.buildPlan(request);
  assert.equal(JSON.stringify(first.steps), JSON.stringify(second.steps));
  assert.equal(first.seed, 20260911);
});

test('保真：任意参数与种子下，执行完整计划得到的文字与原文一致', () => {
  const planner = setup();
  const samples = [
    '简单一句话。',
    '第一段文字，包含，多个分句；还有一个换行。\n第二段继续写下去！',
    'English words mixed with 中文和数字 2026, plus punctuation... and more text to type.',
    '带引号的句子：“这样做对吗？”然后再接一句。',
    'a',
    '换\n行\n很\n多\n的\n文\n本'
  ];
  let count = 0;
  for (const text of samples) {
    for (const seed of [1, 7, 99, 20260911, 424242]) {
      for (const params of [
        { reviseRate: 0, typoRate: 0 },
        { reviseRate: 100, maxRevise: 12, typoRate: 0 },
        { reviseRate: 100, maxRevise: 12, typoRate: 100, lateTypoRate: 0 },
        { reviseRate: 60, maxRevise: 3, typoRate: 100, lateTypoRate: 100 },
        { reviseRate: 25, maxRevise: 6, typoRate: 8, lateTypoRate: 30, driftRate: 15 }
      ]) {
        for (const budgetMs of [0, 20000, 180000]) {
          const plan = planner.buildPlan({ text, params, seed, budgetMs });
          assert.ok(plan, '计划应生成');
          assert.equal(execute(plan).text, plan.chars.join(''), `保真失败：${text}／预算 ${budgetMs}`);
          count += 1;
        }
      }
    }
  }
  assert.ok(count >= 100, `样本量不足：${count}`);
});

test('停顿长在结构边界上：句末 > 分句 > 词间', () => {
  const planner = setup();
  const text = '我们在写一段话，然后再写下去。第二句话开始，继续往下写。';
  const plan = planner.buildPlan({ text, seed: 5, params: { reviseRate: 0, typoRate: 0, driftRate: 0, thinkScale: 1 } });
  const chars = plan.chars;
  const waits = new Map();
  plan.steps.forEach((step) => {
    if (step.op === 'insert' && !waits.has(step.src)) waits.set(step.src, step.wait);
  });
  const boundaryOf = (index) => {
    if (index === 0) return 'start';
    const previous = chars[index - 1];
    if (previous === '\n') return 'paragraph';
    if ('。！？!?…'.includes(previous)) return 'sentence';
    if ('，、；：,;:'.includes(previous)) return 'clause';
    return 'none';
  };
  const sentence = [], clause = [];
  for (const [index, wait] of waits) {
    if (boundaryOf(index) === 'sentence') sentence.push(wait);
    if (boundaryOf(index) === 'clause') clause.push(wait);
  }
  const inside = plan.steps.filter((step) => step.op === 'insert' && step.kind === 'type' && boundaryOf(step.src) === 'none');
  const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
  assert.ok(sentence.length >= 1 && clause.length >= 1 && inside.length >= 10);
  assert.ok(Math.min(...sentence) >= 1200, `句末停顿过短：${Math.min(...sentence)}`);
  assert.ok(Math.max(...clause) < Math.min(...sentence), '分句停顿应短于句末停顿');
  assert.ok(median(inside.map((step) => step.wait)) < Math.min(...clause), '词内间隔应明显短于分句停顿');
  assert.ok(inside.every((step) => step.wait >= 30 && step.wait <= 600), '词内间隔应落在书写速度范围内');
});

test('成句输出：字间间隔以小段（burst）聚集，思考时间集中在边界停顿', () => {
  const planner = setup();
  const plan = planner.buildPlan({ text: '这是一段用来观察节奏的中文文本，它应该有快有慢地被打出来。',
    seed: 17, params: { reviseRate: 0, typoRate: 0, driftRate: 0 } });
  const writes = plan.steps.filter((step) => step.op === 'insert');
  const median = writes.slice().sort((a, b) => a.wait - b.wait)[Math.floor(writes.length / 2)].wait;
  assert.ok(median < 150, `书写段中位间隔应偏快：${Math.round(median)}`);
  assert.ok(writes.filter((step) => step.wait < 150).length / writes.length > 0.6, '多数字符应处于快速书写段');
  assert.ok(writes.some((step) => step.wait > 250), '应存在分句或句末的较长停顿');
  assert.ok(plan.stats.thinkMs / plan.stats.totalMs > 0.2, '思考停顿应占据可观比例');
  const runs = plan.steps.filter((step) => step.kind === 'type');
  assert.ok(runs.length === plan.chars.length, '无回改无错字时应逐字写一遍');
});

test('回改：成组退格后原样重打，且不跨越本分句起点', () => {
  const planner = setup();
  const text = '前面一句话已经写完了。回改只会发生在刚打出来的这部分文字里。';
  const plan = planner.buildPlan({ text, seed: 3, params: { reviseRate: 100, maxRevise: 4, typoRate: 0, driftRate: 0 } });
  const erases = plan.steps.filter((step) => step.op === 'backspace');
  assert.ok(erases.length > 0, '应产生回改');
  assert.ok(erases.every((step) => step.kind === 'revise'));
  assert.ok(plan.stats.reviseRuns >= 1, 'estimate 应统计到回改次数');
  assert.equal(plan.stats.reviseChars, erases.length);
  // 每一段连续退格之后，必须紧跟同样数量的重写，保证文字最终完整。
  const steps = plan.steps;
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index].kind !== 'revise') continue;
    const erased = [];
    let cursor = index;
    while (cursor < steps.length && steps[cursor].kind === 'revise') { erased.push(steps[cursor]); cursor += 1; }
    assert.ok(erased.length <= 4, `单次回改不应超过设定字数：${erased.length}`);
    assert.equal(JSON.stringify(erased.map((step) => step.src)),
      JSON.stringify(erased.map((step, offset) => erased[0].src + offset)), '连续退格应作用在相邻字符上');
    const retyped = steps.slice(cursor).filter((step) => step.kind === 'retype');
    assert.equal(JSON.stringify(retyped.slice(0, erased.length).map((step) => step.src)),
      JSON.stringify(erased.map((step) => step.src)));
    assert.ok(retyped.slice(0, erased.length).every((step) => step.char === plan.chars[step.src]),
      '补回的文字应与原文一致');
    index = cursor - 1;
  }
});

test('延迟发现错字：一次退掉多个字再重打，最终文字仍然保真', () => {
  const planner = setup();
  const text = 'abcdefghijklmnopqrstuvwxyz，后面还有中文字符需要继续输入。';
  const plan = planner.buildPlan({ text, seed: 11,
    params: { typoRate: 100, lateTypoRate: 100, reviseRate: 0, driftRate: 0 } });
  const fixes = plan.steps.filter((step) => step.kind === 'fix');
  assert.ok(fixes.length >= 2, '应出现多字退格纠正');
  let run = 0, longest = 0;
  for (const step of plan.steps) {
    run = step.kind === 'fix' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  assert.ok(longest >= 2, `应有一次退掉多个字：${longest}`);
  assert.ok(plan.stats.typoCount > 0);
  assert.equal(execute(plan).text, Array.from(text).join(''));
});

test('参数被夹紧到安全范围，非法或超长输入不生成计划', () => {
  const planner = setup();
  const plan = planner.buildPlan({ text: '测试', seed: 1,
    params: { base: 5000, thinkScale: -3, driftRate: 99, reviseRate: 99, maxRevise: 99, typoRate: 99, lateTypoRate: 99 } });
  assert.equal(plan.params.base, 200);
  assert.equal(plan.params.thinkScale, 0.4);
  assert.equal(plan.params.driftRate, 15);
  assert.equal(plan.params.reviseRate, 25);
  assert.equal(plan.params.maxRevise, 12);
  assert.equal(plan.params.typoRate, 10);
  assert.equal(plan.params.lateTypoRate, 15);
  assert.equal(planner.buildPlan({ text: '', seed: 1 }), null);
  assert.equal(planner.buildPlan({ text: 'a'.repeat(planner.maxPlanChars + 1), seed: 1 }), null);
  const fallback = planner.buildPlan({ text: '测试', seed: 2, params: { base: null, typoRate: 'x' } });
  assert.equal(fallback.params.base, planner.defaults.base);
  assert.equal(fallback.params.typoRate, planner.defaults.typoRate);
});

test('估算与计划自洽：停顿统计不超过总时长', () => {
  const planner = setup();
  const plan = planner.buildPlan({ text: '第一句。第二句，包含分句。\n第三段。', seed: 8,
    params: { reviseRate: 30, typoRate: 10, lateTypoRate: 50, driftRate: 20 } });
  const sum = plan.steps.reduce((total, step) => total + step.wait, 0);
  assert.ok(Math.abs(plan.stats.totalMs - sum) < 1e-6);
  assert.ok(plan.stats.thinkMs <= plan.stats.totalMs);
  assert.ok(plan.stats.longestPause >= plan.stats.totalMs / plan.steps.length);
  assert.equal(plan.stats.steps, plan.steps.length);
  assert.equal(planner.estimate(plan.steps).totalMs, plan.stats.totalMs);
});

test('换行、引号与混合文本的结构判定正确', () => {
  const planner = setup();
  const plan = planner.buildPlan({ text: '第一段结束。\n第二段开始，“引用一句话。”然后继续。', seed: 4,
    params: { reviseRate: 100, maxRevise: 12, typoRate: 0, driftRate: 0 } });
  const paragraphs = plan.steps.filter((step) => step.label.startsWith('换段构思'));
  const sentences = plan.steps.filter((step) => step.label.startsWith('构思下一句'));
  assert.ok(paragraphs.length >= 1, '换行后应有换段构思');
  assert.ok(sentences.length >= 1, '句末后应有句间构思');
  assert.ok(paragraphs.every((step) => step.wait >= 2500), '换段停顿应长于句间停顿');
  assert.equal(execute(plan).text, plan.chars.join(''));
});

test('总时长预算：贴近目标，且不改变步骤结构与书写时间', () => {
  const planner = setup();
  const text = '这是一段用来测试总时长预算的中文文本，它包含若干分句，也包含一个换行。\n第二段继续写下去，看看停顿缩放是否真的能贴近目标。';
  const request = { text, seed: 21, params: { reviseRate: 20, typoRate: 5, lateTypoRate: 20, driftRate: 0 } };
  const plain = planner.buildPlan(request);
  // 目标必须落在可达范围内：书写时间无法压缩，停顿最多放大 maxPauseScale 倍。
  const reachable = plain.budget.writingMs + plain.stats.thinkMs * planner.maxPauseScale;
  const targets = [plain.stats.totalMs, plain.stats.totalMs * 1.5, Math.min(reachable * 0.85, plain.stats.totalMs * 3)];
  for (const target of targets) {
    const budgetMs = Math.round(target);
    const plan = planner.buildPlan({ ...request, budgetMs });
    assert.ok(plan.budget.enabled);
    assert.ok(plan.budget.reached, `应达成预算 ${Math.round(budgetMs / 1000)} 秒：${Math.round(plan.budget.totalMs / 1000)} 秒`);
    assert.ok(Math.abs(plan.budget.totalMs - budgetMs) <= Math.max(400, budgetMs * 0.05));
    // 结构（每一步的操作、来源与类别）必须与无预算时完全一致，预算只改等待时间。
    const shape = (steps) => JSON.stringify(steps.map((step) => [step.op, step.src, step.kind, step.label]));
    assert.equal(shape(plan.steps), shape(plain.steps));
    // 书写时间（字间与词间）不应被预算改变。
    assert.ok(Math.abs(plan.budget.writingMs - plain.budget.writingMs) < 1e-6);
    assert.equal(execute(plan).text, plan.chars.join(''));
  }
  assert.equal(plain.budget.enabled, false);
  assert.equal(plain.budget.scale, 1);
});

test('总时长预算：被上下限挡住时给出明确原因，且停顿仍在安全范围', () => {
  const planner = setup();
  const short = planner.buildPlan({ text: '很短。', seed: 4, params: { reviseRate: 0, typoRate: 0 }, budgetMs: 600000 });
  assert.equal(short.budget.enabled, true);
  assert.equal(short.budget.limited, 'max');
  assert.equal(short.budget.reached, false);
  assert.equal(short.budget.scale, planner.maxPauseScale);
  assert.ok(short.budget.totalMs < 600000, '短文本无法被拉长到十分钟');
  const longText = '这是一段足够长的文字，用来让书写时间本身超过一个很短的预算目标。';
  const longParams = { reviseRate: 25, maxRevise: 6, typoRate: 0 };
  const withoutBudget = planner.buildPlan({ text: longText, seed: 5, params: longParams });
  // 目标只有书写时间的一半：无论怎么压缩停顿都不可能达到。
  const long = planner.buildPlan({ text: longText, seed: 5, params: longParams,
    budgetMs: Math.round(withoutBudget.budget.writingMs * 0.5) });
  assert.equal(long.budget.limited, 'min');
  assert.equal(long.budget.reached, false);
  assert.equal(long.budget.scale, planner.minPauseScale);
  assert.ok(long.budget.totalMs > long.budget.budgetMs, '停顿压到最小后仍然超过预算');
  const pauses = long.steps.filter((step) => ['think', 'drift', 'rethink'].includes(step.pause));
  assert.ok(pauses.every((step) => step.wait > 0), '缩放不得产生零或负的停顿');
  assert.equal(execute(long).text, long.chars.join(''));
});

test('总时长预算：关闭或非法值时不生效', () => {
  const planner = setup();
  const request = { text: '测试预算开关。', seed: 6, params: { reviseRate: 0, typoRate: 0 } };
  const plain = planner.buildPlan(request);
  for (const budgetMs of [0, -5, null, undefined, NaN, 'x']) {
    const plan = planner.buildPlan({ ...request, budgetMs });
    assert.equal(plan.budget.enabled, false);
    assert.equal(JSON.stringify(plan.steps.map((step) => step.wait)), JSON.stringify(plain.steps.map((step) => step.wait)));
  }
  // 合法预算必须真的改变等待时间，否则说明预算没有生效。
  const fitted = planner.buildPlan({ ...request, budgetMs: 90000 });
  assert.equal(fitted.budget.enabled, true);
  assert.notEqual(JSON.stringify(fitted.steps.map((step) => step.wait)),
    JSON.stringify(plain.steps.map((step) => step.wait)));
});

test('总时长预算：开启后计划依旧可复现且保真', () => {
  const planner = setup();
  const samples = ['第一段，包含分句。\n第二段结束！', 'Mixed English and 中文 with punctuation, plus numbers 2026.'];
  for (const text of samples) {
    for (const seed of [3, 88]) {
      const request = { text, seed, budgetMs: 45000 };
      const first = planner.buildPlan(request);
      const second = planner.buildPlan(request);
      assert.equal(JSON.stringify(first.steps), JSON.stringify(second.steps));
      assert.equal(execute(first).text, first.chars.join(''));
    }
  }
  assert.equal(planner.budgetSecondsRange[0], 10);
  assert.equal(planner.budgetSecondsRange[1], 7200);
  assert.equal(planner.api, 1);
});

test('统计口径：滑动条读到的时间账与实际步骤一致', () => {
  const planner = setup();
  const plan = planner.buildPlan({ text: '第一句，包含回改与错字。\n第二句结束。', seed: 12,
    params: { reviseRate: 40, maxRevise: 4, typoRate: 20, lateTypoRate: 40, driftRate: 20 } });
  const stats = plan.stats;
  const sum = (steps) => steps.reduce((total, step) => total + step.wait, 0);
  const isThinking = (step) => ['think', 'drift', 'rethink'].includes(step.pause);
  assert.equal(stats.totalMs, sum(plan.steps));
  assert.ok(Math.abs(stats.typeMs - sum(plan.steps.filter((step) =>
    step.op === 'insert' && step.kind === 'type' && !isThinking(step)))) < 1e-6);
  assert.ok(Math.abs(stats.thinkMs - sum(plan.steps.filter(isThinking))) < 1e-6);
  assert.ok(stats.typeMs + stats.thinkMs <= stats.totalMs + 1e-6, '书写与停顿不应重叠统计');
  assert.equal(stats.driftCount, plan.steps.filter((step) => step.pause === 'drift').length);
  assert.ok(stats.driftMs >= stats.driftCount * 6000, '每次走神至少 6 秒');
  if (stats.reviseRuns > 0) {
    assert.ok(stats.reviseChars >= stats.reviseRuns, '回改次数不应多于退格字数');
    assert.ok(stats.reviseMs > 0);
  }
  assert.ok(stats.lateRuns <= stats.typoCount, '延迟发现次数不应多于错字次数');
  if (stats.lateRuns > 0) assert.ok(stats.lateMs > 0);
  // 用构造的步骤直接验证"延迟发现"的判定：一次退掉两个字以上才算。
  const step = (op, kind, wait) => ({ op, kind, wait, pause: '', char: 'x', src: 0 });
  const late = planner.estimate([
    step('insert', 'typo', 100), step('insert', 'type', 50), step('backspace', 'fix', 80),
    step('backspace', 'fix', 80), step('insert', 'correct', 60), step('insert', 'correct', 60)
  ]);
  assert.equal(late.typoCount, 1);
  assert.equal(late.lateRuns, 1, '一次退两字以上才算延迟发现');
  assert.equal(late.lateMs, 280);
  assert.equal(late.typoMs, 380);
  const immediate = planner.estimate([
    step('insert', 'typo', 100), step('backspace', 'fix', 80), step('insert', 'correct', 60)
  ]);
  assert.equal(immediate.lateRuns, 0, '单字纠正不算延迟发现');
  assert.equal(immediate.typoMs, 240);
});

console.log(`PASS ${checks.length} checks\n${checks.join('\n')}`);
