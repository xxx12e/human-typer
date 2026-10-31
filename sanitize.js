(() => {
  if (globalThis.HumanTextSanitizer) return;
  // 看到什么就输入什么：去掉看不见的字符水印（零宽字符、BOM、方向控制符、标签字符、变体选择符等），
  // 把混在拉丁单词里的同形字母（西里尔/希腊字母冒充 a、e、o 等）和全角字母数字还原成普通字符。
  // 保留字母、数字、标点、键盘上的 ASCII 符号与货币符号；表情和其他符号会被删除。
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
  function sanitize(value) {
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
  }
  globalThis.HumanTextSanitizer = { sanitize };
})();
