const byId = (id) => document.getElementById(id);
const status = byId('status');

// ---------- 界面语言：默认跟随浏览器，可一键切换并记住选择 ----------
const i18n = globalThis.__typerI18n;
const LANG_KEY = 'uiLang';
let lang = i18n.detect(localStorage.getItem(LANG_KEY));
const t = (key, params) => i18n.translate(lang, key, params);
byId('version').textContent = chrome.runtime.getManifest().version;
function applyLanguage() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('app.name');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of byId('langToggle').querySelectorAll('[data-lang]')) {
    node.classList.toggle('on', node.dataset.lang === lang);
  }
  byId('start').textContent = thinkingMode() ? t('button.startThinking') : t('button.start');
  paintSliderValues();
  if (!activeState || !['running', 'done', 'stopped', 'error'].includes(activeState.phase)) {
    byId('status').textContent = t('status.idle');
    byId('progressLabel').textContent = t('progress.idle');
  }
  if (activeState) renderState(activeState);
  schedulePreview();
}
let activeState = null;
function syncLanguage() {
  if (targetTab === null) return;
  chrome.scripting.executeScript({
    target: { tabId: targetTab, allFrames: true },
    func: (value) => {
      globalThis.__edgeHumanTyper?.setLang?.(value);
      globalThis.__docsTyperTarget?.setLang?.(value);
    },
    args: [lang]
  }).catch(() => {});
}
byId('langToggle').addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* 存储不可用时只在本次会话生效。 */ }
  applyLanguage();
  syncLanguage();
});

const draftFields = ['text', 'mode', 'preset', 'min', 'max', 'punctuation', 'rhythm', 'typoRate', 'pauseRate',
  'tBase', 'tThink', 'tRevise', 'tMaxRevise', 'tTypo', 'tLate', 'tDrift', 'tBudgetOn', 'tBudget'];
try {
  const draft = JSON.parse(localStorage.getItem('typingDraft') || '{}');
  for (const id of draftFields) {
    if (!(id in draft)) continue;
    const element = byId(id);
    if (element.type === 'checkbox') element.checked = Boolean(draft[id]);
    else element.value = draft[id];
  }
} catch { /* A missing or unreadable draft does not prevent typing. */ }
// 旧版本的草稿里可能保存着已移除的“边想边写”预设，回落到自定义而不是让下拉框空白。
if (![...byId('mode').options].some((option) => option.value === byId('mode').value)) byId('mode').value = 'classic';
if (!byId('preset').value || byId('preset').value === 'thinking') byId('preset').value = 'custom';
function saveDraft() {
  const draft = {};
  for (const id of draftFields) {
    const element = byId(id);
    draft[id] = element.type === 'checkbox' ? element.checked : element.value;
  }
  try { localStorage.setItem('typingDraft', JSON.stringify(draft)); } catch { /* Storage may be unavailable. */ }
}
document.addEventListener('input', saveDraft);
document.addEventListener('change', saveDraft);

const presets = {
  careful: { min: 180, max: 420, typoRate: 0.5, pauseRate: 2 },
  natural: { min: 80, max: 220, typoRate: 2, pauseRate: 3 },
  fast: { min: 35, max: 100, typoRate: 3, pauseRate: 1 }
};
for (const id of ['min', 'max', 'typoRate', 'pauseRate', 'punctuation', 'rhythm']) {
  byId(id).addEventListener('input', () => { byId('preset').value = 'custom'; });
}
byId('preset').addEventListener('change', () => {
  const preset = presets[byId('preset').value];
  if (!preset) return;
  for (const [key, value] of Object.entries(preset)) byId(key).value = value;
  byId('punctuation').checked = true;
  byId('rhythm').checked = true;
  schedulePreview();
});
// 两条间隔滑动条互相夹住，避免出现最短大于最长。
byId('min').addEventListener('input', () => {
  if (Number(byId('min').value) > Number(byId('max').value)) byId('max').value = byId('min').value;
});
byId('max').addEventListener('input', () => {
  if (Number(byId('max').value) < Number(byId('min').value)) byId('min').value = byId('max').value;
});

