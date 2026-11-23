import { describe, expect, it } from "@jest/globals";
import {
  KNOWLEDGE_BASE,
  KNOWLEDGE_BASE_PL,
  type KnowledgeBase,
} from "../../src/config/knowledgeBase";

// Clock times legitimately differ between languages (9:00 AM vs 9:00 / 18:00).
const facts = (entry: KnowledgeBase): string[] =>
  (entry.content.replace(/\d{1,2}:\d{2}(?:\s?[AP]M)?/gi, "").match(/\d+/g) ?? []).sort();

describe.each([
  ["English", KNOWLEDGE_BASE],
  ["Polish", KNOWLEDGE_BASE_PL],
])("%s knowledge base", (_language, entries) => {
  it("has non-empty titles, content and keywords", () => {
    for (const entry of entries) {
      expect(entry.title.trim()).not.toBe("");
      expect(entry.content.trim()).not.toBe("");
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(entry.keywords.every((word) => word.trim() !== "")).toBe(true);
    }
  });

  it("has unique titles", () => {
    const titles = entries.map((entry) => entry.title);

    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("knowledge base language parity", () => {
  it("has the same number of entries in both languages", () => {
    expect(KNOWLEDGE_BASE_PL).toHaveLength(KNOWLEDGE_BASE.length);
  });

  it("keeps prices, durations, phone numbers and addresses identical in paired entries", () => {
    KNOWLEDGE_BASE.forEach((english, index) => {
      const polish = KNOWLEDGE_BASE_PL[index] as KnowledgeBase;

      expect({ title: polish.title, numbers: facts(polish) }).toEqual({
        title: polish.title,
        numbers: facts(english),
      });
    });
  });
});
