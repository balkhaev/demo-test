import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const SOURCE_REVISION = /^[a-f0-9]{40}$/i.test(process.env.SOURCE_COMMIT ?? '')
  ? process.env.SOURCE_COMMIT : 'main';
export const SOURCE_FILES = Object.freeze({
  rules: 'domain/rules.js',
  delivery: 'domain/rules/delivery.js',
  onboarding: 'domain/rules/onboarding.js',
  offboarding: 'domain/rules/offboarding.js',
  data: 'domain/rules/data.js',
  priority: 'domain/rules/deadline.js',
  deadlines: 'domain/deadlines.js',
  expressions: 'domain/expressions.js',
  engine: 'domain/rule-engine.js',
  evidence: 'domain/evidence.js',
  service: 'domain/brief-service.js',
  validation: 'domain/validation.js',
  tests: 'test/engine.test.mjs',
  prompt: 'prompts/extract-facts.txt',
});

export async function readSource(key) {
  if (!Object.hasOwn(SOURCE_FILES, key)) throw new Error('Unknown source file');
  const path = SOURCE_FILES[key];
  return {
    path, language: path.endsWith('.txt') ? 'text' : 'javascript',
    content: await readFile(fileURLToPath(new URL(path, ROOT)), 'utf8'),
    githubUrl: `https://github.com/balkhaev/demo-test/blob/${SOURCE_REVISION}/${path}`,
    revision: SOURCE_REVISION,
  };
}

/** Derive anchors from the actual shipped file, never maintain line numbers by hand. */
export function ruleSource(source, id) {
  const lines = source.content.split('\n');
  const start = lines.findIndex(line => new RegExp(`^\\s*id: ["']${id.replaceAll('.', '\\.')}["'],?\\s*$`).test(line));
  if (start < 0) throw new Error('Rule missing from source: ' + id);
  const next = lines.findIndex((line, index) => index > start && /^\s*(?:}, \{|}\];)/.test(line));
  const end = next < 0 ? lines.length : next;
  return {
    path: source.path, line: start + 1, endLine: end,
    url: `${source.githubUrl}#L${start + 1}-L${end}`,
  };
}
