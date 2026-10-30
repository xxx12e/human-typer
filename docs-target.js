(() => {
  if (globalThis.__docsTyperTarget?.version === '1.1.0') return;
  globalThis.__docsTyperTarget?.stop();
  let engineLang = 'zh';
  const T = (key, params) => globalThis.__typerI18n?.translate(engineLang, key, params) ?? key;
  let state = { phase: 'idle', message: T('docs.idleSelect'), completed: 0, total: 0 };
  let control = null;
  let timer = null;
  let target = null;
  let frame = null;
  // 逐字真实按键会产生大量 keydown，先登记即将发出的键名，避免被当成手动操作。
  let expectedKeys = [];
  const update = (change) => { state = { ...state, ...change }; return { ...state }; };
  function stop(message = T('docs.stoppedDefault')) {
    clearTimeout(timer);
    control?.abort();
    control = null;
    target = frame = null;
    expectedKeys = [];
    return update({ phase: 'stopped', message });
  }
  function cancel(message) {
    stop(message);
    chrome.runtime.sendMessage({ type: 'docsCancel' }).catch(() => {});
  }
  function editorFocus() {
    const focused = document.activeElement;
    if (focused?.matches('iframe.docs-texteventtarget-iframe')) {
      try {
        const inner = focused.contentDocument?.activeElement;
        if (inner?.isContentEditable || inner?.matches('textarea')) return { target: inner, frame: focused };
      } catch { /* A cross-origin editor is not supported by this adapter. */ }
    }
    if (focused?.isContentEditable && focused.closest('.kix-appview-editor')) {
      return { target: focused, frame: null };
    }
    return null;
  }
  const check = () => !!target?.isConnected && state.phase === 'running' &&
    (frame ? document.activeElement === frame && frame.contentDocument?.activeElement === target
      : document.activeElement === target);
  function setLang(value) {
    const next = globalThis.__typerI18n?.normalize(value);
    if (!next || next === engineLang) return;
    engineLang = next;
  }
  function arm(settings = null) {
    if (settings?.lang) engineLang = globalThis.__typerI18n?.normalize(settings.lang) || engineLang;
    stop();
    control = new AbortController();
    const options = { capture: true, signal: control.signal };
    const keydown = (event) => {
      if (!event.isTrusted) return;
      const index = expectedKeys.indexOf(event.key);
      if (index >= 0) { expectedKeys.splice(index, 1); return; }
      if (event.key === 'Escape' || state.phase === 'running') cancel(T('docs.stop.key'));
    };
    const pointerdown = (event) => {
      if (event.isTrusted && state.phase === 'running') cancel(T('docs.stop.pointer'));
    };
    const select = (event) => {
      if (!event.isTrusted || state.phase !== 'selecting') return;
      if (!event.composedPath().some(node => node?.closest?.('.kix-appview-editor'))) {
        update({ message: T('docs.select.body') });
        return;
      }
      setTimeout(() => {
        if (state.phase !== 'selecting') return;
        const editor = editorFocus();
        if (!editor) {
          update({ message: T('docs.select.noCaret') });
          return;
        }
        ({ target, frame } = editor);
        clearTimeout(timer);
        if (frame) {
          frame.contentDocument.addEventListener('keydown', keydown, options);
          frame.contentDocument.addEventListener('pointerdown', pointerdown, options);
          frame.contentDocument.addEventListener('paste', () => cancel(T('docs.stop.paste')), options);
          frame.contentDocument.addEventListener('compositionstart', () => cancel(T('docs.stop.composition')), options);
        }
        update({ phase: 'ready', message: T('docs.ready') });
      }, 50);
    };
    document.addEventListener('keydown', keydown, options);
    document.addEventListener('pointerdown', pointerdown, options);
    document.addEventListener('click', select, options);
    timer = setTimeout(() => stop(T('docs.select.timeout')), 30000);
    return update({ phase: 'selecting', message: T('docs.select.armed'), completed: 0, total: 0 });
  }
  function prepare(total, totalMs) {
    if (state.phase !== 'ready' || !target?.isConnected) throw new Error(T('docs.error.reselect'));
    target.focus({ preventScroll: true });
    update({ phase: 'running', message: T('docs.running'), total, completed: 0,
      totalMs: Math.max(0, Number(totalMs) || 0), remainingMs: Math.max(0, Number(totalMs) || 0), exact: false });
    if (!check()) { stop(T('docs.focusLost')); throw new Error(state.message); }
    return { ...state };
  }
  function finish(phase, message, completed, total) {
    stop(message);
    return update({ phase, message, completed, total });
  }
  globalThis.__docsTyperTarget = {
    version: '1.1.0', arm, stop, prepare, check, finish, setLang,
    // 允许登记的键在下一次 keydown 时被忽略；未登记的按键仍会中断任务。
    expectKeys: (keys) => { expectedKeys.push(...keys); if (expectedKeys.length > 8) expectedKeys = expectedKeys.slice(-8); },
    expectKey: (key) => { expectedKeys.push(key); },
    progress: (completed, total, message, timing) => update({ completed, total,
      ...(timing || {}),
      message: message || T('docs.progress', { done: completed, total }) }),
    getState: () => ({ ...state })
  };
})();
