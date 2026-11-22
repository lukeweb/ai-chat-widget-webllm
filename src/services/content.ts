import { KNOWLEDGE_BASE, KNOWLEDGE_BASE_PL, type KnowledgeBase } from "@/config/knowledgeBase";
import { SYSTEM_PROMPT } from "@/config/systemPrompt";

// CONTRACT STUB: sub-agent A replaces the implementation but keeps these exports and signatures.

export interface Content {
  /** Prompt template; may contain the `{{contact}}` placeholder. */
  systemPrompt: string;
  /** Single authoritative contact string. */
  contact: string;
  knowledgeBase: { en: KnowledgeBase[]; pl?: KnowledgeBase[] };
}

export const DEFAULT_CONTENT: Content = {
  systemPrompt: SYSTEM_PROMPT,
  contact: "Phone: +1 555 0100. Email: hello@bluebird-bikes.example.",
  knowledgeBase: { en: KNOWLEDGE_BASE, pl: KNOWLEDGE_BASE_PL },
};

export const getContent = (): Content => DEFAULT_CONTENT;

/** Loads content from a JSON URL (or restores defaults when `src` is undefined). Never rejects. */
export const loadContent = async (src?: string): Promise<void> => {
  void src;
};

/** Resolves when the most recent `loadContent` has settled. */
export const contentReady = (): Promise<void> => Promise.resolve();
