(() => {
  // Standalone rhythm planner for the 边想边打 (think-while-typing) mode. It is loaded
  // both in the page's isolated world (before typist.js) and in the side panel, so it
  // must stay context free: no DOM, no chrome.* API, no randomness outside the injected
  // generator. It only turns text plus parameters into a reproducible list of steps.
  //
  // typist.js keeps owning everything safety related (target validation, stop rules,
  // sanitizing, rich-text ranges). This file only decides *when* something is written.
  if (globalThis.__edgeHumanTyperThinking?.version === '1.1.0') return;
  const VERSION = '1.1.0';
  // 规划器对外接口版本。typist.js 只检查这个数字，因此以后调整节奏不必同步改执行器。
  const API = 1;
  // A single plan step writes one grapheme, so a very long text would build a huge
  // array. The side panel rejects longer texts with a clear message instead.
  const MAX_PLAN_CHARS = 20000;
  // 总时长预算：可接受的目标范围（秒），以及停顿缩放的上下限。
  // 上限避免把短文本拉成不自然的长时间呆滞，下限避免把长文本压成机械连打。
  const BUDGET_SECONDS_RANGE = [10, 7200];
  const MIN_PAUSE_SCALE = 0.15;
  const MAX_PAUSE_SCALE = 8;
  const defaults = Object.freeze({
    base: 70,        // ms, base interval between graphemes inside a burst (30..200)
    thinkScale: 1,   // multiplier for composing pauses (0.4..2)
    driftRate: 4,    // %, chance of a long "staring into space" pause (0..15)
    reviseRate: 10,  // %, chance to backspace and rewrite just-typed words (0..25)
    maxRevise: 5,    // graphemes, longest single rewrite (1..12)
    typoRate: 1,     // %, chance of a wrong character (0..10)
    lateTypoRate: 3  // %, chance the wrong character is noticed late (0..15)
  });
  const ranges = Object.freeze({
    base: [30, 200], thinkScale: [0.4, 2], driftRate: [0, 15], reviseRate: [0, 25],
    maxRevise: [1, 12], typoRate: [0, 10], lateTypoRate: [0, 15]
  });
  const sentenceEnders = /[。！？!?…]/u;
  const clauseEnders = /[，、；：,;:]/u;
  const trailingQuotes = /[”’"』」）)\]】》]/u;
  const asciiWords = /[A-Za-z0-9]/;
  const neighbors = {
    q: 'wa', w: 'qase', e: 'wsdr', r: 'edft', t: 'rfgy', y: 'tghu', u: 'yhji',
    i: 'ujko', o: 'iklp', p: 'ol', a: 'qwsz', s: 'awedxz', d: 'serfcx',
    f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
    z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk'
  };
  const chineseMistakes = { 的: '地', 地: '的', 在: '再', 再: '在', 是: '事', 事: '是',
    做: '作', 作: '做', 已: '以', 以: '已', 他: '她', 她: '他', 时: '是', 这: '着' };

  const number = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  function normalize(raw) {
    const params = {};
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = number(raw?.[key], defaults[key]);
      params[key] = Math.min(max, Math.max(min, value));
    }
    params.maxRevise = Math.round(params.maxRevise);
    return params;
  }
  // Seeded generator: the same text, parameters and seed must always produce the same
  // plan, which keeps the tests deterministic and lets the panel preview match reality.
  function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  function splitGraphemes(text) {
    const source = String(text ?? '').replace(/\r\n?/gu, '\n');
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source),
        (item) => item.segment);
    }
    return Array.from(source);
  }
  function wordFlags(chars) {
    const starts = new Array(chars.length).fill(false);
    const ends = new Array(chars.length).fill(false);
    const offsets = [];
    let offset = 0;
    for (const char of chars) { offsets.push(offset); offset += char.length; }
    const byOffset = new Map(offsets.map((value, index) => [value, index]));
    let segmenter = null;
    try {
      segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
    } catch { segmenter = null; }
    if (segmenter) {
      for (const item of segmenter.segment(chars.join(''))) {
        if (!item.isWordLike) continue;
        const start = byOffset.get(item.index);
        const end = byOffset.get(item.index + item.segment.length);
        if (start === undefined || end === undefined || end <= start) continue;
        starts[start] = true;
        ends[end - 1] = true;
      }
      return { starts, ends };
    }
    // Fallback when word segmentation is unavailable: each CJK character is its own
    // word and Latin/digit runs count as one word.
    let index = 0;
    while (index < chars.length) {
      if (asciiWords.test(chars[index])) {
        const start = index;
        while (index < chars.length && asciiWords.test(chars[index])) index += 1;
        starts[start] = true;
        ends[index - 1] = true;
        continue;
      }
      if (/\p{Letter}|\p{Number}/u.test(chars[index])) { starts[index] = true; ends[index] = true; }
      index += 1;
    }
    return { starts, ends };
  }
  // 与 typist.js 中的同名表刻意保持独立：常规模式不依赖本文件，本文件也不依赖注入顺序。
  function wrongCharacter(char, random = Math.random) {
    const choices = neighbors[char.toLowerCase()];
    if (choices) {
      const wrong = choices[Math.floor(random() * choices.length)];
      return char === char.toUpperCase() ? wrong.toUpperCase() : wrong;
    }
    return chineseMistakes[char] ?? null;
  }
  const sentenceEndsAt = (chars, index) => index >= 0 && index < chars.length &&
    (sentenceEnders.test(chars[index]) ||
      (trailingQuotes.test(chars[index]) && index > 0 && sentenceEnders.test(chars[index - 1])));
  const clauseEndsAt = (chars, index) => index >= 0 && index < chars.length && clauseEnders.test(chars[index]);
  // A late typo correction must not run across a sentence, clause or line boundary:
  // rewriting a 逗号 or a newline in the middle of the sentence reads as a glitch.
  const blocksLookahead = (chars, index) => chars[index] === '\n' ||
    sentenceEnders.test(chars[index]) || clauseEnders.test(chars[index]);

  // 把所有字符切成有序步骤。每个步骤只做一件事：写一个字素，或退掉一个字素。
  // wait 表示执行该步骤之前等待的毫秒数；pause 标注这段时间的语义，供状态文案与统计使用。
  function buildPlan(request = {}) {
    const L = globalThis.__typerI18n;
    const lang = L?.normalize(request.lang) || 'zh';
    const T = (key, params) => (L ? L.translate(lang, key, params) : key);
    const chars = splitGraphemes(request.text);
    const total = chars.length;
    if (!total || total > MAX_PLAN_CHARS) return null;
    const params = normalize(request.params);
    const seed = number(request.seed, Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const random = createRandom(seed);
    const { starts, ends } = wordFlags(chars);
    const between = (min, max) => min + random() * (max - min);
    const steps = [];
    const add = (step) => { steps.push(step); return step; };
    const write = (index, wait, pause, label, kind = 'type', char = chars[index]) =>
      add({ op: 'insert', wait, char, src: index, pause, label, kind });
    const erase = (index, wait, label, kind, char = chars[index]) =>
      add({ op: 'backspace', wait, char, src: index, pause: '', label, kind });

    let index = 0;
    let sentence = 1;
    let unitStart = 0;      // first grapheme of the clause being written
    let burstLeft = 0;
    let burstBase = params.base;
    let drift = 0;
    let fresh = true;
    const burstDelay = () => {
      if (burstLeft <= 0) {
        burstLeft = Math.round(between(3, 14));
        drift = Math.min(0.25, Math.max(-0.15, drift + (random() - 0.5) * 0.12));
        // Typing speed decays slightly from the start of the text to its end, which
        // reads as fatigue rather than as a fixed random interval.
        burstBase = params.base * (1 + 0.35 * (index / total)) * (1 + drift);
        fresh = true;
      } else fresh = false;
      burstLeft -= 1;
      let delay = burstBase * between(0.78, 1.25);
      if (fresh) delay *= between(1.1, 1.5);
      else if (random() < 0.04) delay *= between(1.6, 3.2);
      return delay;
    };

    while (index < total) {
      const boundary = index === 0 ? 'start'
        : chars[index - 1] === '\n' ? 'paragraph'
        : sentenceEndsAt(chars, index - 1) ? 'sentence'
        : clauseEndsAt(chars, index - 1) ? 'clause'
        : ends[index - 1] ? 'word' : 'none';
      let wait, pause = '', label = T('plan.typing');
      if (boundary === 'start' || boundary === 'paragraph' || boundary === 'sentence' || boundary === 'clause') {
        burstLeft = 0;
        if (boundary === 'start') {
          wait = between(600, 2500) * params.thinkScale;
          label = T('plan.start');
        } else if (boundary === 'paragraph') {
          wait = between(2500, 9000) * params.thinkScale;
          label = T('plan.paragraph', { n: sentence });
        } else if (boundary === 'sentence') {
          wait = between(1200, 4500) * params.thinkScale;
          label = T('plan.sentence', { n: sentence });
        } else {
          wait = between(250, 900) * params.thinkScale;
          label = T('plan.clause');
        }
        pause = 'think';
        if ((boundary === 'sentence' || boundary === 'paragraph') && random() * 100 < params.driftRate) {
          wait += between(6000, 15000);
          pause = 'drift';
          label = T('plan.drift');
        }
        unitStart = index;
      } else if (boundary === 'word') {
        // 词与词之间只是极短的换手；偶尔（约两成）会有一次换词犹豫。中文词很短，
        // 如果每个词都加上明显停顿，整体会变成"均匀地慢"，而不是成句输出。
        wait = burstDelay() + between(15, 80);
        if (random() < 0.22) wait += between(80, 240);
        pause = 'word';
      } else wait = burstDelay();
      if (boundary !== 'start' && (boundary === 'word' || boundary === 'clause') &&
          params.reviseRate > 0 && random() * 100 < params.reviseRate) {
        // 走到词或分句边界时，有机会像真人一样回删几个字重写。只删本分句内刚打出的字，
        // 绝不跨越会话起点，也不删掉标点本身。
        const span = index - unitStart;
        const bound = Math.min(params.maxRevise, span);
        if (bound >= 1) {
          const count = 1 + Math.floor(Math.pow(random(), 1.6) * bound);
          const from = index - count;
          for (let cursor = from; cursor < index; cursor += 1) {
            erase(cursor, cursor === from ? between(120, 420) : between(60, 160),
              T('plan.revising', { n: sentence, count }), 'revise');
          }
          write(from, between(300, 1800) * params.thinkScale, 'rethink', T('plan.rethinking', { n: sentence }), 'retype');
          for (let cursor = from + 1; cursor < index; cursor += 1) {
            write(cursor, burstDelay(), '', T('plan.retyping'), 'retype');
          }
        }
      }
      const char = chars[index];
      const wrong = params.typoRate > 0 && random() * 100 < params.typoRate
        ? wrongCharacter(char, random) : null;
      if (!wrong) {
        write(index, wait, pause, label);
        index += 1;
      } else {
        write(index, wait, pause, T('plan.typingTypo'), 'typo', wrong);
        // 有时人打完几个字才发现打错，然后一次退掉整段重打。
        let lookahead = 0;
        if (random() * 100 < params.lateTypoRate) {
          while (lookahead < 3 && index + lookahead + 1 < total &&
                 !blocksLookahead(chars, index + lookahead + 1)) lookahead += 1;
        }
        for (let cursor = index + 1; cursor <= index + lookahead; cursor += 1) {
          write(cursor, burstDelay(), '', T('plan.typing'), 'type');
        }
        for (let cursor = index + lookahead; cursor >= index; cursor -= 1) {
          erase(cursor, cursor === index + lookahead ? between(250, 650) : between(90, 200),
            lookahead ? T('plan.foundTypos', { n: lookahead + 1 }) : T('plan.foundTypo'), 'fix',
            cursor === index ? wrong : chars[cursor]);
        }
        for (let cursor = index; cursor <= index + lookahead; cursor += 1) {
          write(cursor, cursor === index ? between(100, 320) : burstDelay(), '',
            lookahead ? T('plan.retypeRun') : T('plan.correcting'), 'correct');
        }
        index += lookahead + 1;
      }
      if (sentenceEndsAt(chars, index - 1)) sentence += 1;
    }
    const budget = fitToBudget(steps, request.budgetMs);
    return { version: VERSION, api: API, chars, steps, params, seed, budget, stats: estimate(steps) };
  }
  // 统计既服务于"预计总时长"，也服务于侧边栏每个滑动条下方的"这个参数花了多少时间"。
  // 其中 reviseMs / typoMs 是整段流程（含重写与重想），因此与 thinkMs 有重叠；
  // typeMs 与 thinkMs 则互不重叠，可直接相加。
  function estimate(source) {
    const steps = Array.isArray(source) ? source : source?.steps ?? [];
    let totalMs = 0, thinkMs = 0, driftMs = 0, driftCount = 0, typeMs = 0;
    let reviseMs = 0, reviseRuns = 0, reviseChars = 0;
    let typoMs = 0, typoCount = 0, lateRuns = 0, lateMs = 0;
    let longestPause = 0, previous = null;
    let flow = null, flowFixes = 0, flowMs = 0;
    const closeFlow = () => {
      // 一次退掉两个字以上的纠错才算"延迟发现"，单字纠错不计入。
      if (flow === 'typo' && flowFixes > 1) { lateRuns += 1; lateMs += flowMs; }
      flow = null; flowFixes = 0; flowMs = 0;
    };
    for (const step of steps) {
      const wait = Math.max(0, number(step.wait, 0));
      const thinking = step.pause === 'think' || step.pause === 'drift' || step.pause === 'rethink';
      const next = step.kind === 'typo' || step.kind === 'fix' || step.kind === 'correct' ? 'typo'
        : step.kind === 'revise' || step.kind === 'retype' ? 'revise' : null;
      if (next !== flow) closeFlow();
      flow = next;
      totalMs += wait;
      if (thinking) thinkMs += wait;
      if (step.pause === 'drift') { driftMs += wait; driftCount += 1; }
      if (!thinking && step.op === 'insert' && step.kind === 'type') typeMs += wait;
      if (flow === 'revise') reviseMs += wait;
      if (flow === 'typo') typoMs += wait;
      if (flow) flowMs += wait;
      if (step.kind === 'fix') flowFixes += 1;
      if (step.kind === 'revise') {
        reviseChars += 1;
        if (previous !== 'revise') reviseRuns += 1;
      }
      if (step.kind === 'typo') typoCount += 1;
      if (wait > longestPause) longestPause = wait;
      previous = step.kind;
    }
    closeFlow();
    return { totalMs, thinkMs, driftMs, driftCount, typeMs, writeMs: totalMs - thinkMs,
      reviseMs, reviseRuns, reviseChars, typoMs, typoCount, lateRuns, lateMs,
      longestPause, steps: steps.length };
  }
  // 总时长预算：只缩放“构思类”停顿（起手、分句、句末、换段、走神、重想），
  // 书写速度与步骤结构完全不变，因此回改与错字序列同不设预算时逐字一致。
  const flexiblePause = (step) => step.pause === 'think' || step.pause === 'drift' || step.pause === 'rethink';
  function fitToBudget(steps, budgetMs) {
    const before = estimate(steps);
    const writingMs = before.totalMs - before.thinkMs;
    const budget = Number(budgetMs);
    const disabled = { enabled: false, budgetMs: 0, scale: 1, reached: true, limited: null,
      writingMs, totalMs: before.totalMs };
    if (!Number.isFinite(budget) || budget <= 0 || before.thinkMs <= 0) return disabled;
    const desired = (budget - writingMs) / before.thinkMs;
    const scale = Math.min(MAX_PAUSE_SCALE, Math.max(MIN_PAUSE_SCALE, desired));
    if (scale !== 1) for (const step of steps) if (flexiblePause(step)) step.wait *= scale;
    const after = estimate(steps);
    return { enabled: true, budgetMs: budget, scale, writingMs, totalMs: after.totalMs,
      // 5%（或不低于 400 毫秒）以内视为达成，否则说明缩放被上下限挡住。
      reached: Math.abs(after.totalMs - budget) <= Math.max(400, budget * 0.05),
      limited: desired > MAX_PAUSE_SCALE ? 'max' : desired < MIN_PAUSE_SCALE ? 'min' : null };
  }
  globalThis.__edgeHumanTyperThinking = {
    version: VERSION, api: API, defaults, ranges, maxPlanChars: MAX_PLAN_CHARS,
    budgetSecondsRange: BUDGET_SECONDS_RANGE, minPauseScale: MIN_PAUSE_SCALE, maxPauseScale: MAX_PAUSE_SCALE,
    normalize, splitGraphemes, wrongCharacter, buildPlan, estimate, fitToBudget
  };
})();
