import type { Content } from "@/services/content";

export const NO_KNOWLEDGE_PLACEHOLDER = "(no relevant information found)";

export const buildSystemPrompt = (content: Content): string =>
  content.systemPrompt.split("{{contact}}").join(content.contact);

export const buildUserMessage = (knowledge: string, question: string): string =>
  `KNOWLEDGE BASE:\n${knowledge || NO_KNOWLEDGE_PLACEHOLDER}\n\nQUESTION:\n${question}`;
