# AGENTS.md

# Project overview

A small project that adds a simple AI assistant to a website. The LLM runs directly in the user's browser, on the client side. The project does not use external LLM APIs; the model runs locally in the browser.

## Technology stack

- Languages: JavaScript, TypeScript
- Framework: Vue 3
- Styling: CSS
- Package manager: Yarn
- Build tool and development server: Vite

## Current state

- Status: MVP — core functionality is implemented.
- Implemented features: The LLM runs directly in the user's browser.
- Known limitations: Browser and device compatibility may be limited and should be verified when developing or modifying features.

## Repository structure

├── AGENTS.md
├── README.md
├── env.d.ts — environment and type declarations.
├── index.html — HTML entry point used by Vite.
├── jest.config.cjs — Jest configuration.
├── package.json
├── public — static assets.
│   └── favicon.ico
├── src — application source code.
│   ├── components — Vue components.
│   ├── config — application configuration and configuration utilities.
│   ├── main.ts — application entry point.
│   └── services — AI engine and related services.
├── tests — automated tests and test support files.
│   ├── config — configuration utility tests.
│   ├── mocks — mocks used by tests.
│   └── services — service tests.
├── tsconfig.app.json — application TypeScript configuration.
├── tsconfig.json — base TypeScript configuration.
├── tsconfig.node.json — TypeScript configuration for Node.js tooling.
├── tsconfig.test.json — TypeScript configuration for tests.
├── vite.config.ts — Vite configuration.
└── yarn.lock

## Development instructions

### Package management

- Always use Yarn to install, add, remove, or update dependencies.
- Never use npm or pnpm to manage project dependencies.
- Do not edit yarn.lock manually.
- When adding a dependency, verify that it is necessary and compatible with the existing project.
- Avoid introducing a new dependency when the existing stack or standard library provides a suitable solution.

### Implementation

- Inspect the relevant source code and existing tests before making changes.
- Follow the existing project structure, coding conventions, and implementation patterns.
- Use TypeScript types to make interfaces and data contracts explicit.
- Handle errors explicitly where operations can fail.
- Do not introduce unrelated changes while implementing a feature or fixing a bug.
- Do not add abstractions unless they solve a concrete problem.

### Testing

- Every new feature must include appropriate automated tests.
- Every new function containing non-trivial or business logic must have unit tests.
- Update existing tests when changing established behavior.
- Run the full test suite before completing a change when practical.
- Never claim that tests pass unless they have actually been executed successfully.
- If tests cannot be run, explain why and identify which tests remain unverified.
- Bug fixes must include a regression test when the bug can be reproduced through an automated test.

### Code quality

- Avoid duplicating existing logic.
- Prefer clear names that communicate intent.
- Keep code consistent with the existing Vue 3 and TypeScript patterns.
- Do not weaken TypeScript checks or disable tests to make a change pass.
- Update documentation when a change affects documented behavior or development workflows.

### Change verification

- Summarize the changes made and the tests executed.
- Report any known limitations or outstanding verification steps.
