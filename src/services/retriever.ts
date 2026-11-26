import type { KnowledgeBase } from "@/config/knowledgeBase";
import { getContent, type Content } from "@/services/content";
import { detectAll } from "tinyld";
import winkTokenizer from "wink-tokenizer";
import {
  normalizeText,
  canonicalizeEnglish,
  GENERIC_TOKENS,
  POLISH_LANGUAGE_MARKERS,
  POLISH_STOP_WORDS,
  POLISH_TERM_FORMS,
  stemPolish,
  ENGLISH_STOP_WORDS,
} from "@/services/retriever.helpers";

const tokenizer = new winkTokenizer();

type KnowledgeBases = Content["knowledgeBase"];

interface IndexedDocument {
  document: KnowledgeBase;
  language?: string;
  titleTokens: Set<string>;
  keywordTokens: Set<string>;
  contentTokens: Set<string>;
  rawTitleTokens?: Set<string>;
  rawKeywordTokens?: Set<string>;
  rawContentTokens?: Set<string>;
}

export interface SearchResult {
  document: KnowledgeBase;
  score: number;
}

export interface ScoringOptions {
  /** Raw query tokens that come from the previous message and count for less. */
  discounted?: ReadonlySet<string>;
}

// A single weak match (one content word or a fuzzy match) is not enough to pull in a document.
export const MIN_DOCUMENT_SCORE = 2;
// Documents scoring far below the best match are mostly noise for a small model's context.
export const MIN_RELATIVE_SCORE = 0.7;
// A message with at most this many informative words is treated as a follow-up question.
export const FOLLOW_UP_MAX_TOKENS = 2;
// Matches that come only from the previous message count for this fraction.
const PREVIOUS_MESSAGE_WEIGHT = 0.5;
// A word found in every document keeps this fraction of its weight; a word found in one keeps all of it.
const MIN_FREQUENCY_WEIGHT = 0.25;
// One language must score this many times higher than the other to be chosen by content alone.
const LANGUAGE_SCORE_MARGIN = 1.5;
// Upper bound for the retrieved text, so the prompt keeps room for history and the reply.
export const MAX_CONTEXT_CHARS = 2400;
const MAX_DOCUMENTS = 3;

export interface RetrievalOptions {
  /** Most entries to return. */
  maxDocuments?: number;
  /**
   * A second entry is kept only if it scores at least this fraction of the best one, so a small
   * model gets a single entry whenever one match clearly wins.
   */
  minSecondScoreRatio?: number;
}

export interface RetrievedEntries {
  /** Knowledge-base language the entries come from ("pl" or "en"). */
  language: string;
  results: SearchResult[];
}

const tokenIsGeneric = (token: string, lang: string): boolean =>
  GENERIC_TOKENS.has(token) || GENERIC_TOKENS.has(canonicalizeToken(token, lang));

const truncateAtSentence = (text: string, limit: number): string => {
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));

  return sentenceEnd > limit / 2 ? cut.slice(0, sentenceEnd + 1) : `${cut.trimEnd()}…`;
};

export const formatContext = (results: SearchResult[], maxChars = MAX_CONTEXT_CHARS): string => {
  const parts: string[] = [];
  let used = 0;

  for (const { document } of results) {
    const entry = `${document.title}\n${document.content}`;
    const length = entry.length + (parts.length > 0 ? 2 : 0);

    if (used + length > maxChars) {
      if (parts.length === 0) parts.push(truncateAtSentence(entry, maxChars));
      break;
    }

    parts.push(entry);
    used += length;
  }

  return parts.join("\n\n");
};

const rank = (
  base: KnowledgeBase[],
  lang: string,
  tokens: string[],
  options?: ScoringOptions
): SearchResult[] => scoreDocuments(indexDocuments(base, lang), tokens, options);

const baseFor = (knowledgeBase: KnowledgeBases, lang: string): KnowledgeBase[] =>
  (lang === "pl" ? knowledgeBase.pl : undefined) ?? knowledgeBase.en;

/**
 * Finds knowledge-base entries for a message. For a follow-up with little content of its own
 * (for example "And for kids?" or "How much is that?"), the previous user message is added to
 * the query at a reduced weight.
 */
export const retrieveEntries = (
  content: string,
  previousContent?: string,
  knowledgeBase: KnowledgeBases = getContent().knowledgeBase,
  options: RetrievalOptions = {}
): RetrievedEntries => {
  const lang = resolveLanguage(content, knowledgeBase, previousContent);
  const base = baseFor(knowledgeBase, lang);
  // Raw tokens: scoreDocument canonicalizes them itself and needs the raw form for fuzzy matching.
  const tokens = tokenize(content, lang, true, false);
  let results = rank(base, lang, tokens);

  const isFollowUp =
    new Set(tokens.map((token) => canonicalizeToken(token, lang))).size <= FOLLOW_UP_MAX_TOKENS;
  if (previousContent && (results.length === 0 || isFollowUp)) {
    const own = new Set(tokens);
    const previous = tokenize(previousContent, lang, true, false).filter((token) => !own.has(token));
    const index = indexDocuments(base, lang);
    // The previous message only disambiguates: entries that match nothing in the new message
    // are not pulled in by it (unless the new message matches nothing at all).
    const ownMatches = new Set(
      index.filter((document) => scoreDocument(document, tokens).score > 0).map((d) => d.document)
    );
    const combined = scoreDocuments(index, [...tokens, ...previous], {
      discounted: new Set(previous),
    }).filter(({ document }) => ownMatches.size === 0 || ownMatches.has(document));
    if (combined.length > 0) results = combined;
  }

  return { language: lang, results: limitResults(results, options) };
};

