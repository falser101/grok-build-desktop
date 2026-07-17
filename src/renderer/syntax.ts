import hljs from "highlight.js/lib/core";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  registered = true;

  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("c", c);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("csharp", csharp);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("dockerfile", dockerfile);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("graphql", graphql);
  hljs.registerLanguage("ini", ini);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("kotlin", kotlin);
  hljs.registerLanguage("less", less);
  hljs.registerLanguage("lua", lua);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("perl", perl);
  hljs.registerLanguage("php", php);
  hljs.registerLanguage("plaintext", plaintext);
  hljs.registerLanguage("powershell", powershell);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("ruby", ruby);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("scss", scss);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("swift", swift);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("html", xml);
  hljs.registerLanguage("vue", xml);
  hljs.registerLanguage("yaml", yaml);
  // Aliases used by languageFromExt
  hljs.registerLanguage("makefile", bash);
  hljs.registerLanguage("cmake", plaintext);
  hljs.registerLanguage("toml", ini);
  hljs.registerLanguage("protobuf", plaintext);
  hljs.registerLanguage("dart", javascript);
  hljs.registerLanguage("elixir", ruby);
  hljs.registerLanguage("erlang", plaintext);
  hljs.registerLanguage("haskell", plaintext);
  hljs.registerLanguage("clojure", plaintext);
  hljs.registerLanguage("vim", plaintext);
  hljs.registerLanguage("terraform", ini);
  hljs.registerLanguage("nim", python);
  hljs.registerLanguage("julia", python);
  hljs.registerLanguage("scala", java);
  hljs.registerLanguage("r", python);
}

/**
 * Highlight source for the file viewer.
 * Returns HTML string with hljs spans (already escaped by hljs).
 */
export function highlightCode(code: string, language: string): string {
  ensureRegistered();
  const lang = language || "plaintext";
  try {
    if (hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true })
        .value;
    }
  } catch {
    /* fall through */
  }
  return hljs.highlight(code, {
    language: "plaintext",
    ignoreIllegals: true,
  }).value;
}

/** Friendly label for the language chip in the file header. */
export function languageLabel(language: string, ext: string): string {
  const map: Record<string, string> = {
    go: "Go",
    java: "Java",
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    rust: "Rust",
    css: "CSS",
    scss: "SCSS",
    less: "Less",
    xml: "HTML/XML",
    html: "HTML",
    vue: "Vue",
    markdown: "Markdown",
    json: "JSON",
    yaml: "YAML",
    bash: "Shell",
    sql: "SQL",
    kotlin: "Kotlin",
    csharp: "C#",
    cpp: "C++",
    c: "C",
    php: "PHP",
    ruby: "Ruby",
    swift: "Swift",
    dockerfile: "Dockerfile",
    diff: "Diff",
    plaintext: "Text",
  };
  if (ext === ".vue") return "Vue";
  if (ext === ".html" || ext === ".htm") return "HTML";
  if (ext === ".svelte") return "Svelte";
  return map[language] ?? (ext ? ext.replace(/^\./, "").toUpperCase() : "Text");
}
