const escape = value => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const JS_KEYWORDS = new Set(('import from export const let var function return if else for of in while switch case break default throw new typeof instanceof async await try catch finally class extends true false null undefined').split(' '));
const PSEUDO_KEYWORDS = new Set(['ЕСЛИ', 'ИНАЧЕ', 'РЕШЕНИЕ', 'ДЕЙСТВИЕ', 'ПРОВЕРИТЬ']);

/** Presentation-only lexer. Every source character is escaped; code is never executed. */
export function highlight(code, language = 'javascript') {
  if (language === 'text') return escape(code);
  const keywords = language === 'pseudo' ? PSEUDO_KEYWORDS : JS_KEYWORDS;
  const tokens = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\b\d+(?:\.\d+)?\b|[\p{L}_$][\p{L}\p{N}_$]*|[{}()[\],;:=<>!&|?+*/-]+/gu;
  let result = '';
  let previous = 0;
  for (const match of code.matchAll(tokens)) {
    result += escape(code.slice(previous, match.index));
    const value = match[0];
    const kind = value.startsWith('//') || value.startsWith('/*') ? 'comment'
      : /^["'`]/.test(value) ? 'string'
      : /^\d/.test(value) ? 'number'
      : keywords.has(language === 'pseudo' ? value.toUpperCase() : value) ? 'keyword'
      : /^[A-ZА-ЯЁ][A-ZА-ЯЁ_]+$/u.test(value) ? 'constant'
      : /^\s*\(/.test(code.slice(match.index + value.length)) ? 'function'
      : /^[{}()[\],;:=<>!&|?+*/-]+$/.test(value) ? 'operator'
      : null;
    // Keep each line's markup balanced for numbered, multiline source rendering.
    result += kind
      ? value.split('\n').map(line => `<span class="syntax-${kind}">${escape(line)}</span>`).join('\n')
      : escape(value);
    previous = match.index + value.length;
  }
  return result + escape(code.slice(previous));
}
