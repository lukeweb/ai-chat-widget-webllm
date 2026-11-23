export interface WidgetElementDeps {
  loadContent: (src?: string) => Promise<void>;
  destroyEngine: () => Promise<void>;
}

/**
 * Extends the Vue-generated custom element with the page-level integration points:
 * - `content-src`: URL of the runtime content JSON, read on connect and whenever it changes;
 * - `destroy()`: explicit opt-in for hosts that want to unload the page-wide model.
 * Removing the element from the DOM never unloads the model by itself.
 */
export type WidgetBaseElement = new () => HTMLElement & {
  connectedCallback?(): void;
};

export const createWidgetElement = (
  Base: WidgetBaseElement,
  { loadContent, destroyEngine }: WidgetElementDeps
): CustomElementConstructor =>
  class WidgetElement extends Base {
    static get observedAttributes(): string[] {
      return ["content-src"];
    }

    connectedCallback(): void {
      super.connectedCallback?.();
      this.applyContentSource();
    }

    attributeChangedCallback(name: string): void {
      if (name === "content-src" && this.isConnected) this.applyContentSource();
    }

    /** Unloads the model and removes the widget. Call only when the page is done with the chat. */
    destroy(): Promise<void> {
      this.remove();
      return destroyEngine();
    }

    private applyContentSource(): void {
      const src = this.getAttribute("content-src")?.trim();
      void loadContent(src || undefined);
    }
  };
