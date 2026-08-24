/**
 * Rule-based clarity & grammar correction engine for audit statements.
 *
 * This runs entirely client-side (no external AI/API call, no data leaves
 * the browser). It performs deterministic, mechanical corrections that are
 * safe to apply automatically, and separately flags stylistic issues
 * (passive voice, hedging language, run-on sentences, vague quantifiers)
 * that need a human auditor's judgment because fixing them could change
 * the meaning or certainty of a finding.
 */

export interface ClarityChange {
  before: string;
  after: string;
  label: string;
}

export type ClaritySuggestionType =
  | 'passive-voice'
  | 'run-on-sentence'
  | 'vague-quantifier'
  | 'hedging-language'
  | 'informal-tone';

export interface ClaritySuggestion {
  type: ClaritySuggestionType;
  message: string;
  excerpt: string;
}

export interface ClarityResult {
  correctedText: string;
  changes: ClarityChange[];
  suggestions: ClaritySuggestion[];
}

interface ReplacementRule {
  pattern: RegExp;
  replacement: string;
  label: string;
}

// Wordy / redundant audit-writing phrases -> concise equivalents.
// Mechanical, meaning-preserving substitutions only.
const wordyPhraseRules: ReplacementRule[] = [
  { pattern: /\bdue to the fact that\b/gi, replacement: 'because', label: 'Wordy phrase' },
  { pattern: /\bin spite of the fact that\b/gi, replacement: 'although', label: 'Wordy phrase' },
  { pattern: /\bin the event that\b/gi, replacement: 'if', label: 'Wordy phrase' },
  { pattern: /\bin order to\b/gi, replacement: 'to', label: 'Wordy phrase' },
  { pattern: /\bin order for\b/gi, replacement: 'for', label: 'Wordy phrase' },
  { pattern: /\bat this point in time\b/gi, replacement: 'currently', label: 'Wordy phrase' },
  { pattern: /\bin the near future\b/gi, replacement: 'soon', label: 'Wordy phrase' },
  { pattern: /\bon a regular basis\b/gi, replacement: 'regularly', label: 'Wordy phrase' },
  { pattern: /\bin a timely manner\b/gi, replacement: 'promptly', label: 'Wordy phrase' },
  { pattern: /\bfor the purpose of\b/gi, replacement: 'to', label: 'Wordy phrase' },
  { pattern: /\bwith regard to\b/gi, replacement: 'regarding', label: 'Wordy phrase' },
  { pattern: /\bwith regards to\b/gi, replacement: 'regarding', label: 'Wordy phrase' },
  { pattern: /\bprior to\b/gi, replacement: 'before', label: 'Wordy phrase' },
  { pattern: /\bsubsequent to\b/gi, replacement: 'after', label: 'Wordy phrase' },
  { pattern: /\bas per\b/gi, replacement: 'per', label: 'Wordy phrase' },
  { pattern: /\ba large number of\b/gi, replacement: 'many', label: 'Wordy phrase' },
  { pattern: /\bthe majority of\b/gi, replacement: 'most', label: 'Wordy phrase' },
  { pattern: /\bplease be advised that\b\s*/gi, replacement: '', label: 'Removed filler opener' },
  { pattern: /\bit should be noted that\b\s*/gi, replacement: '', label: 'Removed filler opener' },
  { pattern: /\bit is important to note that\b\s*/gi, replacement: '', label: 'Removed filler opener' },
  { pattern: /\beach and every\b/gi, replacement: 'every', label: 'Redundant phrase' },
  { pattern: /\bclose proximity\b/gi, replacement: 'proximity', label: 'Redundant phrase' },
  { pattern: /\bend result\b/gi, replacement: 'result', label: 'Redundant phrase' },
  { pattern: /\bpast history\b/gi, replacement: 'history', label: 'Redundant phrase' },
  { pattern: /\bfinal outcome\b/gi, replacement: 'outcome', label: 'Redundant phrase' },
  { pattern: /\bfuture plans\b/gi, replacement: 'plans', label: 'Redundant phrase' },
  { pattern: /\bvery unique\b/gi, replacement: 'unique', label: 'Redundant phrase' },
  { pattern: /\bcompletely eliminate\b/gi, replacement: 'eliminate', label: 'Redundant phrase' },
];