const limitResults = (results: SearchResult[], options: RetrievalOptions): SearchResult[] => {
  const limited = results.slice(0, options.maxDocuments ?? MAX_DOCUMENTS);
  const ratio = options.minSecondScoreRatio;
  const top = limited[0];
  if (ratio === undefined || !top) return limited;
  return [top, ...limited.slice(1).filter((result) => result.score >= top.score * ratio)];
};

/** Retrieves knowledge-base entries for a message and formats them as prompt context. */
export const retrieve = async (
  content: string,
  previousContent?: string,
  knowledgeBase: KnowledgeBases = getContent().knowledgeBase
): Promise<string> => formatContext(retrieveEntries(content, previousContent, knowledgeBase).results);

const documentFrequency = (documents: IndexedDocument[], token: string): number =>
  documents.filter(
    ({ titleTokens, keywordTokens, contentTokens }) =>
      titleTokens.has(token) || keywordTokens.has(token) || contentTokens.has(token)
  ).length;

export const scoreDocuments = (
  documents: IndexedDocument[],
  tokens: string[],
  options: ScoringOptions = {}
): SearchResult[] => {
  const language = documents[0]?.language ?? "en";
  const discounted = new Set(
    [...(options.discounted ?? [])].map((token) => canonicalizeToken(normalizeText(token), language))
  );
  const current = new Set(
    tokens
      .filter((token) => !options.discounted?.has(token))
      .map((token) => canonicalizeToken(normalizeText(token), language))
  );

  // Words found in many documents say little about which one is relevant, so they count less.
  const weights = new Map<string, number>();
  const weightOf = (token: string): number => {
    let weight = weights.get(token);
    if (weight === undefined) {
      const frequency = documentFrequency(documents, token);
      const spread = documents.length > 1 ? Math.max(0, frequency - 1) / (documents.length - 1) : 0;
      weight = 1 - (1 - MIN_FREQUENCY_WEIGHT) * spread;
      if (discounted.has(token) && !current.has(token)) weight *= PREVIOUS_MESSAGE_WEIGHT;
      weights.set(token, weight);
    }
    return weight;
  };

  const ranked = documents
    .filter((document) => scoreDocument(document, tokens).score >= MIN_DOCUMENT_SCORE)
    .map((document) => scoreDocument(document, tokens, weightOf))
    .sort((a, b: SearchResult) => b.score - a.score);
  const topScore = ranked[0]?.score ?? 0;

  return ranked
    .filter((result) => result.score >= topScore * MIN_RELATIVE_SCORE)
    .slice(0, MAX_DOCUMENTS);
};

export const scoreDocument = (
  indexed: IndexedDocument,
  tokens: string[],
  weightOf: (token: string) => number = () => 1
): SearchResult => {
  let score = 0;
  const language = indexed.language ?? "en";

  const queryTokens = tokens
    .map(normalizeText)
    .filter((token) => token && !tokenIsGeneric(token, language));

  for (const rawToken of new Set(queryTokens)) {
    const token = canonicalizeToken(rawToken, language);
    const titleMatch = indexed.titleTokens.has(token);
    const keywordMatch = indexed.keywordTokens.has(token);
    const contentMatch = indexed.contentTokens.has(token);
    const weight = weightOf(token);

    if (titleMatch) score += 3 * weight;
    if (keywordMatch) score += 2 * weight;
    // Numbers and times (prices, hours, ages) are specific enough to count like a keyword.
    if (contentMatch) score += (/\d/.test(token) ? 2 : 1) * weight;

    if (!titleMatch && !keywordMatch && !contentMatch) {
      if (hasNearToken(indexed.rawTitleTokens, rawToken)) score += 1;
      if (hasNearToken(indexed.rawKeywordTokens, rawToken)) score += 0.75;
      if (hasNearToken(indexed.rawContentTokens, rawToken)) score += 0.5;
    }
  }

  return { document: indexed.document, score };
};

// Indexes are rebuilt only when the knowledge base array or the language changes.
const indexCache = new WeakMap<KnowledgeBase[], Map<string, IndexedDocument[]>>();

