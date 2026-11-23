/**
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createWidgetElement } from "../../src/widget/createWidgetElement";

let tagCounter = 0;

const setup = () => {
  const loadContent = jest.fn<(src?: string) => Promise<void>>().mockResolvedValue(undefined);
  const destroyEngine = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const baseConnected = jest.fn();
  class Base extends HTMLElement {
    connectedCallback(): void {
      baseConnected();
    }
  }
  const tag = `test-widget-${++tagCounter}`;
  customElements.define(tag, createWidgetElement(Base, { loadContent, destroyEngine }));
  return { tag, loadContent, destroyEngine, baseConnected };
};

describe("createWidgetElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("loads content from the content-src attribute on connect and keeps the base behavior", () => {
    const { tag, loadContent, baseConnected } = setup();
    const element = document.createElement(tag);
    element.setAttribute("content-src", " /kb.json ");

    document.body.appendChild(element);

    expect(loadContent).toHaveBeenCalledWith("/kb.json");
    expect(baseConnected).toHaveBeenCalledTimes(1);
  });

  it("restores the defaults (undefined source) when no attribute is set", () => {
    const { tag, loadContent } = setup();

    document.body.appendChild(document.createElement(tag));

    expect(loadContent).toHaveBeenCalledWith(undefined);
  });

  it("reloads content when content-src changes while connected, but not while detached", () => {
    const { tag, loadContent } = setup();
    const element = document.createElement(tag);
    element.setAttribute("content-src", "/before-connect.json");
    expect(loadContent).not.toHaveBeenCalled();

    document.body.appendChild(element);
    element.setAttribute("content-src", "/after.json");

    expect(loadContent.mock.calls).toEqual([["/before-connect.json"], ["/after.json"]]);
  });

  it("does not destroy the engine when the element is removed", () => {
    const { tag, destroyEngine } = setup();
    const element = document.createElement(tag);
    document.body.appendChild(element);

    element.remove();

    expect(destroyEngine).not.toHaveBeenCalled();
  });

  it("destroy() removes the element and unloads the engine", async () => {
    const { tag, destroyEngine } = setup();
    const element = document.createElement(tag) as HTMLElement & { destroy(): Promise<void> };
    document.body.appendChild(element);

    await element.destroy();

    expect(element.isConnected).toBe(false);
    expect(destroyEngine).toHaveBeenCalledTimes(1);
  });
});