// ---------- 滑动条：数值与"这个参数产生多少概率、消耗多少时间" ----------
const sliderFormat = {
  min: (value) => `${value} ${t('unit.ms')}`, max: (value) => `${value} ${t('unit.ms')}`,
  typoRate: (value) => `${value}%`, pauseRate: (value) => `${value}%`,
  tBase: (value) => `${value} ${t('unit.msPerChar')}`, tThink: (value) => `×${Number(value).toFixed(1)}`,
  tRevise: (value) => `${value}%`, tMaxRevise: (value) => `${value} ${t('unit.char')}`,
  tTypo: (value) => `${value}%`, tLate: (value) => `${value}%`, tDrift: (value) => `${value}%`,
  tBudget: (value) => formatDuration(Number(value))
};
const sliderIds = Object.keys(sliderFormat);
function paintSliderValues() {
  for (const id of sliderIds) byId(`${id}Value`).textContent = sliderFormat[id](byId(id).value);
}
function paintSliderNotes(notes = {}) {
  for (const id of sliderIds) {
    const note = byId(`${id}Note`);
    if (note) note.textContent = notes[id] ?? t('note.empty');
  }
}
function formatDuration(secondsValue) {
  if (!Number.isFinite(secondsValue)) return '—';
  if (secondsValue < 60) {
    return t('duration.short', { value: secondsValue < 10 ? secondsValue.toFixed(1) : Math.round(secondsValue) });
  }
  const minutes = Math.floor(secondsValue / 60);
  return t('duration.long', { min: minutes, sec: Math.round(secondsValue % 60) });
}
const seconds = (ms) => formatDuration(ms / 1000);
// 次数读数：2 次以上取整，低于 2 次保留一位小数，避免“7.0 次”“2.0 revisions”这种读法。
const countText = (count) => t('note.count', { value: count >= 2 ? Math.round(count) : count.toFixed(1) });
const everyText = (count, chars) => count >= 0.05
  ? t('note.every', { n: Math.max(1, Math.round(chars / count)) }) : t('note.none');
