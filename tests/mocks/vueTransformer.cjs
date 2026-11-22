/* eslint-disable @typescript-eslint/no-require-imports -- Jest loads transformers as CommonJS */
// Minimal Jest transformer for Vue SFCs: compiles <script setup> with the template inlined,
// then transpiles the TypeScript output to CommonJS. Styles are ignored.
const { parse, compileScript } = require("@vue/compiler-sfc");
const ts = require("typescript");

module.exports = {
  process(source, filename) {
    const { descriptor, errors } = parse(source, { filename });
    if (errors.length) throw errors[0];

    const script = compileScript(descriptor, { id: filename, inlineTemplate: true });
    const { outputText } = ts.transpileModule(script.content, {
      fileName: `${filename}.ts`,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        verbatimModuleSyntax: false,
      },
    });
    return { code: outputText };
  },
};
