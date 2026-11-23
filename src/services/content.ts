import { KNOWLEDGE_BASE, KNOWLEDGE_BASE_PL, type KnowledgeBase } from "@/config/knowledgeBase";
import { SYSTEM_PROMPT } from "@/config/systemPrompt";

export interface Content {
  /** Prompt template; may contain the `{{contact}}` placeholder. */
  systemPrompt: string;
  /** Single authoritative contact string. */
  contact: string;
  knowledgeBase: { en: KnowledgeBase[]; pl?: KnowledgeBase[] };
}

export const MAX_CONTENT_SIZE = 256 * 1024;

export const DEFAULT_CONTENT: Content = {
  systemPrompt: SYSTEM_PROMPT,
  contact: "Phone: +1 555 0100. Email: hello@bluebird-bikes.example.",
  knowledgeBase: { en: KNOWLEDGE_BASE, pl: KNOWLEDGE_BASE_PL },
};

const CONTACT_KEYWORDS = {
  en: ["contact", "phone", "telephone", "number", "email", "mail", "reach", "call"],
  pl: ["kontakt", "telefon", "numer", "email", "e-mail", "adres mailowy"],
};

const contactEntry = (contact: string, lang: "en" | "pl"): KnowledgeBase => ({
  title: lang === "pl" ? "Kontakt" : "Contact",
  content: contact,
  keywords: CONTACT_KEYWORDS[lang],
});

// `contact` is the single source of contact details; the Contact entries are generated from it.
const withGeneratedContact = (content: Content): Content => ({
  ...content,
  knowledgeBase: {
    en: [...content.knowledgeBase.en, contactEntry(content.contact, "en")],
    ...(content.knowledgeBase.pl
      ? { pl: [...content.knowledgeBase.pl, contactEntry(content.contact, "pl")] }
      : {}),
  },
});

let activeContent: Content = withGeneratedContact(DEFAULT_CONTENT);
let requestCounter = 0;
let pending: Promise<void> = Promise.resolve();

/** Returns the active content, including the generated contact entry derived from `contact`. */
export const getContent = (): Content => activeContent;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseKnowledgeBase = (value: unknown, label: string): KnowledgeBase[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);

  return value.map((entry: unknown, index: number): KnowledgeBase => {
    const name = `${label}[${index}]`;
    if (!isRecord(entry)) throw new Error(`${name} must be an object`);
    const { title, content, keywords } = entry;
    if (!isNonEmptyString(title)) throw new Error(`${name}.title must be a non-empty string`);
    if (!isNonEmptyString(content)) throw new Error(`${name}.content must be a non-empty string`);
    if (!Array.isArray(keywords) || !keywords.every((word) => typeof word === "string")) {
      throw new Error(`${name}.keywords must be an array of strings`);
    }
    return { title, content, keywords: [...(keywords as string[])] };
  });
};

export const parseContent = (data: unknown): Content => {
  if (!isRecord(data)) throw new Error("content must be an object");
  const { systemPrompt, contact, knowledgeBase } = data;
  if (!isNonEmptyString(systemPrompt)) throw new Error("systemPrompt must be a non-empty string");
  if (!isNonEmptyString(contact)) throw new Error("contact must be a non-empty string");
  if (!isRecord(knowledgeBase)) throw new Error("knowledgeBase must be an object");

  const en = parseKnowledgeBase(knowledgeBase.en, "knowledgeBase.en");
  if (en.length === 0) throw new Error("knowledgeBase.en must not be empty");
  const pl =
    knowledgeBase.pl === undefined
      ? undefined
      : parseKnowledgeBase(knowledgeBase.pl, "knowledgeBase.pl");

  return { systemPrompt, contact, knowledgeBase: pl ? { en, pl } : { en } };
};

const fetchContent = async (src: string): Promise<Content> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CONTENT_SIZE) {
    throw new Error(`content is larger than ${MAX_CONTENT_SIZE} characters`);
  }
  return parseContent(JSON.parse(text));
};

/** Loads content from a JSON URL (or restores defaults when `src` is undefined). Never rejects. */
export const loadContent = (src?: string): Promise<void> => {
  const request = ++requestCounter;

  if (src === undefined) {
    activeContent = withGeneratedContact(DEFAULT_CONTENT);
    pending = Promise.resolve();
    return pending;
  }

  const run = (async (): Promise<void> => {
    let loaded = DEFAULT_CONTENT;
    try {
      loaded = await fetchContent(src);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load content from "${src}", using built-in defaults: ${reason}`);
    }
    if (request === requestCounter) activeContent = withGeneratedContact(loaded);
  })();
  pending = run;
  return run;
};

/** Resolves when the most recent `loadContent` has settled. */
export const contentReady = (): Promise<void> => pending;
