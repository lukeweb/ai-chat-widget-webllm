/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "@jest/globals";
import { readEmbedAttributes } from "../../src/widget/embedAttributes";

describe("readEmbedAttributes", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns an empty object when the host script tag is absent", () => {
    document.body.innerHTML = '<script src="other.js"></script>';

    expect(readEmbedAttributes(document)).toEqual({});
  });

  it("reads content-src and lang from the marked script tag", () => {
    document.body.innerHTML =
      '<script data-ai-chat-widget data-content-src=" /kb.json " data-lang="pl"></script>';

    expect(readEmbedAttributes(document)).toEqual({ contentSrc: "/kb.json", lang: "pl" });
  });

  it("reads the model tier", () => {
    document.body.innerHTML = '<script data-ai-chat-widget data-model-tier=" lite "></script>';

    expect(readEmbedAttributes(document)).toEqual({ modelTier: "lite" });
  });

  it("omits blank values", () => {
    document.body.innerHTML =
      '<script data-ai-chat-widget data-content-src=" " data-lang="" data-model-tier=" "></script>';

    expect(readEmbedAttributes(document)).toEqual({});
  });

  it("ignores data attributes on unmarked scripts", () => {
    document.body.innerHTML = '<script data-content-src="/nope.json"></script>';

    expect(readEmbedAttributes(document)).toEqual({});
  });
});
