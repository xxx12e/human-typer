(() => {
  if (globalThis.HumanTextSanitizer) return;
  const allowed = /[\p{Letter}\p{Number}\p{Punctuation}]/u;
  const invisible = /[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Surrogate}\p{Private_Use}]/u;
  function sanitize(value) {
    const source = String(value).replace(/\r\n?/gu, '\n').normalize('NFC');
    let text = '';
    let removed = 0;
    let replacedSpaces = 0;
    for (const char of source) {
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
      if (allowed.test(char)) text += char;
      else removed += 1;
    }
    return { text, removed, replacedSpaces };
  }
  globalThis.HumanTextSanitizer = { sanitize };
})();
