import { KNOWLEDGE_BASE, KNOWLEDGE_BASE_PL, type KnowledgeBase } from "@/config/knowledgeBase";
import { detectAll } from "tinyld";
import winkTokenizer from "wink-tokenizer";
import {
  normalizeText,
  POLISH_CANONICAL_TERMS,
  POLISH_STOP_WORDS,
  stemEnglish,
  ENGLISH_STOP_WORDS,
} from "@/services/retriever.helpers";

const tokenizer = new winkTokenizer();

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

// A single weak match (one content word or a fuzzy match) is not enough to pull in a document.
export const MIN_DOCUMENT_SCORE = 2;
// Documents scoring far below the best match are mostly noise for a small model's context.
export const MIN_RELATIVE_SCORE = 0.5;

const search = (content: string): string => {
  const lang = detectLanguage(content);
  const tokens = tokenize(content, lang);

  return scoreDocuments(indexDocuments(lang), tokens)
    .map(({ document }: SearchResult) => `${document.title}\n${document.content}`)
    .join(`\n\n`);
};

/**
 * Retrieves knowledge-base entries for a message. When the message alone matches nothing
 * (for example a follow-up such as "And how much is that?"), the previous user message is
 * added to the query.
 */
export const retrieve = async (content: string, previousContent?: string): Promise<string> => {
  const result = search(content);
  if (result || !previousContent) return result;

  return search(`${previousContent}\n${content}`);
};

export const scoreDocuments = (documents: IndexedDocument[], tokens: string[]): SearchResult[] => {
  const results: SearchResult[] = [];

  for (const document of documents) {
    results.push(scoreDocument(document, tokens));
  }

  const ranked = results
    .filter((result) => result.score >= MIN_DOCUMENT_SCORE)
    .sort((a, b: SearchResult) => b.score - a.score);
  const topScore = ranked[0]?.score ?? 0;

  return ranked.filter((result) => result.score >= topScore * MIN_RELATIVE_SCORE).slice(0, 3);
};

export const scoreDocument = (indexed: IndexedDocument, tokens: string[]): SearchResult => {
  let score = 0;
  const language = indexed.language ?? "en";

  for (const rawToken of new Set(tokens.map(normalizeText).filter(Boolean))) {
    const token = canonicalizeToken(rawToken, language);
    const titleMatch = indexed.titleTokens.has(token);
    const keywordMatch = indexed.keywordTokens.has(token);
    const contentMatch = indexed.contentTokens.has(token);

    if (titleMatch) score += 3;
    if (keywordMatch) score += 2;
    if (contentMatch) score += 1;

    if (!titleMatch && !keywordMatch && !contentMatch) {
      if (hasNearToken(indexed.rawTitleTokens, rawToken)) score += 1;
      if (hasNearToken(indexed.rawKeywordTokens, rawToken)) score += 0.75;
      if (hasNearToken(indexed.rawContentTokens, rawToken)) score += 0.5;
    }
  }

  return { document: indexed.document, score };
};

const indexDocuments = (lang: string): IndexedDocument[] => {
  const base = lang === "pl" ? KNOWLEDGE_BASE_PL : KNOWLEDGE_BASE;

  return base.map((document: KnowledgeBase) => ({
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
};

const MIN_DETECTION_ACCURACY = 0.2;
const SUPPORTED_LANGUAGES = ["en", "pl"];
const POLISH_DIACRITICS = /[ąćęłńóśźż]/i;

const languageFromPage = (): string => {
  const pageLanguage = typeof document === "undefined" ? "" : document.documentElement.lang;
  return pageLanguage.toLowerCase().startsWith("pl") ? "pl" : "en";
};

export const detectLanguage = (content: string): string => {
  if (!content.trim()) return "en";
  if (POLISH_DIACRITICS.test(content)) return "pl";

  // Restrict detection to the supported languages; very short queries are too ambiguous to trust.
  const [best] = detectAll(content, { only: SUPPORTED_LANGUAGES });
  if (!best || best.accuracy < MIN_DETECTION_ACCURACY) return languageFromPage();

  return best.lang;
};

const tokenize = (
  content: string,
  lang: string,
  removeStopWords = true,
  canonicalize = true
): string[] => {
  const stopWords = lang === "pl" ? POLISH_STOP_WORDS : ENGLISH_STOP_WORDS;

  const tokens = tokenizer
    .tokenize(normalizeText(content))
    .filter((token) => token.tag === "word")
    .map((token: winkTokenizer.Token) => normalizeText(token.value))
    .filter((token) => !removeStopWords || !stopWords.has(token));

  return canonicalize ? tokens.map((token) => canonicalizeToken(token, lang)) : tokens;
};

const canonicalizeToken = (token: string, lang: string): string =>
  lang === "pl" ? (POLISH_CANONICAL_TERMS.get(token) ?? token) : stemEnglish(token);

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
