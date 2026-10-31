import { KNOWLEDGE_BASE, KNOWLEDGE_BASE_PL, type KnowledgeBase } from "@/config/knowledgeBase";
import { detect } from "tinyld";
import winkTokenizer from "wink-tokenizer";
import {
  normalizeText,
  POLISH_CANONICAL_TERMS,
  POLISH_STOP_WORDS,
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

export const retrieve = async (content: string): Promise<string> => {
  const lang = detectLanguage(content);
  const indexedDocuments = indexDocuments(lang);

  const tokens = tokenize(content, lang);

  return scoreDocuments(indexedDocuments, tokens)
    .map(({ document }: SearchResult) => `${document.title}\n${document.content}`)
    .join(`\n\n`);
};

export const scoreDocuments = (documents: IndexedDocument[], tokens: string[]): SearchResult[] => {
  const results: SearchResult[] = [];

  for (const document of documents) {
    results.push(scoreDocument(document, tokens));
  }

  return results
    .filter((result) => result.score > 0)
    .sort((a, b: SearchResult) => b.score - a.score)
    .slice(0, 3);
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

const detectLanguage = (content: string): string => {
  if (!content.trim()) return "en";

  return detect(content);
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
  lang === "pl" ? (POLISH_CANONICAL_TERMS.get(token) ?? token) : token;

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
