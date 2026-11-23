export interface EmbedAttributes {
  contentSrc?: string;
  lang?: string;
}

/**
 * Reads widget settings from the host's own script tag, e.g.
 * `<script type="module" src="widget.js" data-ai-chat-widget data-content-src="/kb.json" data-lang="pl">`.
 */
export const readEmbedAttributes = (root: ParentNode): EmbedAttributes => {
  const script = root.querySelector<HTMLScriptElement>("script[data-ai-chat-widget]");
  const attributes: EmbedAttributes = {};
  const contentSrc = script?.dataset.contentSrc?.trim();
  const lang = script?.dataset.lang?.trim();

  if (contentSrc) attributes.contentSrc = contentSrc;
  if (lang) attributes.lang = lang;
  return attributes;
};