function splitText(text) {
  const planner = globalThis.__edgeHumanTyperThinking;
  return planner ? planner.splitGraphemes(text) : Array.from(text);
}
// FNV-1a：把文字与参数折成一个稳定的种子，供侧边栏预览使用。
function previewSeed(text, params, budgetMs) {
  const input = `${text}|${JSON.stringify(params)}|${budgetMs}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}
function classicOptions() {
  return {
    min: Number(byId('min').value), max: Number(byId('max').value),
    punctuation: byId('punctuation').checked, rhythm: byId('rhythm').checked,
    typoRate: Number(byId('typoRate').value), pauseRate: Number(byId('pauseRate').value)
  };
}
// 常规模式的时长用解析式估算：平均间隔 × 字数，加上标点停顿、思考停顿与错字纠正。
function classicEstimate(chars, options) {
  const n = chars.length;
  const typeMs = n * (options.min + options.max) / 2;
  let punctuationMs = 0;
  if (options.punctuation) {
    for (const char of chars) {
      if (char === '\n') punctuationMs += 1100;
      else if (/[，。！？；：、,.!?;:]/u.test(char)) punctuationMs += 475;
    }
  }
  const pauseCount = n * options.pauseRate / 100;
  const pauseMs = pauseCount * 1600;
  const typoable = chars.filter((char) => /[a-zA-Z]/u.test(char) ||
    '的地在再是事做作已以他她时这'.includes(char)).length;
  const typoCount = typoable * options.typoRate / 100;
  const typoMs = typoCount * 900;
  return { n, typoable, typeMs, punctuationMs, pauseCount, pauseMs, typoCount, typoMs, totalMs: typeMs + punctuationMs + pauseMs + typoMs };
}

const thinkingLabels = {
  base: 'param.base', thinkScale: 'param.thinkScale', reviseRate: 'param.reviseRate',
  maxRevise: 'param.maxRevise', typoRate: 'param.typoRate', lateTypoRate: 'param.lateTypoRate',
  driftRate: 'param.driftRate'
};
const thinkingLimits = {
  base: [30, 200], thinkScale: [0.4, 2], reviseRate: [0, 25],
  maxRevise: [1, 12], typoRate: [0, 10], lateTypoRate: [0, 15], driftRate: [0, 15]
};
const previewLimit = 1500;
const canvas = byId('preview');
function thinkingMode() { return byId('mode').value === 'thinking'; }
function thinkingParams() {
  return {
    base: Number(byId('tBase').value), thinkScale: Number(byId('tThink').value),
    reviseRate: Number(byId('tRevise').value), maxRevise: Number(byId('tMaxRevise').value),
    typoRate: Number(byId('tTypo').value), lateTypoRate: Number(byId('tLate').value),
    driftRate: Number(byId('tDrift').value)
  };
}
function readThinkingParams() {
  const params = thinkingParams();
  for (const [key, [min, max]] of Object.entries(thinkingLimits)) {
    if (!Number.isFinite(params[key]) || params[key] < min || params[key] > max) {
      throw new Error(t('error.range', { label: t(thinkingLabels[key]), min, max }));
    }
  }
  if (!Number.isInteger(params.maxRevise)) throw new Error(t('error.maxReviseInt'));
  return params;
}
// 返回毫秒；0 表示不启用预算。
function readBudgetMs() {
  if (!byId('tBudgetOn').checked) return 0;
  const planner = globalThis.__edgeHumanTyperThinking;
  const [min, max] = planner?.budgetSecondsRange ?? [10, 7200];
  const value = Number(byId('tBudget').value);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(t('error.budgetRange', { min, max: max / 60 }));
  }
  return Math.round(value * 1000);
}
function applyMode() {
  const thinking = thinkingMode();
  byId('classicPanel').hidden = thinking;
  byId('thinkingPanel').hidden = !thinking;
  byId('start').textContent = thinking ? t('button.startThinking') : t('button.start');
  schedulePreview();
}
let lastRender = 0;
let previewTimer = null;
// 拖动时先立刻刷新数值，重算计划按 60 毫秒节流，保证滑动手感与实时反馈兼得。
function schedulePreview() {
  paintSliderValues();
  const now = performance.now();
  if (now - lastRender >= 60) {
    clearTimeout(previewTimer);
    previewTimer = null;
    lastRender = now;
    renderPreview();
    return;
  }
  if (previewTimer) return;
  previewTimer = setTimeout(() => {
    previewTimer = null;
    lastRender = performance.now();
    renderPreview();
  }, 60 - (now - lastRender));
}
function renderPreview() {
  if (thinkingMode()) renderThinkingPreview();
  else renderClassicPreview();
}
function renderClassicPreview() {
  const chars = splitText(HumanTextSanitizer.sanitize(byId('text').value).text);
  const options = classicOptions();
  const estimate = classicEstimate(chars, options);
  const n = estimate.n;
  const notes = n ? {
    min: t('note.min', { n, min: options.min, time: seconds(n * options.min) }),
    max: t('note.max', { n, max: options.max, time: seconds(n * options.max) }),
    typoRate: estimate.typoCount > 0
      ? t('note.typoRate.classic', { count: countText(estimate.typoCount), typoable: estimate.typoable,
          every: everyText(estimate.typoCount, n), time: seconds(estimate.typoMs) })
      : t('note.typoRate.none'),
    pauseRate: estimate.pauseCount > 0
      ? t('note.pauseRate.classic', { count: countText(estimate.pauseCount), time: seconds(estimate.pauseMs) })
      : t('note.pauseRate.none')
  } : {};
  paintSliderNotes(notes);
  byId('classicSummary').textContent = n
    ? t('note.summary.classic', { total: seconds(estimate.totalMs), type: seconds(estimate.typeMs),
        punct: seconds(estimate.punctuationMs), pause: seconds(estimate.pauseMs), typo: seconds(estimate.typoMs) })
    : t('classic.summary.empty');
}
function renderThinkingPreview() {
  const summary = byId('previewSummary');
  const warning = byId('previewWarning');
  const context = canvas.getContext('2d');
  const width = canvas.clientWidth || 280;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(42 * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, 42);
  warning.hidden = true;
  const planner = globalThis.__edgeHumanTyperThinking;
  const empty = (message) => { summary.textContent = message; paintSliderNotes(); };
  if (!planner) { empty(t('preview.unavailable')); return; }
  const cleaned = HumanTextSanitizer.sanitize(byId('text').value).text;
  const chars = planner.splitGraphemes(cleaned);
  if (!chars.length) { empty(t('preview.empty')); return; }
  let budgetMs = 0;
  try { budgetMs = readBudgetMs(); }
  catch (error) { empty(t('preview.error', { message: error.message })); return; }
  const truncated = chars.length > previewLimit;
  // 预览用固定种子：同样的文字和参数得到同样的节奏，切换语言时数值不会跳。
  const seed = previewSeed(cleaned, thinkingParams(), budgetMs);
  const plan = planner.buildPlan({ text: truncated ? chars.slice(0, previewLimit).join('') : cleaned,
    params: thinkingParams(), budgetMs, lang, seed });
  if (!plan) { empty(t('preview.tooLong', { max: planner.maxPlanChars })); return; }
  // 预览只取前若干字时，按字数比例折算成全文时长，避免"看起来只要几秒"。
  const factor = chars.length / plan.chars.length;
  const full = (ms) => ms * factor;
  const stats = plan.stats;
  const totalMs = full(stats.totalMs);
  const reviseRuns = stats.reviseRuns * factor;
  const reviseChars = stats.reviseChars * factor;
  const typoCount = stats.typoCount * factor;
  const lateRuns = stats.lateRuns * factor;
  const driftCount = stats.driftCount * factor;
  paintSliderNotes({
    tBase: t('note.tBase', { ms: Math.round(full(stats.typeMs) / chars.length), time: seconds(full(stats.typeMs)) }),
    tThink: t('note.tThink', { time: seconds(full(stats.thinkMs)),
      percent: Math.round(stats.thinkMs / stats.totalMs * 100) }),
    tRevise: reviseRuns >= 0.05
      ? t('note.tRevise', { count: countText(reviseRuns), every: everyText(reviseRuns, chars.length),
          time: seconds(full(stats.reviseMs)) })
      : t('note.tRevise.none'),
    tMaxRevise: reviseRuns >= 0.05
      ? t('note.tMaxRevise', { chars: (reviseChars / reviseRuns).toFixed(1),
          seconds: (full(stats.reviseMs) / reviseRuns / 1000).toFixed(1) })
      : t('note.tMaxRevise.none'),
    tTypo: typoCount >= 0.05
      ? t('note.tTypo', { count: countText(typoCount), every: everyText(typoCount, chars.length),
          time: seconds(full(stats.typoMs)) })
      : t('note.tTypo.none'),
    tLate: lateRuns >= 0.05
      ? t('note.tLate', { count: countText(lateRuns), time: seconds(full(stats.lateMs)) })
      : t('note.tLate.none'),
    tDrift: driftCount >= 0.05
      ? t('note.tDrift', { count: countText(driftCount), time: seconds(full(stats.driftMs)),
          every: everyText(driftCount, chars.length) })
      : t('note.tDrift.none'),
    tBudget: plan.budget.enabled
      ? t('note.tBudget.on', { target: formatDuration(plan.budget.budgetMs / 1000), est: seconds(totalMs),
          scale: plan.budget.scale.toFixed(2) })
      : t('note.tBudget.off')
  });
  let time = 0;
  const sampleTotal = Math.max(1, stats.totalMs);
  for (const step of plan.steps) {
    const start = time;
    time += step.wait;
    // 浅蓝＝构思/走神停顿，橙色＝回改或纠错退格，蓝色＝正在书写。
    const pause = step.pause === 'think' || step.pause === 'drift' || step.pause === 'rethink';
    context.fillStyle = pause ? '#c3d3f4' : step.op === 'backspace' ? '#e08a2e' : '#245ad7';
    context.fillRect(start / sampleTotal * width, 0, Math.max(1, step.wait / sampleTotal * width), 42);
  }
  const detail = t('preview.detail', {
    think: Math.round(stats.thinkMs / stats.totalMs * 100), revise: Math.round(reviseRuns),
    typo: Math.round(typoCount), longest: (stats.longestPause / 1000).toFixed(1)
  });
  const suffix = truncated ? t('preview.truncated', { n: previewLimit }) : '';
  summary.textContent = plan.budget.enabled
    ? t('preview.budget', { budget: formatDuration(plan.budget.budgetMs / 1000), estimate: seconds(totalMs),
        scale: plan.budget.scale.toFixed(2), detail, suffix })
    : t('preview.plain', { estimate: seconds(totalMs), detail, suffix });
  if (!plan.budget.enabled || plan.budget.reached || truncated) return;
  const gap = seconds(Math.abs(totalMs - plan.budget.budgetMs));
  warning.textContent = plan.budget.limited === 'max'
    ? t('preview.warn.max', { scale: planner.maxPauseScale, estimate: seconds(totalMs), gap })
    : t('preview.warn.min', { writing: seconds(full(plan.budget.writingMs)), scale: planner.minPauseScale,
        estimate: seconds(totalMs), gap });
  warning.hidden = false;
}
byId('mode').addEventListener('change', () => { hideResume(); applyMode(); saveDraft(); });
for (const id of sliderIds) byId(id).addEventListener('input', () => schedulePreview());
byId('tBudgetOn').addEventListener('change', () => schedulePreview());
byId('punctuation').addEventListener('change', () => { if (!thinkingMode()) schedulePreview(); });
byId('rhythm').addEventListener('change', () => { if (!thinkingMode()) schedulePreview(); });
byId('text').addEventListener('input', schedulePreview);
window.addEventListener('resize', schedulePreview);

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error(t('error.noTab'));
  return tab.id;
}

let targetTab = null;
let targetMode = 'normal';
let targetFrame = null;
let monitor = null;
let busy = false;
function renderState(state) {
  if (!state) throw new Error(t('error.noState'));
  activeState = state;
  status.textContent = state.message;
  byId('start').disabled = state.phase !== 'ready';
  renderProgress(state);
}
// 进度按"距离结尾还有多少时间"计算，百分比保留两位小数。
// 边想边打直接读计划里剩余的等待时间（exact），常规模式按剩余字数估算。
function formatSpan(ms) {
  const total = Math.max(0, ms) / 1000;
  if (total < 60) return t('duration.short', { value: total.toFixed(2) });
  const minutes = Math.floor(total / 60);
  return t('duration.long', { min: minutes, sec: (total - minutes * 60).toFixed(2) });
}
function renderProgress(state = {}) {
  const totalMs = Math.max(0, Number(state.totalMs) || 0);
  const remainingMs = Math.min(totalMs, Math.max(0, Number(state.remainingMs) || 0));
  const ratio = totalMs > 0 ? Math.min(1, Math.max(0, (totalMs - remainingMs) / totalMs)) : 0;
  const percent = (ratio * 100).toFixed(2);
  byId('progressFill').style.width = `${percent}%`;
  byId('progressFill').classList.toggle('active', state.phase === 'running');
  byId('progressLabel').textContent = totalMs > 0
    ? t('progress.left', { percent, time: formatSpan(remainingMs) })
    : t('progress.idle');
  byId('progressTrack').setAttribute('aria-valuenow', percent);
}
function stopMonitor() {
  clearTimeout(monitor);
  monitor = null;
}
async function readState(tabId) {
  const target = targetMode === 'docs' || targetFrame !== null
    ? { tabId, ...(targetFrame === null ? {} : { frameIds: [targetFrame] }) }
    : { tabId, allFrames: true };
  const responses = await chrome.scripting.executeScript({
    target,
    func: (mode) => (mode === 'docs' ? globalThis.__docsTyperTarget : globalThis.__edgeHumanTyper)?.getState(),
    args: [targetMode]
  });
  const available = responses.filter(item => item.result);
  if (!available.length) return null;
  let response = available[0];
  if (targetMode === 'normal' && targetFrame === null) {
    const rank = { running: 5, ready: 4, done: 3, selecting: 2, error: 1, stopped: 0, idle: 0 };
    response = available.sort((a, b) => (rank[b.result.phase] ?? -1) - (rank[a.result.phase] ?? -1))[0];
    if (['ready', 'running'].includes(response.result.phase)) targetFrame = response.frameId;
  }
  return response.result;
}
function startMonitor(tabId) {
  stopMonitor();
  const poll = async () => {
    if (targetTab !== tabId) return;
    if (busy) { monitor = setTimeout(poll, 400); return; }
    try {
      const state = await readState(tabId);
      if (targetTab !== tabId || busy) return;
      renderState(state);
      trackDocsRun(state);
      if (!['selecting', 'ready', 'running'].includes(state.phase)) return;
    } catch (error) {
      status.textContent = t('status.connectedLost', { message: error.message });
      byId('start').disabled = true;
      return;
    }
    monitor = setTimeout(poll, 400);
  };
  monitor = setTimeout(poll, 200);
}

byId('pick').addEventListener('click', async () => {
  busy = true;
  byId('pick').disabled = true;
  byId('start').disabled = true;
  hideResume();
  stopMonitor();
  try {
    const tabId = await currentTab();
    const stopped = await chrome.runtime.sendMessage({ type: 'docsStop' });
    if (!stopped?.ok) throw new Error(stopped?.error || t('error.stopOld'));
    if (targetTab !== null && targetTab !== tabId) {
      await chrome.scripting.executeScript({ target: { tabId: targetTab },
        func: () => { globalThis.__edgeHumanTyper?.stop(); globalThis.__docsTyperTarget?.stop(); } }).catch(() => {});
    }
    targetTab = tabId;
    targetFrame = null;
    const tab = await chrome.tabs.get(tabId);
    targetMode = /^https:\/\/docs\.google\.com\/document\//.test(tab.url || '') ? 'docs' : 'normal';
    // 调试器权限是可选的：只在用户主动为文档模式启用时申请，避免安装时出现强权限提示。
    if (targetMode === 'docs' && !(await chrome.permissions.contains({ permissions: ['debugger'] }))) {
      byId('enableDocs').hidden = false;
      byId('modeHint').textContent = t('modeHint.docsPermission');
      status.textContent = t('status.docsPermission');
      return;
    }
    byId('enableDocs').hidden = true;
    byId('modeHint').textContent = targetMode === 'docs' ? t('modeHint.docs') : t('modeHint.normal');
    const injectionTarget = targetMode === 'docs' ? { tabId } : { tabId, allFrames: true };
    // 规划器必须先于输入引擎注入，typist.js 在启动“边想边打”时会读取它。
    await chrome.scripting.executeScript({ target: injectionTarget,
      files: targetMode === 'docs' ? ['i18n.js', 'docs-target.js'] : ['i18n.js', 'thinking.js', 'typist.js'] });
    await chrome.scripting.executeScript({ target: injectionTarget,
      func: (mode, language) => (mode === 'docs'
        ? globalThis.__docsTyperTarget.arm({ lang: language })
        : globalThis.__edgeHumanTyper.arm(null, language)), args: [targetMode, lang] });
    renderState(await readState(tabId));
    startMonitor(tabId);
  } catch (error) {
    status.textContent = t('error.connect', { message: error.message, version: chrome.runtime.getManifest().version });
  } finally {
    busy = false;
    byId('pick').disabled = false;
  }
});

// ---------- 可选权限：Google 文档模式需要调试器 ----------
byId('enableDocs').addEventListener('click', async () => {
  // 必须由用户点击触发，授权框才会出现。
  const granted = await chrome.permissions.request({ permissions: ['debugger'] });
  if (!granted) {
    status.textContent = t('status.docsPermissionDenied');
    return;
  }
  byId('enableDocs').hidden = true;
  status.textContent = t('status.docsPermissionGranted');
});

// ---------- 续打检测：开始前先看目标里是不是已经写好了开头 ----------
let pendingStart = null;
function hideResume() {
  byId('resumePanel').hidden = true;
  pendingStart = null;
}
function showResume(report, options) {
  pendingStart = { options, skip: report.skip };
  const head = report.preview ? `…${report.preview}` : '';
  const next = report.next ? `${report.next}…` : '';
  byId('resumeMessage').textContent = report.already
    ? t('resume.already', { tail: head })
    : t('resume.matched', { skip: report.skip, total: report.total, head, next,
        source: report.source === 'docs' ? t('resume.source.docs') : t('resume.source.field') });
  byId('resumeContinue').hidden = report.already;
  byId('resumePanel').hidden = false;
  status.textContent = report.already ? t('resume.status.already') : t('resume.status.matched');
}
// Google 文档的正文不可读取，只能依据本扩展上次发送到这篇文档的本地记录判断续打位置。
// 记录写在侧边栏自己的 localStorage 里（与草稿同一处），因此不需要额外的 storage 权限；
// 数据来源是面板运行时轮询到的进度，所以面板需要保持打开，这一点本来也是文档模式的使用前提。
function readDocsResume() {
  try { return JSON.parse(localStorage.getItem('docsResume') || 'null'); } catch { return null; }
}
function writeDocsResume(record) {
  try { localStorage.setItem('docsResume', JSON.stringify(record)); } catch { /* 存储不可用时只是失去续打提示。 */ }
}
let docsRun = null;
function trackDocsRun(state) {
  if (!docsRun) return;
  if (state.phase === 'running') { docsRun.running = true; return; }
  if (!docsRun.running || !['done', 'stopped', 'error'].includes(state.phase)) return;
  writeDocsResume({ url: docsRun.url, text: docsRun.text, sent: Math.max(0, state.completed || 0), at: Date.now() });
  docsRun = null;
}
async function inspectDocs(options) {
  const planner = globalThis.__edgeHumanTyperThinking;
  const split = (value) => planner ? planner.splitGraphemes(value) : Array.from(value);
  const chars = split(options.text);
  const total = chars.length;
  const report = { ok: true, total, skip: 0, remaining: total, matched: false, already: false,
    preview: '', next: chars.slice(0, 14).join(''), source: 'docs' };
  const tab = await chrome.tabs.get(targetTab);
  const stored = readDocsResume();
  if (!stored || stored.url !== (tab.url || '') || !(stored.sent > 0)) return report;
  const previous = split(stored.text || '');
  if (!previous.length || previous.length > total) return report;
  if (chars.slice(0, previous.length).join('') !== previous.join('')) return report;
  const skip = Math.min(stored.sent, total);
  return { ...report, skip, remaining: total - skip, matched: skip > 0 && skip < total,
    already: skip >= total, preview: chars.slice(Math.max(0, skip - 14), skip).join(''),
    next: chars.slice(skip, skip + 14).join('') };
}
async function inspectTarget(tabId, options) {
  if (targetMode === 'docs') return inspectDocs(options);
  if (targetFrame === null) throw new Error(t('error.noTarget'));
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [targetFrame] },
    func: (settings) => globalThis.__edgeHumanTyper.inspect(settings), args: [options]
  });
  return result.result;
}
async function startTyping(options, tabId) {
  if (targetMode === 'docs') {
    const tab = await chrome.tabs.get(tabId);
    docsRun = { url: tab.url || '', text: options.text, running: false };
    const response = await chrome.runtime.sendMessage({ type: 'docsStart', tabId, options });
    if (!response?.ok) { docsRun = null; throw new Error(response?.error || t('error.docsStart')); }
  } else {
    if (targetFrame === null) throw new Error(t('error.noTarget'));
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [targetFrame] },
      func: (settings) => globalThis.__edgeHumanTyper.startSelected(settings), args: [options]
    });
  }
  renderState(await readState(tabId));
  saveDraft();
  startMonitor(tabId);
}
byId('resumeContinue').addEventListener('click', async () => {
  const pending = pendingStart;
  hideResume();
  if (!pending) return;
  busy = true;
  byId('start').disabled = true;
  try {
    await startTyping({ ...pending.options, skipChars: pending.skip }, targetTab);
  } catch (error) {
    status.textContent = t('error.cannotStart', { message: error.message });
    byId('start').disabled = targetTab === null;
  } finally { busy = false; }
});
byId('resumeRestart').addEventListener('click', async () => {
  const pending = pendingStart;
  hideResume();
  if (!pending) return;
  busy = true;
  byId('start').disabled = true;
  try {
    await startTyping({ ...pending.options, skipChars: 0 }, targetTab);
  } catch (error) {
    status.textContent = t('error.cannotStart', { message: error.message });
    byId('start').disabled = targetTab === null;
  } finally { busy = false; }
});

byId('start').addEventListener('click', async () => {
  busy = true;
  byId('start').disabled = true;
  hideResume();
  stopMonitor();
  try {
    const cleaned = HumanTextSanitizer.sanitize(byId('text').value);
    byId('text').value = cleaned.text;
    const common = { text: cleaned.text, sanitizedCount: cleaned.removed + cleaned.replacedSpaces, lang };
    if (!common.text) throw new Error(t('error.noText'));
    let options;
    if (thinkingMode()) {
      const planner = globalThis.__edgeHumanTyperThinking;
      if (!planner) throw new Error(t('error.noPlanner'));
      if (planner.splitGraphemes(common.text).length > planner.maxPlanChars) {
        throw new Error(t('error.tooLong', { max: planner.maxPlanChars }));
      }
      options = { ...common, mode: 'thinking', params: readThinkingParams(), budgetMs: readBudgetMs() };
    } else {
      options = { ...common, ...classicOptions() };
      if (!Number.isFinite(options.min) || !Number.isFinite(options.max) ||
          options.min < 20 || options.max > 5000 || options.max < options.min) {
        throw new Error(t('error.minMax'));
      }
      if (!Number.isFinite(options.typoRate) || options.typoRate < 0 || options.typoRate > 15 ||
          !Number.isFinite(options.pauseRate) || options.pauseRate < 0 || options.pauseRate > 20) {
        throw new Error(t('error.rates'));
      }
    }
    const tabId = await currentTab();
    if (tabId !== targetTab) throw new Error(t('error.tabChanged'));
    // 先检查目标里是不是已经写好了开头：是的话由用户决定"接着打"还是"从头打"。
    const report = await inspectTarget(tabId, options);
    if (report?.matched || report?.already) {
      showResume(report, options);
      byId('start').disabled = false;
      return;
    }
    await startTyping({ ...options, skipChars: report?.skip || 0 }, tabId);
  } catch (error) {
    status.textContent = t('error.cannotStart', { message: error.message });
    byId('start').disabled = targetTab === null;
  } finally {
    busy = false;
  }
});

byId('stop').addEventListener('click', async () => {
  busy = true;
  hideResume();
  stopMonitor();
  try {
    const tabId = targetTab ?? await currentTab();
    await chrome.runtime.sendMessage({ type: 'docsStop' });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => { globalThis.__edgeHumanTyper?.stop(); globalThis.__docsTyperTarget?.stop(); }
    });
    status.textContent = t('status.stopped');
    byId('start').disabled = true;
  } catch (error) {
    status.textContent = t('error.cannotStop', { message: error.message });
  } finally {
    busy = false;
  }
});

applyMode();
// 首次打开（含跟随浏览器语言得到的英文界面）也要应用一遍文案。
applyLanguage();
