(() => {
  // This singleton lives in the extension's isolated world for the current page.
  if (globalThis.__edgeHumanTyper?.version === '1.2.0') return;
  globalThis.__edgeHumanTyper?.stop();
  let active = null;
  let pending = null;
  let selected = null;
  let engineLang = 'zh';
  const T = (key, params) => globalThis.__typerI18n?.translate(engineLang, key, params) ?? key;
  let state = { phase: 'idle', message: T('engine.idleSelect'), completed: 0, total: 0 };
  const report = (phase, message, progress = {}) => {
    state = { ...state, phase, message, ...progress };
    return message;
  };
  const random = (min, max) => min + Math.random() * (max - min);
  // Kept inside this file so an extension reload cannot leave the input engine
  // dependent on a global created by an older, separately injected script.
  // 与 sanitize.js 保持一致（单独复制一份，避免依赖旧版本注入的全局对象）。
  const allowed = /[\p{Letter}\p{Number}\p{Punctuation}\p{Currency_Symbol}!-~]/u;
  const invisible = /[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Surrogate}\p{Private_Use}]/u;
  const latin = /\p{Script=Latin}/u;
  const homoglyphs = new Map(Object.entries({
    'а': 'a', 'е': 'e', 'к': 'k', 'о': 'o', 'р': 'p', 'с': 'c',
    'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'һ': 'h', 'ӏ': 'l',
    'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
    'У': 'Y', 'Х': 'X', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S', 'Ԁ': 'D', 'Ԛ': 'Q', 'Ԝ': 'W', 'Һ': 'H', 'Ӏ': 'I',
    'ο': 'o', 'α': 'a', 'ν': 'v', 'ι': 'i', 'κ': 'k', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
    'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N',
    'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X'
  }));
  // 只在「拉丁字母为主、夹着同形字母」的单词里替换，真正的俄文、希腊文单词保持不变。
  function fixWord(word) {
    if (!latin.test(word)) return { word, count: 0 };
    let count = 0;
    const fixed = [...word].map((char) => {
      if (!homoglyphs.has(char)) return char;
      count += 1;
      return homoglyphs.get(char);
    }).join('');
    return { word: fixed, count };
  }
  const sanitize = (value) => {
    const source = String(value).replace(/\r\n?/gu, '\n').normalize('NFC');
    let text = '';
    let removed = 0;
    let replacedSpaces = 0;
    let normalized = 0;
    for (let char of source) {
      if (char === '\n') { text += char; continue; }
      if (char === '\t') {
        text += ' ';
        replacedSpaces += 1;
        continue;
      }
      if (invisible.test(char)) { removed += 1; continue; }
      if (/\p{Separator}/u.test(char)) {
        text += ' ';
        if (char !== ' ') replacedSpaces += 1;
        continue;
      }
      if (/[０-９Ａ-Ｚａ-ｚ]/u.test(char)) {
        char = String.fromCharCode(char.charCodeAt(0) - 0xfee0);
        normalized += 1;
      }
      if (allowed.test(char)) text += char;
      else removed += 1;
    }
    text = text.replace(/[\p{Letter}\p{Mark}]+/gu, (word) => {
      const result = fixWord(word);
      normalized += result.count;
      return result.word;
    });
    return { text, removed, replacedSpaces, normalized };
  };
  const neighbors = {
    q: 'wa', w: 'qase', e: 'wsdr', r: 'edft', t: 'rfgy', y: 'tghu', u: 'yhji',
    i: 'ujko', o: 'iklp', p: 'ol', a: 'qwsz', s: 'awedxz', d: 'serfcx',
    f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
    z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk'
  };
  const chineseMistakes = { 的: '地', 地: '的', 在: '再', 再: '在', 是: '事', 事: '是',
    做: '作', 作: '做', 已: '以', 以: '已', 他: '她', 她: '他', 时: '是', 这: '着' };
  function wrongCharacter(char) {
    const choices = neighbors[char.toLowerCase()];
    if (choices) {
      const wrong = choices[Math.floor(Math.random() * choices.length)];
      return char === char.toUpperCase() ? wrong.toUpperCase() : wrong;
    }
    return chineseMistakes[char] ?? null;
  }
  const focusedElement = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  };
  const clearPending = () => {
    if (!pending) return;
    clearTimeout(pending.timeout);
    clearTimeout(pending.launch);
    pending.controller.abort();
    pending.notice.remove();
    pending = null;
  };
  const stop = (reason = T('engine.stoppedDefault')) => {
    clearPending();
    selected = null;
    report('stopped', reason);
    if (!active) return;
    clearTimeout(active.timer);
    active.controller.abort();
    active = null;
  };

  const richText = (target) => typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement && target.isContentEditable;  const editable = (target) => ((target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(target.type))) &&
    !target.disabled && !target.readOnly) || richText(target);
  const targetValue = (target) => richText(target) ? target.innerHTML : target.value;
  const selectedRange = (target) => {
    if (!richText(target)) return null;
    const selection = target.ownerDocument.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return target.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
  };
  const restoreRange = (target, range) => {
    if (!range) return false;
    const selection = target.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  // ---------- 时间进度：常规模式没有预先算好的计划，按字估算剩余时间 ----------
  const PUNCTUATION_RE = /[，。！？；：、,.!?;:]/u;
  const classicPerCharMs = (options) => (options.min + options.max) / 2 + (options.pauseRate / 100) * 1600;
  // 一次常规输入的大致总时长：字数 × 平均间隔 + 标点/换行停顿 + 错字纠正 + 起手等待。
  function classicTotalMs(chars, options) {
    let ms = chars.length * classicPerCharMs(options) + 700;
    if (options.punctuation) {
      for (const char of chars) {
        if (char === '\n') ms += 1100;
        else if (PUNCTUATION_RE.test(char)) ms += 475;
      }
    }
    const typoable = chars.filter((char) => /[a-zA-Z]/u.test(char) ||
      '的地在再是事做作已以他她时这'.includes(char)).length;
    return ms + typoable * (options.typoRate / 100) * 900;
  }
  // 剩余时间只统计还没写完的字，正在退格纠错时再加一次纠正的停顿。
  function classicRemainingMs(chars, session, options) {
    let ms = (chars.length - session.index) * classicPerCharMs(options);
    if (options.punctuation) {
      for (let index = session.index; index < chars.length; index += 1) {
        const char = chars[index];
        if (char === '\n') ms += 1100;
        else if (PUNCTUATION_RE.test(char)) ms += 475;
      }
    }
    if (session.phase === 'delete' || session.phase === 'correct') ms += 350;
    return Math.max(0, ms);
  }

  // ---------- 续打检测：目标里已经写好的开头就不必再打一遍 ----------
  // 低于这个长度的重合不值得打断用户；超过这个长度只回看最近的部分，避免长文比较过慢。
  const RESUME_MIN = 5;
  const RESUME_CONTEXT = 4000;
  const graphemes = (value) => typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(value)), (item) => item.segment)
    : Array.from(String(value));
  // 富文本按 Range 取光标前后的纯文本，普通输入框直接切字符串。
  function caretText(target, isRich, side) {
    if (!isRich) {
      const at = side === 'before' ? target.selectionStart : target.selectionEnd;
      if (at === null || at === undefined) return null;
      return side === 'before' ? target.value.slice(0, at) : target.value.slice(at);
    }
    const selection = target.ownerDocument.getSelection();
    if (!selection?.rangeCount) return null;
    const caret = selection.getRangeAt(0);
    if (!target.contains(caret.startContainer)) return null;
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target);
    if (side === 'before') range.setEnd(caret.startContainer, caret.startOffset);
    else range.setStart(caret.endContainer, caret.endOffset);
    return range.toString();
  }
  // 光标前文本的最长后缀如果正好是要输入文字的前缀，那部分就是"已经打好的开头"。
  function resumeMatch(before, chars) {
    const tail = graphemes(String(before).slice(-RESUME_CONTEXT));
    const trimmed = tail.slice();
    while (trimmed.length && /\s/u.test(trimmed[trimmed.length - 1])) trimmed.pop();
    const trailing = tail.slice(trimmed.length);
    const max = Math.min(trimmed.length, chars.length);
    let budget = 400000;
    let matched = 0;
    for (let size = max; size > 0 && budget > 0; size -= 1) {
      if (trimmed[trimmed.length - size] !== chars[0]) continue;
      let same = true;
      for (let index = 0; index < size; index += 1) {
        budget -= 1;
        if (trimmed[trimmed.length - size + index] !== chars[index]) { same = false; break; }
      }
      if (same) { matched = size; break; }
    }
    // 末尾被跳过的空白（例如段落后换行）如果正是要输入文字接下来的内容，也算已经写好。
    let skip = matched;
    if (skip && trailing.length && chars.slice(skip, skip + trailing.length).join('') === trailing.join('')) {
      skip += trailing.length;
    }
    return { skip: Math.min(skip, chars.length), matched };
  }
  function inspect(options = {}) {
    const target = focusedElement();
    if (!editable(target)) return { ok: false, reason: T('engine.inspect.noTarget') };
    const chars = graphemes(sanitize(options.text || '').text);
    if (!chars.length) return { ok: false, reason: T('engine.inspect.noText') };
    const isRich = richText(target);
    const before = caretText(target, isRich, 'before');
    if (before === null) return { ok: false, reason: T('engine.inspect.noCaret') };
    const { skip } = resumeMatch(before, chars);
    const total = chars.length;
    const remaining = total - skip;
    const result = { ok: true, total, skip, remaining, matched: skip >= RESUME_MIN && remaining > 0,
      already: remaining <= 0, preview: chars.slice(Math.max(0, skip - 14), skip).join(''),
      next: chars.slice(skip, skip + 14).join(''), source: 'field' };
    if (skip) return result;
    // 光标后面已经是要输入的整段文字时，提示用户不要重复输入。
    const after = caretText(target, isRich, 'after');
    if (after && after.length >= total && graphemes(after).slice(0, total).join('') === chars.join('')) {
      return { ...result, skip: total, remaining: 0, matched: false, already: true,
        preview: chars.slice(-14).join(''), next: '' };
    }
    return result;
  }

  function arm(options = null, language = null) {
    if (language) engineLang = globalThis.__typerI18n?.normalize(language) || engineLang;
    stop();
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'all:initial;position:fixed;right:20px;top:20px;z-index:2147483647;max-width:320px;padding:14px 18px;border-radius:12px;background:#19243b;color:white;font:14px/1.6 system-ui,sans-serif;box-shadow:0 8px 32px #0004;pointer-events:none;';
    notice.textContent = T('engine.arm.notice');
    document.documentElement.appendChild(notice);
    const selection = { controller: new AbortController(), notice, timeout: null, launch: null };
    pending = selection;
    report('selecting', T('engine.arm.selecting'), { completed: 0, total: 0 });
    const listenerOptions = { capture: true, signal: selection.controller.signal };
    document.addEventListener('keydown', (event) => {
      if (event.isTrusted && event.key === 'Escape') stop();
    }, listenerOptions);
    document.addEventListener('click', (event) => {
      if (!event.isTrusted || pending !== selection) return;
      clearTimeout(selection.launch);
      const target = event.composedPath().find(editable);
      if (!target) {
        notice.textContent = T('engine.arm.notEditable');
        report('selecting', notice.textContent);
        return;
      }
      // Wait until click handlers and the browser have settled focus and selection.
      selection.launch = setTimeout(() => {
        if (pending !== selection) return;
        if (!target.isConnected || !editable(target) || focusedElement() !== target) {
          notice.textContent = T('engine.arm.notReady');
          report('selecting', notice.textContent);
          return;
        }
        if (options && target instanceof HTMLInputElement && /[\r\n]/u.test(options.text)) {
          notice.textContent = T('engine.arm.multiline');
          report('selecting', notice.textContent);
          return;
        }
        if (options) start(options);
        else {
          const rich = richText(target);
          selected = { target, rich, from: rich ? null : target.selectionStart,
            to: rich ? null : target.selectionEnd, value: targetValue(target), range: selectedRange(target) };
          clearPending();
          const label = rich ? T('engine.target.rich') : target instanceof HTMLTextAreaElement
        ? T('engine.target.textarea') : T('engine.target.input');
          report('ready', T('engine.arm.ready', { label }));
        }
      }, 0);
    }, listenerOptions);
    selection.timeout = setTimeout(() => {
      if (pending === selection) stop(T('engine.arm.timeout'));
    }, 30000);
    return T('engine.arm.return');
  }

  // 语言切换后重新渲染当前状态文案，运行中的下一条状态也会用新语言。
  function setLang(value) {
    const next = globalThis.__typerI18n?.normalize(value);
    if (!next || next === engineLang) return;
    engineLang = next;
    if (state.phase === 'idle') state = { ...state, message: T('engine.idleSelect') };
    else if (state.phase === 'running') state = { ...state, message: active?.plan ? state.message : T('engine.running') };
    else if (state.phase === 'ready') state = { ...state, message: T('engine.arm.return') };
  }

  function startSelected(options) {
    const choice = selected;
    if (!choice?.target.isConnected || !editable(choice.target)) {
      return report('error', T('engine.error.targetUnavailable'));
    }
    if (targetValue(choice.target) !== choice.value) {
      return report('error', T('engine.error.textChanged'));
    }
    choice.target.focus({ preventScroll: true });
    if (choice.rich) {
      if (!restoreRange(choice.target, choice.range)) return report('error', T('engine.error.rangeLost'));
    } else choice.target.setSelectionRange(choice.from, choice.to);
    return start(options);
  }

  function start(options) {
    if (options?.lang) engineLang = globalThis.__typerI18n?.normalize(options.lang) || engineLang;
    stop();
    const cleaned = sanitize(options.text);
    options = { ...options, text: cleaned.text,
      sanitizedCount: (options.sanitizedCount || 0) + cleaned.removed + cleaned.replacedSpaces + (cleaned.normalized || 0) };
    if (!options.text) return report('error', T('engine.error.noCleanText'));
    const target = focusedElement();
    if (!editable(target)) {
      return report('error', T('engine.error.notEditable'));
    }
    if (target instanceof HTMLInputElement && /[\r\n]/u.test(options.text)) {
      return report('error', T('engine.error.needsMultiline'));
    }
    const text = options.text.replace(/\r\n?/gu, '\n');
    // 续打：跳过目标里已经写好、且与待输入文字开头一致的部分，只输入剩下的。
    const fullChars = graphemes(text);
    const skip = Math.max(0, Math.min(Math.floor(Number(options.skipChars)) || 0, fullChars.length));
    const remainingText = fullChars.slice(skip).join('');
    if (!remainingText) return report('error', T('engine.error.alreadyThere'));
    // 边想边打模式：节奏完全由独立的 thinking.js 规划器决定，本文件只负责安全地执行计划。
    const planner = options.mode === 'thinking' ? globalThis.__edgeHumanTyperThinking : null;
    if (options.mode === 'thinking' && planner?.api !== 1) {
      return report('error', T('engine.error.plannerMissing'));
    }
    const plan = planner ? planner.buildPlan({ text: remainingText, params: options.params,
      seed: options.seed, budgetMs: options.budgetMs }) : null;
    if (planner && !plan) {
      return report('error', T('engine.error.tooLong', { max: planner.maxPlanChars }));
    }
    const chars = plan ? plan.chars : graphemes(remainingText);
    // 进度按整段文字计算，因此跳过的开头也要计入。
    const total = fullChars.length;
    const isRich = richText(target);
    const prototype = isRich ? null : target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setValue = isRich ? null : Object.getOwnPropertyDescriptor(prototype, 'value').set;
    const session = {
      timer: null, controller: new AbortController(), index: 0, expected: targetValue(target),
      from: isRich ? null : target.selectionStart, to: isRich ? null : target.selectionEnd,
      range: isRich ? selectedRange(target) : null, writing: false,
      phase: 'normal', eraseStart: null, deleteLength: 0, rhythm: 0.5, burstLeft: 0,
      // 本次会话的写入起点与已写入字数：任何退格都不得越过它，否则会删掉用户原有文字。
      anchor: isRich ? null : target.selectionStart, written: 0,
      plan: plan ? plan.steps : null, step: 0, done: 0,
      // 进度按"距离结尾还有多少时间"计算：计划模式用计划里的等待时间，常规模式按字估算。
      planRemaining: plan ? plan.stats.totalMs : 0,
      planTotal: plan ? plan.stats.totalMs : classicTotalMs(chars, options),
      stepStartedAt: Date.now()
    };
    // 进度以时间而非字数衡量：计划模式用计划里剩余的等待时间，常规模式按字估算。
    const timing = () => session.plan
      ? { remainingMs: Math.max(0, session.planRemaining - (Date.now() - session.stepStartedAt)),
          totalMs: session.planTotal, exact: true }
      : { remainingMs: classicRemainingMs(chars, session, options),
          totalMs: session.planTotal, exact: false };
    active = session;
    report('running', skip ? T('engine.runningSkip', { n: skip }) : T('engine.running'),
      { completed: skip, total, ...timing() });
    const listenerOptions = { capture: true, signal: session.controller.signal };
    document.addEventListener('keydown', (event) => {
      if (event.isTrusted && !session.writing) stop();
    }, listenerOptions);
    document.addEventListener('pointerdown', (event) => {
      if (event.isTrusted) stop();
    }, listenerOptions);
    document.addEventListener('focusin', () => {
      if (focusedElement() !== target) stop();
    }, listenerOptions);
    target.addEventListener('input', (event) => {
      // execCommand emits a trusted input event synchronously in rich editors.
      // Only treat it as a manual edit when this engine is not doing the write.
      if (event.isTrusted && !session.writing) stop();
    }, listenerOptions);

    const valid = () => {
      if (active !== session || !target.isConnected || focusedElement() !== target ||
          targetValue(target) !== session.expected) return false;
      if (isRich) {
        const current = selectedRange(target);
        return !!current && !!session.range && current.startContainer === session.range.startContainer &&
          current.startOffset === session.range.startOffset && current.endContainer === session.range.endContainer &&
          current.endOffset === session.range.endOffset;
      }
      return !target.disabled && !target.readOnly && target.selectionStart === session.from &&
        target.selectionEnd === session.to;
    };
    function writeRich(char, inputType, allowUndo) {
      if (!valid() || !restoreRange(target, session.range)) { stop(); return false; }
      const doc = target.ownerDocument;
      session.writing = true;
      let changed = false;
      try {
        if (inputType === 'deleteContentBackward') {
          const selection = doc.getSelection();
          const range = selection.getRangeAt(0);
          if (range.collapsed && range.startContainer.nodeType === 3 &&
              range.startOffset >= session.deleteLength) {
            range.setStart(range.startContainer, range.startOffset - session.deleteLength);
            selection.removeAllRanges(); selection.addRange(range);
            changed = doc.execCommand('delete', false);
          } else if (allowUndo) changed = doc.execCommand('undo', false);
        } else if (char === '\n') changed = doc.execCommand('insertParagraph', false);
        else changed = doc.execCommand('insertText', false, char);
      } finally { session.writing = false; }
      if (!changed) {
        stop(allowUndo ? T('engine.stop.richRefused')
          : T('engine.stop.richCannotDelete'));
        return false;
      }
      session.expected = target.innerHTML;
      session.range = selectedRange(target);
      if (!session.range) { stop(T('engine.stop.rangeLost')); return false; }
      return true;
    }
    // allowUndo 只保留给常规模式的单字错字纠正。计划模式的多字回改绝不能回退到
    // execCommand('undo')：那会撤销整段会话，而不是删掉计划里的那几个字。
    function write(char, inputType = 'insertText', allowUndo = true) {
      if (isRich) return writeRich(char, inputType, allowUndo);
      const from = inputType === 'deleteContentBackward' ? session.eraseStart : session.from;
      const to = session.to;
      if (from === null || to === null || from > to || !valid()) { stop(); return false; }
      if (session.anchor !== null && from < session.anchor) {
        stop(T('engine.stop.eraseOutOfRange'));
        return false;
      }
      const value = target.value.slice(0, from) + char + target.value.slice(to);
      if (target.maxLength >= 0 && value.length > target.maxLength) { stop(T('engine.stop.maxLength')); return false; }
      const data = inputType === 'deleteContentBackward' ? null : char;
      const accepted = target.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, composed: true, cancelable: true, inputType, data
      }));
      if (!accepted || !valid()) { stop(T('engine.stop.rejected')); return false; }
      setValue.call(target, value);
      target.setSelectionRange(from + char.length, from + char.length);
      session.expected = value;
      session.from = session.to = from + char.length;
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType, data
      }));
      if (!valid()) { stop(T('engine.stop.incompatible')); return false; }
      return true;
    }
    const schedule = (delay) => {
      if (active !== session) return;
      session.stepStartedAt = Date.now();
      session.timer = setTimeout(tick, delay);
    };
    function nextDelay(char) {
      let fraction = Math.random();
      if (options.rhythm) {
        if (session.burstLeft <= 0) {
          session.rhythm = Math.random();
          session.burstLeft = Math.floor(random(4, 10));
        }
        session.burstLeft -= 1;
        fraction = session.rhythm * 0.55 + fraction * 0.45;
      }
      let delay = options.min + fraction * (options.max - options.min);
      if (options.punctuation && /[，。！？；：、,.!?;:\n]/u.test(char)) {
        delay += char === '\n' ? random(700, 1500) : random(250, 700);
      }
      if (Math.random() * 100 < options.pauseRate) delay += random(800, 2400);
      return delay;
    }
    function tick() {
      if (active !== session) return;
      if (!valid()) { stop(T('engine.stop.changed')); return; }
      if (session.plan) { tickPlan(); return; }
      const char = chars[session.index];
      if (session.phase === 'delete') {
        if (!write('', 'deleteContentBackward')) return;
        session.phase = 'correct';
        schedule(random(100, 260));
        return;
      }
      if (session.phase === 'normal' && Math.random() * 100 < options.typoRate) {
        const wrong = wrongCharacter(char);
        if (wrong) {
          session.eraseStart = session.from;
          session.deleteLength = wrong.length;
          if (!write(wrong)) return;
          session.phase = 'delete';
          schedule(random(250, 650));
          return;
        }
      }
      if (!write(char)) return;
      if (active !== session) return;
      session.phase = 'normal';
      session.index += 1;
      report('running', T('engine.running'), { completed: skip + session.index, total, ...timing() });
      if (session.index >= chars.length) {
        finish(total);
        return;
      }
      schedule(nextDelay(char));
    }
    function finish(count) {
      stop();
      const cleanedMessage = options.sanitizedCount ? T('engine.done.cleaned', { n: options.sanitizedCount }) : '';
      const budgetMessage = session.plan && plan?.budget?.enabled
        ? T('engine.done.budget', { scale: plan.budget.scale.toFixed(2) }) : '';
      const skipMessage = skip ? T('engine.done.skip', { n: skip }) : '';
      report('done', T('engine.done', { n: count, extra: `${skipMessage}${cleanedMessage}${budgetMessage}` }),
        { remainingMs: 0, totalMs: session.planTotal, exact: !!session.plan });
    }
    // 边想边打：严格按规划器给出的步骤执行，一步只做一次写入或退格。
    function tickPlan() {
      const steps = session.plan;
      const step = steps[session.step];
      if (!step) { finish(total); return; }
      // 这一步的等待刚刚结束，把它从"计划剩余时间"里扣掉。
      session.planRemaining = Math.max(0, session.planRemaining - step.wait);
      if (step.op === 'backspace') {
        // 保护已有文字：退格既不能越过会话起点，也不能在什么都没写的时候发生。
        if (session.written <= 0 || (session.from !== null && session.from <= session.anchor)) {
          stop(T('engine.stop.eraseBeforeStart'));
          return;
        }
        session.deleteLength = step.char.length;
        session.eraseStart = session.from === null ? null : session.from - step.char.length;
        if (!write('', 'deleteContentBackward', false)) return;
        session.written -= 1;
        session.done = Math.min(session.done, step.src);
      } else {
        if (!write(step.char)) return;
        session.written += 1;
        session.done = Math.max(session.done, step.src + 1);
      }
      if (active !== session) return;
      session.step += 1;
      const next = steps[session.step];
      if (!next) { finish(total); return; }
      // 状态文案描述的是即将发生的事，因此长停顿期间面板会显示"构思中"。
      report('running', next.label, { completed: skip + session.done, total, ...timing() });
      schedule(next.wait);
    }
    // The timer belongs to the page context, so closing the popup does not cancel it.
    if (session.plan) {
      const first = session.plan[0];
      report('running', first.label, { completed: skip, total, ...timing() });
      schedule(first.wait);
    } else schedule(random(500, 1000));
    return T('engine.start.return');
  }
  globalThis.__edgeHumanTyper = { version: '1.2.0', arm, start, startSelected, stop, inspect, setLang,
    getState: () => ({ ...state }) };
})();
