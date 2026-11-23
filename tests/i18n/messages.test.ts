import { describe, expect, it } from "@jest/globals";
import {
  createTranslator,
  dictionaries,
  resolveLocale,
  type MessageKey,
} from "../../src/i18n/messages";

describe("resolveLocale", () => {
  it("prefers the element lang over the html lang and navigator language", () => {
    expect(
      resolveLocale({ elementLang: "pl", htmlLang: "en", navigatorLanguage: "en-US" })
    ).toBe("pl");
    expect(
      resolveLocale({ elementLang: "en", htmlLang: "pl", navigatorLanguage: "pl-PL" })
    ).toBe("en");
  });

  it("falls back to the html lang when the element lang is missing or empty", () => {
    expect(resolveLocale({ elementLang: "", htmlLang: "pl-PL", navigatorLanguage: "en" })).toBe(
      "pl"
    );
    expect(resolveLocale({ htmlLang: "pl", navigatorLanguage: "en" })).toBe("pl");
  });

  it("falls back to the navigator language when the others are empty", () => {
    expect(resolveLocale({ elementLang: " ", htmlLang: "", navigatorLanguage: "pl-PL" })).toBe(
      "pl"
    );
  });

  it("matches Polish case-insensitively and with region subtags", () => {
    expect(resolveLocale({ elementLang: "PL" })).toBe("pl");
    expect(resolveLocale({ elementLang: "pl-PL" })).toBe("pl");
  });

  it("maps every other language to English", () => {
    expect(resolveLocale({ elementLang: "de" })).toBe("en");
    expect(resolveLocale({ elementLang: "en-GB" })).toBe("en");
  });

  it("returns English when all sources are empty", () => {
    expect(resolveLocale({})).toBe("en");
    expect(resolveLocale({ elementLang: "", htmlLang: "", navigatorLanguage: "" })).toBe("en");
  });
});

describe("createTranslator", () => {
  it("returns the text for the locale", () => {
    expect(createTranslator("en")("retry")).toBe("Retry");
    expect(createTranslator("pl")("newChat")).toBe("Nowy czat");
  });

  it("interpolates {name} parameters, including numbers", () => {
    expect(createTranslator("en")("statusPreparing", { percent: 42 })).toBe(
      "Preparing model: 42%"
    );
    expect(createTranslator("pl")("statusIdle", { size: "ok. 1 GB" })).toBe(
      "Model zostanie pobrany po otwarciu czatu (ok. 1 GB)"
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(createTranslator("en")("statusIdle", { other: "x" })).toBe(
      "The model downloads when you open the chat ({size})"
    );
  });
});

describe("message dictionaries", () => {
  it("define exactly the same keys in both locales", () => {
    expect(Object.keys(dictionaries.pl).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it("define non-empty values for every key", () => {
    for (const locale of ["en", "pl"] as const) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect([locale, key, value.trim() !== ""]).toEqual([locale, key, true]);
      }
    }
  });

  it("use the same placeholders in both locales", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(dictionaries.en) as MessageKey[]) {
      expect(placeholders(dictionaries.pl[key])).toEqual(placeholders(dictionaries.en[key]));
    }
  });
});
