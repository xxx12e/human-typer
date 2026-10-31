// Google Docs browser-input adapter. No document content is read or uploaded.
//
// 文档应当收到一个一个按键、带着停顿的输入，而不是整段插入：
// 物理键盘能打出的字符走 Input.dispatchKeyEvent（含 Shift 组合），
// 需要输入法提交的字符（中文、中文标点）走 Input.insertText，
// 那是真实输入法提交候选词时文档收到的路径。两种方式都按计划每字符一次。
let docsJob = null;
let runnerLang = 'zh';
const T = (key, params) => globalThis.__typerI18n?.translate(runnerLang, key, params) ?? key;
const randomDelay = (min, max) => min + Math.random() * (max - min);
async function targetCall(tabId, method, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId },
    func: (method, args) => globalThis.__docsTyperTarget[method](...args), args: [method, args] });
  return result.result;
}
const keyMap = new Map();
{
  const punctuation = [
    [' ', ' ', 32, 'Space'], ['`', '~', 192, 'Backquote'], ['-', '_', 189, 'Minus'], ['=', '+', 187, 'Equal'],
    ['[', '{', 219, 'BracketLeft'], [']', '}', 221, 'BracketRight'], ['\\', '|', 220, 'Backslash'],
    [';', ':', 186, 'Semicolon'], ["'", '"', 222, 'Quote'], [',', '<', 188, 'Comma'],
    ['.', '>', 190, 'Period'], ['/', '?', 191, 'Slash']
  ];
  for (let digit = 0; digit <= 9; digit += 1) {
    punctuation.push([String(digit), ')!@#$%^&*('.charAt(digit), digit === 0 ? 48 : 48 + digit, `Digit${digit}`]);
  }
  for (const [plain, shifted, vk, code] of punctuation) {
    keyMap.set(plain, { key: plain, code, vk, shift: false });
    if (shifted !== plain) keyMap.set(shifted, { key: shifted, code, vk, shift: true });
  }
  for (let index = 0; index < 26; index += 1) {
    const lower = String.fromCharCode(97 + index);
    const upper = lower.toUpperCase();
    keyMap.set(lower, { key: lower, code: `Key${upper}`, vk: 65 + index, shift: false });
    keyMap.set(upper, { key: upper, code: `Key${upper}`, vk: 65 + index, shift: true });
  }
}
const SHIFT = { key: 'Shift', code: 'ShiftLeft', vk: 16, shift: false };
const ENTER = { key: 'Enter', code: 'Enter', vk: 13, shift: false };
const BACKSPACE = { key: 'Backspace', code: 'Backspace', vk: 8, shift: false };
const graphemes = (value) => typeof Intl.Segmenter === 'function'
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(value)), (item) => item.segment)
  : Array.from(String(value));
