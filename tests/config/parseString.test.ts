import { describe, it, expect } from "@jest/globals";
import { parseCustomElementName, parseNonEmptyString } from "../../src/config/parseString";
import { parsePositiveInteger } from "../../src/config/parsePositiveInteger";

describe("configuration fallbacks for a missing .env", () => {
  it("uses the fallback when a numeric setting is undefined", () => {
    expect(parsePositiveInteger("SETTING", undefined, 12)).toBe(12);
  });

  it("still rejects undefined without a fallback and invalid values with a fallback", () => {
    expect(() => parsePositiveInteger("SETTING", undefined)).toThrow("SETTING must be");
    expect(() => parsePositiveInteger("SETTING", "abc", 12)).toThrow("SETTING must be");
  });
});

describe("parseNonEmptyString", () => {
  it("uses the fallback when undefined and trims set values", () => {
    expect(parseNonEmptyString("MODEL", undefined, "default")).toBe("default");
    expect(parseNonEmptyString("MODEL", " custom ", "default")).toBe("custom");
  });

  it("rejects blank values", () => {
    expect(() => parseNonEmptyString("MODEL", "  ", "default")).toThrow("MODEL must not be empty");
  });
});

describe("parseCustomElementName", () => {
  it("accepts the fallback and valid names", () => {
    expect(parseCustomElementName("TAG", undefined, "ai-chat-widget")).toBe("ai-chat-widget");
    expect(parseCustomElementName("TAG", "my-chat", "ai-chat-widget")).toBe("my-chat");
  });

  it.each(["chat", "My-Chat", "1-chat", "-chat", "chat widget", "annotation-xml", "font-face"])("rejects %s", (value) => {
    expect(() => parseCustomElementName("TAG", value, "ai-chat-widget")).toThrow(
      "valid custom element name"
    );
  });
});
