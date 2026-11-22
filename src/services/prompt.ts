import type { Content } from "@/services/content";

// CONTRACT STUB: sub-agent A replaces the implementation but keeps these exports and signatures.

export const buildSystemPrompt = (content: Content): string => content.systemPrompt;

export const buildUserMessage = (knowledge: string, question: string): string =>
  `Context:\n${knowledge}\nQuestion:\n${question}`;