// 文档正文不可读取，续打只能按请求里带来的偏移量处理（侧边栏已根据本地记录确认过）。
const resumeSkip = (options) => {
  const total = graphemes(options.text || '').length;
  return Math.max(0, Math.min(Math.floor(Number(options.skipChars)) || 0, total));
};
// 进度按时间而不是字数：常规模式按剩余字数估算，边想边打直接读计划里剩余的等待时间。
const PUNCTUATION_RE = /[，。！？；：、,.!?;:]/u;
const classicPerCharMs = (options) => (options.min + options.max) / 2 + (options.pauseRate / 100) * 1600;
const classicTotalMs = (chars, options) => {
  let ms = chars.length * classicPerCharMs(options) + 700;
  if (options.punctuation) {
    for (const char of chars) {
      if (char === '\n') ms += 1100;
      else if (PUNCTUATION_RE.test(char)) ms += 475;
    }
  }
  return ms;
};
const classicRemainingMs = (chars, index, options) => {
  let ms = (chars.length - index) * classicPerCharMs(options);
  if (options.punctuation) {
    for (let cursor = index; cursor < chars.length; cursor += 1) {
      const char = chars[cursor];
      if (char === '\n') ms += 1100;
      else if (PUNCTUATION_RE.test(char)) ms += 475;
    }
  }
  return Math.max(0, ms);
};
function stopDocs(reason = T('docs.stopped')) {
  if (!docsJob) return;
  docsJob.cancelled = true;
  docsJob.reason = reason;
  docsJob.wake?.();
}
function waitDocs(job, ms) {
  if (job.cancelled) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => { job.wake = null; resolve(); }, ms);
    job.wake = () => { clearTimeout(timer); job.wake = null; resolve(); };
  });
}
async function runDocs(job, options, chars, plan, total) {
  const debuggee = { tabId: job.tabId };
  const skip = total - chars.length;
  // 计划模式的时间进度来自计划本身；常规模式按字估算。
  let planRemaining = plan ? plan.stats.totalMs : 0;
  let stepStartedAt = Date.now();
  const planTotalMs = plan ? plan.stats.totalMs : classicTotalMs(chars, options);
  const timing = () => plan
    ? { remainingMs: Math.max(0, planRemaining - (Date.now() - stepStartedAt)), totalMs: planTotalMs, exact: true }
    : { remainingMs: classicRemainingMs(chars, completed, options), totalMs: planTotalMs, exact: false };
  let attached = false;
  let failure = null;
  let completed = 0;
  const detached = (source) => {
    if (source.tabId === job.tabId && !job.detaching) stopDocs(T('docs.detached'));
  };
  const guard = async () => {
    if (job.cancelled) throw new Error(job.reason);
    if (!(await targetCall(job.tabId, 'check'))) throw new Error(T('docs.focusChanged'));
    if (job.cancelled) throw new Error(job.reason);
  };
  const sendKey = (type, info, modifiers, text) => chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
    type, key: info.key, code: info.code,
    windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk,
    modifiers, autoRepeat: false, isKeypad: false, location: 0,
    ...(text === undefined ? {} : { text, unmodifiedText: text })
  });
  // 每次按键前先向页面登记将要发出的键名，否则页面会把它当成用户手动操作而中断任务。
  const press = async (info, text) => {
    await guard();
    await targetCall(job.tabId, 'expectKeys', [info.shift ? [info.key, SHIFT.key] : [info.key]]);
    if (info.shift) await sendKey('keyDown', SHIFT, 8);
    await sendKey('keyDown', info, info.shift ? 8 : 0, text);
    await sendKey('keyUp', info, info.shift ? 8 : 0);
    if (info.shift) await sendKey('keyUp', SHIFT, 0);
  };
  const insert = async (text) => {
    await guard();
    await chrome.debugger.sendCommand(debuggee, 'Input.insertText', { text });
  };
  const typeChar = async (char) => {
    if (char === '\n') { await press(ENTER, '\r'); return; }
    const info = keyMap.get(char);
    if (info) { await press(info, char); return; }
    await insert(char);
  };
  const backspace = () => press(BACKSPACE);
  const progress = (done, label) => targetCall(job.tabId, 'progress', [skip + done, total, label, timing()]);
  try {
    chrome.debugger.onDetach.addListener(detached);
    await chrome.debugger.attach(debuggee, '1.3');
    attached = true;
    if (job.cancelled) throw new Error(job.reason);
    await targetCall(job.tabId, 'prepare', [total, planTotalMs]);
    if (plan) {
      // 边想边打：逐步执行规划器给出的计划，每一步只做一个按键或一次退格。
      for (const step of plan.steps) {
        await guard();
        stepStartedAt = Date.now();
        await waitDocs(job, step.wait);
        planRemaining = Math.max(0, planRemaining - step.wait);
        if (step.op === 'backspace') {
          await backspace();
          completed = Math.min(completed, step.src);
        } else {
          await typeChar(step.char);
          completed = Math.max(completed, step.src + 1);
        }
        await progress(completed, step.label);
      }
    } else {
      await waitDocs(job, randomDelay(500, 1000));
      let rhythm = Math.random(), burst = 0;
      for (const char of chars) {
        await guard();
        // 单字符错字：一次 Backspace 必须恰好删掉我们自己打错的那个字符。
        if (/^[a-zA-Z]$/.test(char) && Math.random() * 100 < options.typoRate) {
          const letters = 'abcdefghijklmnopqrstuvwxyz';
          const index = letters.indexOf(char.toLowerCase());
          let wrong = letters[(index + (Math.random() < 0.5 ? 1 : 25)) % 26];
          if (char === char.toUpperCase()) wrong = wrong.toUpperCase();
          await typeChar(wrong);
          await waitDocs(job, randomDelay(250, 650));
          await backspace();
          await waitDocs(job, randomDelay(100, 260));
        }
        await typeChar(char);
        completed += 1;
        await progress(completed);
        if (completed === chars.length) break;
        if (burst-- <= 0) { rhythm = Math.random(); burst = Math.floor(randomDelay(4, 10)); }
        const fraction = options.rhythm ? rhythm * .55 + Math.random() * .45 : Math.random();
        let delay = options.min + fraction * (options.max - options.min);
        if (options.punctuation && /[，。！？；：、,.!?;:\n]/u.test(char)) {
          delay += char === '\n' ? randomDelay(700, 1500) : randomDelay(250, 700);
        }
        if (Math.random() * 100 < options.pauseRate) delay += randomDelay(800, 2400);
        await waitDocs(job, delay);
      }
    }
  } catch (error) {
    failure = error.message;
  } finally {
    job.detaching = true;
    if (attached) await chrome.debugger.detach(debuggee).catch(() => {});
    chrome.debugger.onDetach.removeListener(detached);
    const interrupted = failure || job.cancelled;
    const budget = plan?.budget?.enabled ? T('engine.done.budget', { scale: plan.budget.scale.toFixed(2) }) : '';
    const skipNote = skip ? T('engine.done.skip', { n: skip }) : '';
    await targetCall(job.tabId, 'finish', [interrupted ? 'stopped' : 'done',
      interrupted ? T('docs.finish.stopped', { reason: job.reason || failure })
      : T('docs.finish.done', { n: skip + completed, extra: `${skipNote}${options.sanitizedCount ? T('engine.done.cleaned', { n: options.sanitizedCount }) : ''}${budget}` }),
      skip + completed, total]).catch(() => {});
    if (docsJob === job) docsJob = null;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'docsCancel' && sender.tab?.id === docsJob?.tabId) {
    stopDocs(T('docs.stop.manual')); respond({ ok: true }); return;
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL('')) || !['docsStart', 'docsStop'].includes(message.type)) return;
  (async () => {
    if (message.type === 'docsStop') {
      const job = docsJob;
      stopDocs();
      if (job) await job.finished;
      return { ok: true };
    }
    if (docsJob) throw new Error(T('docs.error.busy'));
    const tab = await chrome.tabs.get(message.tabId);
    if (!/^https:\/\/docs\.google\.com\/document\//.test(tab.url || '')) throw new Error(T('docs.error.notDocs'));
    if (!tab.active) throw new Error(T('docs.error.notActive'));
    let o = message.options;
    if (o?.lang) runnerLang = globalThis.__typerI18n?.normalize(o.lang) || runnerLang;
    let plan = null;
    if (o?.mode === 'thinking') {
      const planner = globalThis.__edgeHumanTyperThinking;
      if (planner?.api !== 1) throw new Error(T('docs.error.planner'));
      if (typeof o.text !== 'string' || !o.text) throw new Error(T('docs.error.settings'));
      const cleaned = HumanTextSanitizer.sanitize(o.text);
      o = { ...o, text: cleaned.text,
        sanitizedCount: (o.sanitizedCount || 0) + cleaned.removed + cleaned.replacedSpaces + (cleaned.normalized || 0) };
      if (!o.text) throw new Error(T('docs.error.empty'));
      const skip = resumeSkip(o);
      const remaining = graphemes(o.text).slice(skip).join('');
      if (!remaining) throw new Error(T('docs.error.alreadySent'));
      plan = planner.buildPlan({ text: remaining, params: o.params, budgetMs: o.budgetMs });
      if (!plan) throw new Error(T('engine.error.tooLong', { max: planner.maxPlanChars }));
    } else {
      if (!o || typeof o.text !== 'string' || !o.text ||
          ![o.min, o.max, o.typoRate, o.pauseRate].every(Number.isFinite) ||
          o.min < 20 || o.max > 5000 || o.min > o.max || o.typoRate < 0 || o.typoRate > 15 ||
          o.pauseRate < 0 || o.pauseRate > 20) throw new Error(T('docs.error.settings'));
      const cleaned = HumanTextSanitizer.sanitize(o.text);
      o = { ...o, text: cleaned.text,
        sanitizedCount: (o.sanitizedCount || 0) + cleaned.removed + cleaned.replacedSpaces + (cleaned.normalized || 0) };
      if (!o.text) throw new Error(T('docs.error.empty'));
      const skip = resumeSkip(o);
      if (!graphemes(o.text).slice(skip).length) throw new Error(T('docs.error.alreadySent'));
    }
    const fullChars = graphemes(o.text);
    const skip = resumeSkip(o);
    const chars = plan ? plan.chars : fullChars.slice(skip);
    if (docsJob) throw new Error(T('docs.error.busy'));
    const job = { tabId: tab.id, windowId: tab.windowId, cancelled: false, reason: null, wake: null };
    docsJob = job;
    job.finished = runDocs(job, o, chars, plan, fullChars.length);
    return { ok: true };
  })().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (docsJob && docsJob.windowId === windowId && docsJob.tabId !== tabId) stopDocs(T('docs.stop.tabSwitch'));
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === docsJob?.tabId && info.status === 'loading') stopDocs(T('docs.stop.reload'));
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === docsJob?.tabId) stopDocs(T('docs.stop.closed'));
});