// utilize/utilizes/utilized/utilizing need per-form handling
const utilizeRule: ReplacementRule[] = [
  { pattern: /\butilizing\b/gi, replacement: 'using', label: 'Simplified word' },
  { pattern: /\butilized\b/gi, replacement: 'used', label: 'Simplified word' },
  { pattern: /\butilizes\b/gi, replacement: 'uses', label: 'Simplified word' },
  { pattern: /\butilize\b/gi, replacement: 'use', label: 'Simplified word' },
];

const contractionRules: ReplacementRule[] = [
  { pattern: /\bdon't\b/gi, replacement: 'do not', label: 'Expanded contraction' },
  { pattern: /\bdoesn't\b/gi, replacement: 'does not', label: 'Expanded contraction' },
  { pattern: /\bdidn't\b/gi, replacement: 'did not', label: 'Expanded contraction' },
  { pattern: /\bcan't\b/gi, replacement: 'cannot', label: 'Expanded contraction' },
  { pattern: /\bwon't\b/gi, replacement: 'will not', label: 'Expanded contraction' },
  { pattern: /\bwasn't\b/gi, replacement: 'was not', label: 'Expanded contraction' },
  { pattern: /\bweren't\b/gi, replacement: 'were not', label: 'Expanded contraction' },
  { pattern: /\bhasn't\b/gi, replacement: 'has not', label: 'Expanded contraction' },
  { pattern: /\bhaven't\b/gi, replacement: 'have not', label: 'Expanded contraction' },
  { pattern: /\bhadn't\b/gi, replacement: 'had not', label: 'Expanded contraction' },
  { pattern: /\bisn't\b/gi, replacement: 'is not', label: 'Expanded contraction' },
  { pattern: /\baren't\b/gi, replacement: 'are not', label: 'Expanded contraction' },
  { pattern: /\bshouldn't\b/gi, replacement: 'should not', label: 'Expanded contraction' },
  { pattern: /\bwouldn't\b/gi, replacement: 'would not', label: 'Expanded contraction' },
  { pattern: /\bcouldn't\b/gi, replacement: 'could not', label: 'Expanded contraction' },
  { pattern: /\bit's\b/gi, replacement: 'it is', label: 'Expanded contraction' },
  { pattern: /\bthey're\b/gi, replacement: 'they are', label: 'Expanded contraction' },
  { pattern: /\bwe're\b/gi, replacement: 'we are', label: 'Expanded contraction' },
  { pattern: /\bthere's\b/gi, replacement: 'there is', label: 'Expanded contraction' },
];

// Acronyms/brand terms that are unambiguous enough to safely case-normalize.
const acronymFixes: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\b2\s?go\b/gi, replacement: '2GO' },
  { pattern: /\bboc\b/gi, replacement: 'BOC' },
  { pattern: /\bppa\b/gi, replacement: 'PPA' },
  { pattern: /\bpcg\b/gi, replacement: 'PCG' },
  { pattern: /\bdti\b/gi, replacement: 'DTI' },
  { pattern: /\bdole\b/gi, replacement: 'DOLE' },
  { pattern: /\bdmw\b/gi, replacement: 'DMW' },
  { pattern: /\bdotr\b/gi, replacement: 'DOTr' },
  { pattern: /\bltfrb\b/gi, replacement: 'LTFRB' },
  { pattern: /\blto\b/gi, replacement: 'LTO' },
  { pattern: /\bdenr\b/gi, replacement: 'DENR' },
  { pattern: /\bcmta\b/gi, replacement: 'CMTA' },
  { pattern: /\bstcw\b/gi, replacement: 'STCW' },
];

const vagueQuantifiers = [
  'some', 'several', 'many', 'a lot of', 'lots of', 'a few', 'a number of', 'various',
];

const hedgingWords = [
  'seems to', 'appears to', 'might have', 'may have', 'could possibly', 'sort of', 'kind of',
  'basically', 'possibly',
];

const informalWords = ['stuff', 'things', 'guys', 'etc.', 'a lot', 'okay', 'ok'];

function collectMatches(text: string, terms: string[]): string[] {
  const found: string[] = [];
  for (const term of terms) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) found.push(term);
  }
  return found;
}

function applyRules(text: string, rules: ReplacementRule[], changes: ClarityChange[]): string {
  let result = text;
  for (const rule of rules) {
    result = result.replace(rule.pattern, (...args) => {
      const match = args[0] as string;
      const replaced =
        typeof rule.replacement === 'string' ? rule.replacement : match;
      if (match.trim().toLowerCase() !== replaced.trim().toLowerCase()) {
        changes.push({ before: match.trim() || '(filler phrase)', after: replaced.trim() || '(removed)', label: rule.label });
      }
      return replaced;
    });
  }
  return result;
}

function fixPunctuationSpacing(text: string): string {
  return text
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s"'”)\]])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function capitalizeSentences(text: string): string {
  return text.replace(/(^\s*|[.!?]\s+)([a-z])/g, (_m, sep, letter) => sep + letter.toUpperCase())
    .replace(/\bi\b/g, 'I');
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

const passiveVoicePattern =
  /\b(is|are|was|were|be|been|being)\s+(\w+ed|written|done|found|given|taken|made|sent|shown|known|seen|noted|approved|reviewed|conducted|performed|held|kept|broken|chosen|driven)\b/i;

export function applyClarityCorrections(draft: string): ClarityResult {
  const changes: ClarityChange[] = [];
  let text = draft.replace(/\r\n/g, '\n');

  text = fixPunctuationSpacing(text);
  text = applyRules(text, contractionRules, changes);
  text = applyRules(text, wordyPhraseRules, changes);
  text = applyRules(text, utilizeRule, changes);

  for (const { pattern, replacement } of acronymFixes) {
    const before = text;
    text = text.replace(pattern, replacement);
    if (before !== text) {
      changes.push({ before: replacement.toLowerCase(), after: replacement, label: 'Standardized acronym' });
    }
  }

  text = fixPunctuationSpacing(text);
  text = capitalizeSentences(text);

  const suggestions: ClaritySuggestion[] = [];
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;

    if (wordCount > 40) {
      suggestions.push({
        type: 'run-on-sentence',
        message: `Sentence is ${wordCount} words long. Consider splitting it for clarity.`,
        excerpt: sentence.slice(0, 120) + (sentence.length > 120 ? '…' : ''),
      });
    }

    if (passiveVoicePattern.test(sentence)) {
      suggestions.push({
        type: 'passive-voice',
        message: 'Possible passive voice. Consider naming who performed the action (e.g., "The auditor reviewed…" instead of "It was reviewed…").',
        excerpt: sentence.slice(0, 120) + (sentence.length > 120 ? '…' : ''),
      });
    }

    const vague = collectMatches(sentence, vagueQuantifiers);
    if (vague.length) {
      suggestions.push({
        type: 'vague-quantifier',
        message: `Vague quantifier ("${vague.join('", "')}"). Replace with a specific count, percentage, or date where available.`,
        excerpt: sentence.slice(0, 120) + (sentence.length > 120 ? '…' : ''),
      });
    }

    const hedges = collectMatches(sentence, hedgingWords);
    if (hedges.length) {
      suggestions.push({
        type: 'hedging-language',
        message: `Hedging language ("${hedges.join('", "')}") weakens an audit finding's certainty. Confirm the fact and state it directly, or explicitly label it as a preliminary observation.`,
        excerpt: sentence.slice(0, 120) + (sentence.length > 120 ? '…' : ''),
      });
    }

    const informal = collectMatches(sentence, informalWords);
    if (informal.length) {
      suggestions.push({
        type: 'informal-tone',
        message: `Informal word ("${informal.join('", "')}") is not suited to formal audit documentation. Use precise terminology instead.`,
        excerpt: sentence.slice(0, 120) + (sentence.length > 120 ? '…' : ''),
      });
    }
  }

  return { correctedText: text, changes, suggestions };
}