const indexDocuments = (base: KnowledgeBase[], lang: string): IndexedDocument[] => {
  const cached = indexCache.get(base)?.get(lang);
  if (cached) return cached;

  const indexed = base.map((document: KnowledgeBase) => ({
    document,
    language: lang,
    titleTokens: new Set(tokenize(document.title, lang)),
    contentTokens: new Set(tokenize(document.content, lang)),
    keywordTokens: new Set(document.keywords.flatMap((word: string) => tokenize(word, lang))),
    rawTitleTokens: new Set(tokenize(document.title, lang, false, false)),
    rawContentTokens: new Set(tokenize(document.content, lang, false, false)),
    rawKeywordTokens: new Set(
      document.keywords.flatMap((word: string) => tokenize(word, lang, false, false))
    ),
  }));

  const perLanguage = indexCache.get(base) ?? new Map<string, IndexedDocument[]>();
  perLanguage.set(lang, indexed);
  indexCache.set(base, perLanguage);

  return indexed;
};

const MIN_DETECTION_ACCURACY = 0.2;
const SUPPORTED_LANGUAGES = ["en", "pl"];
const POLISH_DIACRITICS = /[ąćęłńóśźż]/i;

const languageFromPage = (): string => {
  const pageLanguage = typeof document === "undefined" ? "" : document.documentElement.lang;
  return pageLanguage.toLowerCase().startsWith("pl") ? "pl" : "en";
};

const hasPolishWords = (content: string): boolean =>
  tokenizer
    .tokenize(normalizeText(content))
    .some(
      (token: winkTokenizer.Token) =>
        token.tag === "word" &&
        (POLISH_LANGUAGE_MARKERS.has(token.value) || POLISH_TERM_FORMS.has(token.value))
    );

export const detectLanguage = (content: string): string => {
  if (!content.trim()) return "en";
  if (POLISH_DIACRITICS.test(content)) return "pl";
  if (hasPolishWords(content)) return "pl";

  // Restrict detection to the supported languages; very short queries are too ambiguous to trust.
  const [best] = detectAll(content, { only: SUPPORTED_LANGUAGES });
  if (!best || best.accuracy < MIN_DETECTION_ACCURACY) return languageFromPage();

  return best.lang;
};

const topScore = (content: string, knowledgeBase: KnowledgeBases, lang: string): number => {
  const base = baseFor(knowledgeBase, lang);
  return rank(base, lang, tokenize(content, lang, true, false))[0]?.score ?? 0;
};

/**
 * Picks the knowledge-base language for a message. Clear Polish signals win; otherwise the
 * language whose entries match the message vocabulary clearly better wins, so short Polish
 * questions without diacritics still reach the Polish entries. Only then does text-based
 * language detection decide.
 */
const resolveLanguage = (
  content: string,
  knowledgeBase: KnowledgeBases,
  previousContent?: string
): string => {
  if (!knowledgeBase.pl) return "en";
  if (POLISH_DIACRITICS.test(content) || hasPolishWords(content)) return "pl";

  const english = topScore(content, knowledgeBase, "en");
  const polish = topScore(content, knowledgeBase, "pl");
  if (polish >= MIN_DOCUMENT_SCORE && polish >= english * LANGUAGE_SCORE_MARGIN) return "pl";
  if (english >= MIN_DOCUMENT_SCORE && english >= polish * LANGUAGE_SCORE_MARGIN) return "en";

  return detectLanguage(previousContent ? `${previousContent}\n${content}` : content);
};

const TOKEN_TAGS = new Set(["word", "number", "time"]);

const tokenize = (
  content: string,
  lang: string,
  removeStopWords = true,
  canonicalize = true
): string[] => {
  const stopWords = lang === "pl" ? POLISH_STOP_WORDS : ENGLISH_STOP_WORDS;

  const tokens = tokenizer
    .tokenize(normalizeText(content))
    .filter((token) => TOKEN_TAGS.has(token.tag))
    .map((token: winkTokenizer.Token) => normalizeText(token.value))
    .filter((token) => !removeStopWords || !stopWords.has(token))
    .filter((token) => !tokenIsGeneric(token, lang));

  return canonicalize ? tokens.map((token) => canonicalizeToken(token, lang)) : tokens;
};

const canonicalizeToken = (token: string, lang: string): string =>
  lang === "pl" ? stemPolish(token) : canonicalizeEnglish(token);

const hasNearToken = (candidates: Set<string> | undefined, query: string): boolean => {
  if (!candidates || query.length < 6) return false;

  for (const candidate of candidates) {
    if (candidate.length >= 6 && levenshteinWithinOne(query, candidate)) {
      return true;
    }
  }

  return false;
};

const levenshteinWithinOne = (left: string, right: string): boolean => {
  if (Math.abs(left.length - right.length) > 1 || left === right) return false;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex++;
      rightIndex++;
      continue;
    }

    if (++edits > 1) return false;

    if (left.length > right.length) leftIndex++;
    else if (right.length > left.length) rightIndex++;
    else {
      leftIndex++;
      rightIndex++;
    }
  }

  if (leftIndex < left.length || rightIndex < right.length) edits++;
  return edits === 1;
};
