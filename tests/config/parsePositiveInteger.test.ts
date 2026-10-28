import { parsePositiveInteger } from "../../src/config/parsePositiveInteger";
import { describe, it, expect } from "@jest/globals";

describe("parsePositiveInteger", () => {
  it.each(["1", "12", "800"])("parses %s", (value) => {
    expect(parsePositiveInteger("SETTING", value)).toBe(Number(value));
  });

  it.each(["0", "-1", "1.5", "abc", "9007199254740992", ""])("rejects %s", (value) => {
    expect(() => parsePositiveInteger("SETTING", value)).toThrow(
      `SETTING must be a positive integer; received: ${value}`
    );
  });
});
