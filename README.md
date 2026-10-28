# AI Chat Widget

A small, embeddable chat widget built with Vue 3 and Vite. It uses [WebLLM](https://github.com/mlc-ai/web-llm) to run a language model in the browser with WebGPU, so chat generation runs on the visitor's device.

The widget is registered as a custom element and is added to the page automatically when the application script loads. It stays hidden when WebGPU is unavailable or model initialization fails. The first model load may take time while the browser fetches the model assets.

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

Create a `.env` file in the project root with the following settings. `.env` is gitignored, so create this file locally before running or building the app.

```dotenv
VITE_MODEL_ID=Qwen2.5-3B-Instruct-q4f16_1-MLC
VITE_MAX_HISTORY_MESSAGES=12
VITE_TEASER_DELAY_MS=800
VITE_TEASER_VISIBLE_MS=10000
VITE_WIDGET_TAG_NAME=ai-chat-widget
```

These are public build-time settings, not secrets. Vite embeds them in the application bundle. Numeric settings must be positive integers.

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

The production files are written to `dist/`. The entry script registers the configured custom element and appends it to the page; when embedding the widget in another site, load the generated JavaScript asset as a module script.

## How it works

1. The entry point registers the widget using the configured custom element name and mounts it on the page.
2. The widget checks for a WebGPU adapter and initializes the configured WebLLM model in a web worker.
3. User messages are sent to the local model. Response tokens stream into the chat, and recent exchanges are kept in memory for conversation context.
4. The model ID, conversation history limit, teaser timings, and element name are read from `.env` during the Vite build.

The system prompt and knowledge base are maintained separately in `src/config/systemPrompt.ts`.

Model initialization progress is logged in the browser console, along with a message when the model is ready or fails to load. The progress logs are emitted in 10% increments.

## Production considerations

- **Browser and device support:** The widget requires WebGPU. Devices without a compatible adapter will not show the widget, and lower-powered devices may generate responses slowly.
- **Download and memory use:** The model is large. Its initial download can take time and use significant bandwidth, storage, and GPU memory. Test startup time and memory use on the devices your audience uses.
- **Client-side configuration:** Vite embeds `VITE_` settings in the public bundle. The model configuration, system prompt, and any knowledge base included in the app can be inspected by users; do not put secrets or private data in them.
- **No server-side controls:** Inference runs in the visitor's browser. Add a server-side service if production needs centralized access control, rate limiting, monitoring, or moderation.
- **Model output:** Responses can be inaccurate or unsuitable for a particular use. Validate the model and user experience for your application before release.
