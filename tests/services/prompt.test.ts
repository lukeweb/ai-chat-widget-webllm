import { describe, expect, it } from "@jest/globals";
import type { Content } from "../../src/services/content";
import { buildSystemPrompt, buildUserMessage } from "../../src/services/prompt";
import { SYSTEM_PROMPT } from "../../src/config/systemPrompt";

const makeContent = (systemPrompt: string, contact: string): Content => ({
  systemPrompt,
  contact,
  knowledgeBase: { en: [] },
});

describe("buildSystemPrompt", () => {
  it("replaces every {{contact}} placeholder with the contact string", () => {
    const prompt = buildSystemPrompt(makeContent("A {{contact}} B {{contact}} C", "Tel 1"));

    expect(prompt).toBe("A Tel 1 B Tel 1 C");
  });

  it("inserts the contact verbatim even when it contains replacement patterns", () => {
    expect(buildSystemPrompt(makeContent("X {{contact}}", "$& $1 {{contact}}"))).toBe(
      "X $& $1 {{contact}}"
    );
  });

  it("returns a template without a placeholder unchanged", () => {
    expect(buildSystemPrompt(makeContent("No placeholder", "Tel 1"))).toBe("No placeholder");
  });

  it("builds the default prompt with the contact and no hard-coded refusal sentence", () => {
    const prompt = buildSystemPrompt(makeContent(SYSTEM_PROMPT, "Phone: 555"));

    expect(prompt).toContain("Phone: 555");
    expect(prompt).not.toContain("{{contact}}");
    expect(prompt).toContain('"KNOWLEDGE BASE"');
    expect(prompt).toContain("in the language of the user's question");
    expect(prompt).not.toContain("I don't have that information");
  });
});

describe("buildUserMessage", () => {
  it("labels the knowledge and the question", () => {
    expect(buildUserMessage("Hours\n9-5", "When open?")).toBe(
      "KNOWLEDGE BASE:\nHours\n9-5\n\nQUESTION:\nWhen open?"
    );
  });

  it("uses a placeholder when no knowledge was found", () => {
    expect(buildUserMessage("", "Hi")).toBe(
      "KNOWLEDGE BASE:\n(no relevant information found)\n\nQUESTION:\nHi"
    );
  });
});
