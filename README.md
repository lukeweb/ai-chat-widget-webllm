# AI Chat Widget

A small, embeddable chat widget built with Vue 3 and Vite. It uses [WebLLM](https://github.com/mlc-ai/web-llm) to run a language model in the browser with WebGPU, so chat generation runs on the visitor's device.

The widget is registered as a custom element and is added to the page automatically when the application script loads. Its interface appears immediately while the model initializes asynchronously. If WebGPU is unavailable or initialization fails, the chat remains visible and displays the error with an option to retry. The first model load may take time while the browser fetches the model assets.

**NOTE:**
**This project was created with OpenAI Codex as a learning exercise in building simple applications with minimal coding and using AI to diagnose and fix code errors.**

## Requirements

- Node.js `^22.18.0` or `>=24.12.0`
- Yarn 1.x
- A browser with WebGPU support to use the chat widget

## Setup

Install the dependencies:

```sh
yarn install
```

Optionally copy `.env.example` to `.env` in the project root (`.env` is gitignored) to override the defaults. Every setting has the default shown below, so the widget also works when `.env` is missing.

```dotenv
VITE_MODEL_ID=Qwen2.5-1.5B-Instruct-q4f16_1-MLC
VITE_MAX_HISTORY_MESSAGES=12
VITE_TEASER_DELAY_MS=800
VITE_TEASER_VISIBLE_MS=10000
VITE_WIDGET_TAG_NAME=ai-chat-widget
VITE_MAX_OUTPUT_TOKENS=512
VITE_MAX_INPUT_CHARS=1000
VITE_MAX_HISTORY_CHARS=6000
VITE_MODEL_SIZE_HINT=about 1 GB
VITE_LITE_MODEL_ID=Qwen3.5-0.8B-q4f16_1-MLC
VITE_LITE_MODEL_SIZE_HINT=about 400 MB
VITE_LITE_CONTEXT_WINDOW=2048
```

`VITE_MAX_OUTPUT_TOKENS` limits the length of a reply, `VITE_MAX_INPUT_CHARS` limits a user message (also enforced as the textarea `maxlength`), `VITE_MAX_HISTORY_CHARS` is the character budget for remembered conversation (oldest exchanges are dropped first), and `VITE_MODEL_SIZE_HINT` is the download size shown to visitors before the model loads. The `VITE_LITE_*` settings configure the smaller model used on mobile and low-resource devices (see "Model tiers" below); the lite model must be able to answer in Polish.

These are public build-time settings, not secrets. Vite embeds them in the application bundle. Numeric settings must be positive integers, and `VITE_WIDGET_TAG_NAME` must be a valid custom element name (lowercase, with a hyphen). A setting that is present but invalid fails at startup.

## Commands

Start the development server:

```sh
yarn dev
```

Run the unit tests:

```sh
yarn test
```

Run ESLint:

```sh
yarn lint
```

Type-check the test files:

```sh
yarn test:type-check
```

Type-check the application and create a production build:

```sh
yarn build
```

Preview the production build locally after building:

```sh
yarn preview
```

The production files are written to `dist/` and use relative asset URLs. The entry script is small: it loads the chat code on demand, registers the configured custom element and appends it to the page. WebLLM (about 6 MB) is a separate chunk and the Web Worker is a separate file; both are fetched from next to the entry script.

## Embedding

Load the generated entry file as a module script, ideally marking it so the widget can read its settings:

```html
<script type="module" src="https://example.com/widget/assets/index-XXXX.js"
        data-ai-chat-widget data-content-src="/chat-content.json" data-lang="pl"></script>
```

- `data-content-src` (or a `content-src` attribute on a pre-created `<ai-chat-widget>` element) points to a JSON file with the system prompt and knowledge base, so the widget can be reused without a rebuild. Changing the `content-src` attribute later reloads the content.
- `data-model-tier` (or a `model-tier` attribute on the element) is `auto` (default), `lite` or `full`. It forces the model tier, for example `lite` to try the mobile setup on a desktop. The tier is chosen when the chat is first opened and stays for the page until `destroy()`.
- `data-lang` (or a `lang` attribute on the element) selects the interface language (`en` or `pl`). Without it the widget uses `<html lang>`, then the browser language, then English.
- The content file is `{ "systemPrompt": "... {{contact}} ...", "contact": "Phone: ...", "knowledgeBase": { "en": [{ "title", "content", "keywords": [] }], "pl": [...] } }`. `contact` is the single source of contact details: it is inserted into the prompt through `{{contact}}` and added to the knowledge base as a generated entry, so do not repeat contact details in other entries. If the file cannot be loaded or is invalid, the built-in defaults are used and a warning is logged. Content applies to the whole page (one model per page).
- Hosts that want to unload the model call `document.querySelector("ai-chat-widget").destroy()`. Removing or moving the element never unloads the model.
- **CSP and hosting:** the Web Worker is created from the script's origin, so a strict Content Security Policy needs `worker-src` (and `script-src`) to allow that origin, and cross-origin hosting needs CORS headers on the worker and chunk files.

## How it works

1. The entry point registers the widget using the configured custom element name and mounts it on the page. The model is not downloaded at page load.
2. When the visitor first opens the chat, the AI engine checks for a WebGPU adapter and initializes the configured WebLLM model in a web worker. The widget observes the engine status and shows preparation progress when available, initialization state, or an error with a retry option.
3. User messages are sent to the local model. Response tokens stream into the chat, and recent exchanges are kept in memory for conversation context.
4. The model ID, conversation history limit, teaser timings, and element name are read from `.env` during the Vite build.

The default system prompt and knowledge base live in `src/config/systemPrompt.ts` and `src/config/knowledgeBase.ts`; they can be replaced at runtime through the content file described above. The interface is available in English and Polish (`src/i18n/messages.ts`), and a "New chat" button clears the conversation.

### Knowledge base retrieval

Up to three entries are selected per question and pasted into the prompt (at most 2400 characters, best match first). Matching is keyword-based: Polish and English words are reduced to a common form (Polish prefix stemming plus synonym groups in `src/services/retriever.helpers.ts`), words found in many entries count less, numbers and times such as `18:00` are matched, and the entry language follows the question (diacritics, Polish words, or which language's entries match better). A short follow-up question also uses the previous question. Tips for writing a knowledge base:

- Keep each entry about one topic, and keep entries short; split long ones.
- Put the words visitors use in `keywords` and in the `title`, in both languages. Keep prices, durations and contact details identical in paired entries (`tests/config/knowledgeBase.test.ts` checks the default content).
- Add domain synonyms for your own vocabulary to `POLISH_TERM_GROUPS` / `ENGLISH_TERM_GROUPS`, and words that appear in nearly every entry to `GENERIC_TOKENS`.

Model status is displayed in the chat interface. The browser console also logs model initialization failures. A percentage is shown only when the runtime reports download progress; other initialization work is presented without an estimated percentage.

## Production considerations

- **Browser and device support:** Chat UI remains visible without WebGPU, but model initialization reports an error and generation is unavailable. Lower-powered compatible devices may generate responses slowly.
- **Download and memory use:** The model is large (about 1 GB by default) and is downloaded only after the visitor opens the chat. The first load can take time and use significant bandwidth, storage, and GPU memory. Inference runs locally, but the model weights and WASM runtime are fetched from external hosts the first time. Test startup time and memory use on the devices your audience uses.
- **Model tiers:** On a mobile device, or when the site has less than about 1.2 GB of storage left or the device reports 4 GB of memory or less, the widget loads the lite model (`VITE_LITE_MODEL_ID`, Qwen3.5-0.8B by default) with a 2048-token context. Desktops keep the full model and behave as before. The lite model gets a smaller task: one knowledge-base entry (two only when they match almost equally, at most 1,000 characters), short answer rules and an example in the answer language, temperature 0 and the last two exchanges of history. Its reply is not streamed: the widget checks that every number in it (prices, hours, dates written with digits) appears in the knowledge-base entry or the question, and shows the entry itself if one does not. Numbers written as words are not checked.
- **Mobile devices:** Phones often have a small per-site storage quota and little GPU memory. The widget asks the browser to keep the downloaded model (`navigator.storage.persist()`) and, when loading fails, shows the likely cause: no WebGPU, not enough storage, an interrupted download, or not enough GPU memory. Downloaded parts are kept, so Retry resumes an interrupted download. To see the exact error on a phone, use remote debugging (Android: `chrome://inspect`; iOS: Safari Web Inspector). The `[ai-widget] model initialization failed` console line includes the failure reason and the site's storage usage and quota.
- **Client-side configuration:** Vite embeds `VITE_` settings in the public bundle. The model configuration, system prompt, and any knowledge base included in the app can be inspected by users; do not put secrets or private data in them.
- **No server-side controls:** Inference runs in the visitor's browser. Add a server-side service if production needs centralized access control, rate limiting, monitoring, or moderation.
- **Model output:** Responses can be inaccurate or unsuitable for a particular use. Validate the model and user experience for your application before release.
