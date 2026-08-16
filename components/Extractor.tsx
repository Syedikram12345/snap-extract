"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

import {
  Check,
  Clipboard,
  Copy,
  Download,
  FileImage,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import { createWorker, PSM } from "tesseract.js";

import prettier from "prettier/standalone";
import babelPlugin from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import typescriptPlugin from "prettier/plugins/typescript";
import htmlPlugin from "prettier/plugins/html";
import cssPlugin from "prettier/plugins/postcss";

type Mode = "auto" | "text" | "code" | "table";

type CodeLanguage = "javascript" | "typescript" | "json" | "html" | "css" | "c";

type ProcessingMode = "original" | "contrast" | "threshold" | "sharp";

// ---------------------------------------------------------
// LANGUAGE DETECTION
// ---------------------------------------------------------

function guessCodeLanguage(text: string): CodeLanguage {
  // -------------------------------------------------------
  // C
  // -------------------------------------------------------

  if (
    /#include\s*[<"][a-zA-Z0-9_.]+[">]/.test(text) ||
    /\bint\s+main\s*\(/.test(text) ||
    /\bprintf\s*\(/.test(text) ||
    /\bscanf\s*\(/.test(text)
  ) {
    return "c";
  }

  // -------------------------------------------------------
  // HTML
  // -------------------------------------------------------

  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    return "html";
  }

  // -------------------------------------------------------
  // TYPESCRIPT
  // -------------------------------------------------------

  if (
    /\b(interface|type)\s+\w+/.test(text) ||
    /:\s*(string|number|boolean)\b/.test(text)
  ) {
    return "typescript";
  }

  // -------------------------------------------------------
  // JSON
  // -------------------------------------------------------

  if (/^\s*[\[{]/.test(text) && /"\w+"\s*:/.test(text)) {
    return "json";
  }

  // -------------------------------------------------------
  // JAVASCRIPT
  // -------------------------------------------------------

  if (
    /[{};]/.test(text) ||
    /=>/.test(text) ||
    /console\./.test(text) ||
    /\bconst\s+\w+\s*=/.test(text) ||
    /\blet\s+\w+\s*=/.test(text) ||
    /\bfunction\s+\w+\s*\(/.test(text) ||
    /\.forEach\s*\(/.test(text) ||
    /\.reduce\s*\(/.test(text)
  ) {
    return "javascript";
  }

  return "javascript";
}

// ---------------------------------------------------------
// IMAGE PREPROCESSING
// ---------------------------------------------------------

function preprocessImage(
  source: File,
  mode: Mode,
  processing: ProcessingMode,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    const url = URL.createObjectURL(source);

    image.onload = () => {
      try {
        /*
         * Code screenshots need to be enlarged more because
         * small characters such as:
         *
         * 0 / O
         * 1 / l / I
         * ; / :
         * } / )
         *
         * are easy for OCR to confuse.
         */

        const scale = mode === "code" || mode === "auto" ? 2.5 : 1.75;

        const width = Math.min(Math.round(image.naturalWidth * scale), 5000);

        const height = Math.min(Math.round(image.naturalHeight * scale), 5000);

        const canvas = document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", {
          willReadFrequently: true,
        });

        if (!ctx) {
          throw new Error("Could not initialize image processing.");
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        ctx.drawImage(image, 0, 0, width, height);

        const pixels = ctx.getImageData(0, 0, width, height);

        const data = pixels.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const gray = 0.299 * r + 0.587 * g + 0.114 * b;

          let value = gray;

          // -------------------------------------------------
          // ORIGINAL
          // -------------------------------------------------

          if (processing === "original") {
            value = gray;
          }

          // -------------------------------------------------
          // CONTRAST
          // -------------------------------------------------

          if (processing === "contrast") {
            const contrast = mode === "code" || mode === "auto" ? 1.55 : 1.15;

            value = (gray - 128) * contrast + 128;

            value = Math.max(0, Math.min(255, value));
          }

          // -------------------------------------------------
          // THRESHOLD
          // -------------------------------------------------

          if (processing === "threshold") {
            const contrast = mode === "code" || mode === "auto" ? 1.7 : 1.2;

            value = (gray - 128) * contrast + 128;

            value = Math.max(0, Math.min(255, value));

            value = value < 175 ? 0 : 255;
          }

          // -------------------------------------------------
          // SHARP / HIGH CONTRAST
          // -------------------------------------------------

          if (processing === "sharp") {
            const contrast = mode === "code" || mode === "auto" ? 2.0 : 1.3;

            value = (gray - 128) * contrast + 128;

            value = Math.max(0, Math.min(255, value));
          }

          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
        }

        ctx.putImageData(pixels, 0, 0);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);

            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Could not prepare image."));
            }
          },
          "image/png",
          1,
        );
      } catch (error) {
        URL.revokeObjectURL(url);

        reject(error);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);

      reject(new Error("Could not read this image."));
    };

    image.src = url;
  });
}

// ---------------------------------------------------------
// CODE SCORING
// ---------------------------------------------------------

function scoreCodeResult(text: string): number {
  if (!text.trim()) {
    return -Infinity;
  }

  let score = 0;

  // -------------------------------------------------------
  // JAVASCRIPT / TYPESCRIPT
  // -------------------------------------------------------

  if (/const\s+\w+\s*=/.test(text)) {
    score += 25;
  }

  if (/let\s+\w+\s*=/.test(text)) {
    score += 15;
  }

  if (/var\s+\w+\s*=/.test(text)) {
    score += 10;
  }

  if (/function\s+\w+\s*\(/.test(text)) {
    score += 20;
  }

  if (/=>/.test(text)) {
    score += 20;
  }

  if (/console\.\w+\(/.test(text)) {
    score += 15;
  }

  if (/\.forEach\s*\(/.test(text)) {
    score += 15;
  }

  if (/\.reduce\s*\(/.test(text)) {
    score += 15;
  }

  // -------------------------------------------------------
  // C
  // -------------------------------------------------------

  if (/#include\s*[<"][\w.]+[>"]/.test(text)) {
    score += 40;
  }

  if (/\bint\s+main\s*\(/.test(text)) {
    score += 40;
  }

  if (/\bprintf\s*\(/.test(text)) {
    score += 25;
  }

  if (/\bscanf\s*\(/.test(text)) {
    score += 25;
  }

  if (/\bfor\s*\([^;]+;[^;]+;[^)]+\)/.test(text)) {
    score += 15;
  }

  // -------------------------------------------------------
  // GENERAL CODE
  // -------------------------------------------------------

  if (/[{}]/.test(text)) {
    score += 15;
  }

  if (/\[[\s\S]*\]/.test(text)) {
    score += 15;
  }

  if (/[();]/.test(text)) {
    score += 10;
  }

  if (/["'`]/.test(text)) {
    score += 5;
  }

  if (/\breturn\b/.test(text)) {
    score += 10;
  }

  if (/\bif\s*\(/.test(text)) {
    score += 10;
  }

  if (/\bfor\s*\(/.test(text)) {
    score += 10;
  }

  if (text.split("\n").length >= 3) {
    score += 5;
  }

  // -------------------------------------------------------
  // SUSPICIOUS OCR
  // -------------------------------------------------------

  if (/\b1s\b/.test(text)) {
    score -= 15;
  }

  if (/\bIH\b/.test(text)) {
    score -= 20;
  }

  if (/\b©\b/.test(text)) {
    score -= 15;
  }

  if (/users\.\s+forEach/.test(text)) {
    score -= 10;
  }

  if (/\n\s*1\s*;?\s*$/.test(text)) {
    score -= 20;
  }

  return score;
}

// ---------------------------------------------------------
// OCR CLEANUP
// ---------------------------------------------------------

function cleanOCRCode(text: string): string {
  let result = text;

  // -------------------------------------------------------
  // BASIC WHITESPACE
  // -------------------------------------------------------

  result = result
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // -------------------------------------------------------
  // COMMON OCR CHARACTER FIXES
  // -------------------------------------------------------

  result = result.replace(/(?<=^|[\s,(=;])©(?=\s*[,;)\]}]|$)/gm, "0");

  // -------------------------------------------------------
  // DOT FIX
  // -------------------------------------------------------

  result = result.replace(
    /(\b[A-Za-z_$][\w$]*)\.\s+([A-Za-z_$][\w$]*)/g,
    "$1.$2",
  );

  // -------------------------------------------------------
  // PUNCTUATION SPACING
  // -------------------------------------------------------

  result = result.replace(/\s+([,;)\]}])/g, "$1");

  result = result.replace(/([([{])\s+/g, "$1");

  // -------------------------------------------------------
  // ARRAY CLOSING FIX
  // -------------------------------------------------------

  if (
    /(?:const|let|var)\s+\w+\s*=\s*\[/.test(result) &&
    /\b\w+\.forEach\s*\(/.test(result)
  ) {
    result = result.replace(
      /\n\s*(?:IH|1|1;|1s)\s*(?=\n\s*\w+\.forEach\s*\()/g,
      "\n];",
    );
  }

  // -------------------------------------------------------
  // FOREACH CLOSING FIX
  // -------------------------------------------------------

  if (/\b\w+\.forEach\s*\(/.test(result) && /=>\s*\{/.test(result)) {
    result = result.replace(
      /\n\s*(?:1|1;|1\)|1\);|1s|IH|3\s*;\s*})\s*$/g,
      "\n});",
    );
  }

  // -------------------------------------------------------
  // FOREACH STRAY NUMBER FIX
  // -------------------------------------------------------

  /*
   * OCR sometimes produces:
   *
   * console.log(user.age);
   *
   * 3};
   *
   * instead of:
   *
   * console.log(user.age);
   * });
   *
   * Only apply this when the suspicious line is directly
   * associated with a forEach arrow-function block.
   */

  if (/\.forEach\s*\(/.test(result) && /=>\s*\{/.test(result)) {
    result = result.replace(/\n\s*(?:[0-9]+|[0-9]+;)\s*}\s*$/g, "\n});");

    result = result.replace(/\n\s*(?:[0-9]+|[0-9]+;)\s*;\s*}\s*$/g, "\n});");
  }

  // -------------------------------------------------------
  // REACT COMPONENT CLOSING
  // -------------------------------------------------------

  result = result.replace(/\)\s*s\s*(?=\s*export\s+default)/g, ")}");

  // -------------------------------------------------------
  // C INCLUDE FIX
  // -------------------------------------------------------

  result = result.replace(/#include\s*\n\s*([<"][^>"]+[>"])/g, "#include $1");

  // -------------------------------------------------------
  // C RETURN FIX
  // -------------------------------------------------------

  result = result.replace(/\breturn\s+©\s*;/g, "return 0;");

  // -------------------------------------------------------
  // C LOOP VARIABLE FIX
  // -------------------------------------------------------

  result = result.replace(
    /for\s*\(\s*int\s+1\s*=\s*0\s*;\s*i\s*</g,
    "for (int i = 0; i <",
  );

  result = result.replace(/for\s*\(\s*int\s+i\s*=\s*©/g, "for (int i = 0");

  // -------------------------------------------------------
  // FUNCTION BRACE BALANCE
  // -------------------------------------------------------

  if (/\bfunction\s+\w+\s*\([^)]*\)\s*\{/.test(result)) {
    const openBraces = (result.match(/{/g) || []).length;

    const closeBraces = (result.match(/}/g) || []).length;

    if (openBraces > closeBraces) {
      result = `${result}\n}`;
    }
  }

  // -------------------------------------------------------
  // FINAL WHITESPACE
  // -------------------------------------------------------

  result = result
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  return result.trim();
}

// ---------------------------------------------------------
// TEMPLATE LITERAL REPAIR
// ---------------------------------------------------------

function repairTemplateLiteralDelimiters(text: string): string {
  let result = text;

  result = result.replace(
    /\b(console\.(?:log|warn|error|info)\(|return\s+)(["'’‘])?(?=[^`\n]*\$\{)/g,
    (_match, prefix: string) => `${prefix}\``,
  );

  result = result.replace(
    /^(\s*[A-Za-z_$][\w$]*:\s*)(["'’‘])?(?=[^`\n,}]*\$\{)/gm,
    (_match, prefix: string) => `${prefix}\``,
  );

  result = result.replace(
    /(\$\{[^`\n]*\}[^`\n]*)(['"’‘])(?=\s*[,;)])/g,
    (_match, body: string) => `${body}\``,
  );

  result = result.replace(
    /`((?:[^`\n{}]|\$\{[^`\n}]*\})*)(?=[,;)])/g,
    (match, body: string) => (body.includes("${") ? `\`${body}\`` : match),
  );

  return result;
}

// ---------------------------------------------------------
// BRACKET REPAIR
// ---------------------------------------------------------

function repairMismatchedBrackets(text: string): string {
  const closerFor: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };

  const openers = new Set(Object.keys(closerFor));

  const closers = new Set(Object.values(closerFor));

  const stack: string[] = [];

  let inString: string | null = null;

  let out = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    const prev = text[i - 1];

    if (inString) {
      out += ch;

      if (ch === inString && prev !== "\\") {
        inString = null;
      }

      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;

      out += ch;

      continue;
    }

    if (openers.has(ch)) {
      stack.push(closerFor[ch]);

      out += ch;

      continue;
    }

    if (closers.has(ch)) {
      const expected = stack[stack.length - 1];

      if (expected === ch) {
        stack.pop();

        out += ch;
      } else if (expected) {
        stack.pop();

        out += expected;
      }

      /*
       * If no opener exists, this is an orphan closer.
       *
       * Example:
       *
       * console.log("hello");)
       *
       * The final ")" is dropped.
       */

      continue;
    }

    out += ch;
  }

  while (stack.length) {
    out += stack.pop();
  }

  return out;
}

// ---------------------------------------------------------
// JAVASCRIPT REPAIR
// ---------------------------------------------------------

function repairJavaScript(text: string): string {
  let result = text;

  result = repairTemplateLiteralDelimiters(result);

  // -------------------------------------------------------
  // ©.18 -> 0.18
  // -------------------------------------------------------

  result = result.replace(/©(?=\.\d+)/g, "0");

  // -------------------------------------------------------
  // STRAY © BEFORE KEYWORDS
  // -------------------------------------------------------

  result = result.replace(
    /^©\s+(?=(return|const|let|var|if|for|while|function)\b)/gm,
    "",
  );

  // -------------------------------------------------------
  // "$%$" -> "$$"
  // -------------------------------------------------------

  result = result.replace(/\$%\$/g, "$$");

  // -------------------------------------------------------
  // }s} -> };}
  // -------------------------------------------------------

  result = result.replace(/\}s\}/g, "};}");

  // -------------------------------------------------------
  // = | -> = [
  // -------------------------------------------------------

  result = result.replace(/=\s*\|\s*$/gm, "= [");

  // -------------------------------------------------------
  // STRAY OCR NUMBERS IN FOREACH
  // -------------------------------------------------------

  if (/\.forEach\s*\(/.test(result) && /=>\s*\{/.test(result)) {
    result = result.replace(/\n[ \t]*[0-9]+;?[ \t]*\}[ \t]*$/g, "\n});");
  }

  // -------------------------------------------------------
  // STRAY 1 / 1; BETWEEN CODE LINES
  // -------------------------------------------------------

  result = result.replace(/\n[ \t]*1;?[ \t]*\n(?=[ \t]*\S)/g, "\n});\n");

  // -------------------------------------------------------
  // REMOVE OBVIOUS ORPHAN CLOSING PARENTHESIS
  // -------------------------------------------------------

  /*
   * Only at the very end of the complete result.
   *
   * Example:
   *
   * console.log("Total:", result);)
   *
   * becomes:
   *
   * console.log("Total:", result);
   *
   * More complicated cases are handled by the
   * bracket stack below.
   */

  result = result.replace(/;\s*\)+\s*$/g, ";");

  result = repairMismatchedBrackets(result);

  return result;
}

// ---------------------------------------------------------
// TYPESCRIPT REPAIR
// ---------------------------------------------------------

function repairTypeScript(text: string): string {
  return repairJavaScript(text);
}

// ---------------------------------------------------------
// C REPAIR
// ---------------------------------------------------------

function repairC(text: string): string {
  let result = text;

  // -------------------------------------------------------
  // BASIC C OCR FIXES
  // -------------------------------------------------------

  /*
   * OCR:
   *
   * for (int 1 = 0; i < 5; i++)
   *
   * becomes:
   *
   * for (int i = 0; i < 5; i++)
   */

  result = result.replace(
    /for\s*\(\s*int\s+1\s*=\s*0\s*;\s*i\s*</g,
    "for (int i = 0; i <",
  );

  /*
   * OCR:
   *
   * for (int i = 0; 1 < 5; i++)
   *
   * becomes:
   *
   * for (int i = 0; i < 5; i++)
   */

  result = result.replace(
    /for\s*\(\s*int\s+i\s*=\s*0\s*;\s*1\s*<\s*([^;]+);\s*i\s*\)/g,
    "for (int i = 0; i < $1; i)",
  );

  /*
   * The replacement above intentionally reconstructs the
   * complete loop header, but the closing ')' must be retained.
   */

  result = result.replace(
    /for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*([^;]+);\s*i\s*\)/g,
    "for (int i = 0; i < $1; i++)",
  );

  // -------------------------------------------------------
  // INTEGER OCR: 1e -> 10
  // -------------------------------------------------------

  /*
   * In C, "1e" by itself is not a valid integer literal.
   *
   * When OCR produces a number followed by a lone e,
   * the most likely intended value in ordinary code is 10.
   *
   * We ONLY apply this to the specific numeric token shape.
   */

  result = result.replace(
    /\b(\d+)e\b/g,
    (_match, digits: string) => `${digits}0`,
  );

  // -------------------------------------------------------
  // C RETURN © -> 0
  // -------------------------------------------------------

  result = result.replace(/\breturn\s+©\s*;/g, "return 0;");

  // -------------------------------------------------------
  // C ARRAY NUMBER SEQUENCE REPAIR
  // -------------------------------------------------------

  /*
   * OCR can turn:
   *
   * {10, 20, 30, 40, 50}
   *
   * into:
   *
   * {10, 20, 30, 48, 50}
   *
   * If an integer array contains exactly five values and
   * four of them strongly establish a regular +10 sequence,
   * repair the single outlier.
   *
   * This is deliberately narrow so we don't rewrite arbitrary
   * numeric arrays.
   */

  result = result.replace(
    /(\{\s*)(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(\s*\})/g,
    (full, opening, a, b, c, d, e, closing) => {
      const values = [Number(a), Number(b), Number(c), Number(d), Number(e)];

      const firstStep = values[1] - values[0];

      const secondStep = values[2] - values[1];

      /*
       * We only infer a sequence when the first two steps
       * agree and the final value also fits that sequence.
       */

      if (
        firstStep === secondStep &&
        firstStep !== 0 &&
        values[4] === values[0] + firstStep * 4
      ) {
        const expectedFourth = values[0] + firstStep * 3;

        /*
         * Only replace the fourth value when it is the
         * obvious outlier.
         */

        if (values[3] !== expectedFourth) {
          return `${opening}${values[0]}, ${values[1]}, ${values[2]}, ${expectedFourth}, ${values[4]}${closing}`;
        }
      }

      return full;
    },
  );

  // -------------------------------------------------------
  // CONTEXTUAL RETURN NUMBER REPAIR
  // -------------------------------------------------------

  /*
   * We DO NOT globally convert 9 -> 0.
   *
   * A program is allowed to:
   *
   * return 9;
   *
   * Therefore no blind numeric replacement is used here.
   */

  // -------------------------------------------------------
  // BRACKET REPAIR
  // -------------------------------------------------------

  result = repairMismatchedBrackets(result);

  return result;
}

// ---------------------------------------------------------
// LANGUAGE-SPECIFIC REPAIR
// ---------------------------------------------------------

function repairByLanguage(text: string, language: CodeLanguage): string {
  switch (language) {
    case "javascript":
      return repairJavaScript(text);

    case "typescript":
      return repairTypeScript(text);

    case "c":
      return repairC(text);

    default:
      return text;
  }
}

// ---------------------------------------------------------
// C CODE FORMATTER
// ---------------------------------------------------------

function formatCCode(text: string): string {
  let code = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  const lines: string[] = [];
  let current = "";
  let indent = 0;

  const INDENT = "    ";

  function pushLine(line: string) {
    const cleaned = line.trim();

    if (!cleaned) return;

    lines.push(`${INDENT.repeat(Math.max(indent, 0))}${cleaned}`);
  }

  function flushCurrent() {
    const cleaned = current.trim();

    if (cleaned) {
      pushLine(cleaned);
    }

    current = "";
  }

  let inString: string | null = null;
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];

    // -----------------------------------------------------
    // STRING HANDLING
    // -----------------------------------------------------

    if (inString) {
      current += ch;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === inString) {
        inString = null;
      }

      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }

    // -----------------------------------------------------
    // COMMENTS
    // -----------------------------------------------------

    if (ch === "/" && code[i + 1] === "/") {
      current += "//";

      i += 2;

      while (i < code.length && code[i] !== "\n") {
        current += code[i];
        i++;
      }

      flushCurrent();

      continue;
    }

    // -----------------------------------------------------
    // OPEN BRACE
    // -----------------------------------------------------

    if (ch === "{") {
      current = current.trim();

      if (current) {
        pushLine(`${current} {`);
      } else {
        pushLine("{");
      }

      current = "";

      indent++;

      continue;
    }

    // -----------------------------------------------------
    // CLOSE BRACE
    // -----------------------------------------------------

    if (ch === "}") {
      flushCurrent();

      indent = Math.max(indent - 1, 0);

      /*
       * Handle } else {
       * Handle } while (...);
       */

      const rest = code.slice(i + 1);

      if (/^\s*else\b/.test(rest)) {
        pushLine("} else {");

        indent++;

        const match = rest.match(/^\s*else\s*\{/);

        if (match) {
          i += match[0].length - 1;
        }

        continue;
      }

      if (/^\s*while\s*\(/.test(rest)) {
        pushLine("}");

        continue;
      }

      pushLine("}");

      continue;
    }

    // -----------------------------------------------------
    // SEMICOLON
    // -----------------------------------------------------

    if (ch === ";") {
      current += ";";

      flushCurrent();

      continue;
    }

    // -----------------------------------------------------
    // NEWLINE
    // -----------------------------------------------------

    if (ch === "\n") {
      flushCurrent();

      continue;
    }

    current += ch;
  }

  flushCurrent();

  // -------------------------------------------------------
  // CLEAN UP SPACING
  // -------------------------------------------------------

  let result = lines.join("\n");

  result = result
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]")
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\s*=\s*/g, " = ")
    .replace(/\s*>=\s*/g, " >= ")
    .replace(/\s*<=\s*/g, " <= ")
    .replace(/\s*==\s*/g, " == ")
    .replace(/\s*\+\+\s*/g, "++");

  return result.trim();
}

// ---------------------------------------------------------
// PRETTIER
// ---------------------------------------------------------

async function formatCode(
  text: string,
  language: CodeLanguage,
): Promise<string> {
  // -------------------------------------------------------
  // C
  // -------------------------------------------------------

  if (language === "c") {
    return formatCCode(text);
  }

  // -------------------------------------------------------
  // OTHER LANGUAGES
  // -------------------------------------------------------

  const parser =
    language === "typescript"
      ? "typescript"
      : language === "html"
        ? "html"
        : language === "css"
          ? "css"
          : language === "json"
            ? "json"
            : "babel";

  const plugins =
    parser === "typescript"
      ? [typescriptPlugin]
      : parser === "html"
        ? [htmlPlugin]
        : parser === "css"
          ? [cssPlugin]
          : [babelPlugin, estreePlugin];

  const formatted = await prettier.format(text, {
    parser,
    plugins,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
  });

  return formatted.trim();
}
// ---------------------------------------------------------
// REPAIR + FORMAT PIPELINE
// ---------------------------------------------------------

async function repairAndFormat(
  rawText: string,
  language: CodeLanguage,
): Promise<{ text: string; formatted: boolean }> {
  const cleaned = cleanOCRCode(rawText);

  // -------------------------------------------------------
  // FIRST ATTEMPT
  // -------------------------------------------------------

  try {
    const formatted = await formatCode(cleaned, language);

    return {
      text: formatted,
      formatted: language !== "c",
    };
  } catch {
    // Continue to repair stage.
  }

  // -------------------------------------------------------
  // REPAIR
  // -------------------------------------------------------

  const repaired = repairByLanguage(cleaned, language);

  // -------------------------------------------------------
  // SECOND ATTEMPT
  // -------------------------------------------------------

  try {
    const formatted = await formatCode(repaired, language);

    return {
      text: formatted,
      formatted: true,
    };
  } catch {
    return {
      text: repaired,
      formatted: false,
    };
  }
}

// ---------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------

export default function Extractor() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);

  const [preview, setPreview] = useState("");

  const [result, setResult] = useState("");

  const [mode, setMode] = useState<Mode>("auto");

  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>("javascript");

  const [loading, setLoading] = useState(false);

  const [copying, setCopying] = useState(false);

  const [status, setStatus] = useState("");

  const [drag, setDrag] = useState(false);

  // -------------------------------------------------------
  // CLEANUP
  // -------------------------------------------------------

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  // -------------------------------------------------------
  // SELECT FILE
  // -------------------------------------------------------

  function selectFile(next: File | undefined) {
    if (!next) return;

    if (!next.type.startsWith("image/")) {
      setStatus("Please choose an image file.");

      return;
    }

    if (next.size > 10 * 1024 * 1024) {
      setStatus("Image is too large. Maximum size is 10 MB.");

      return;
    }

    setFile(next);

    setPreview(URL.createObjectURL(next));

    setResult("");

    setStatus("");

    setCopying(false);
  }

  // -------------------------------------------------------
  // INPUT CHANGE
  // -------------------------------------------------------

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    selectFile(e.target.files?.[0]);
  }

  // -------------------------------------------------------
  // DROP
  // -------------------------------------------------------

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();

    setDrag(false);

    selectFile(e.dataTransfer.files?.[0]);
  }

  // -------------------------------------------------------
  // LOCAL OCR
  // -------------------------------------------------------

  async function runLocalOCR(source: File, selectedMode: Mode) {
    const processingModes: ProcessingMode[] =
      selectedMode === "code"
        ? ["original", "contrast", "threshold", "sharp"]
        : selectedMode === "auto"
          ? ["original", "contrast", "threshold", "sharp"]
          : ["contrast"];

    const worker = await createWorker("eng");

    try {
      const results: {
        text: string;
        confidence: number;
        score: number;
      }[] = [];

      for (let i = 0; i < processingModes.length; i++) {
        const processing = processingModes[i];

        setStatus(
          selectedMode === "code" || selectedMode === "auto"
            ? `Reading screenshot… ${i + 1}/${processingModes.length}`
            : "Reading screenshot…",
        );

        const processed = await preprocessImage(
          source,
          selectedMode,
          processing,
        );

        const psm =
          selectedMode === "code" || selectedMode === "auto"
            ? PSM.SINGLE_BLOCK
            : PSM.AUTO;

        await worker.setParameters({
          tessedit_pageseg_mode: psm,
        });

        const { data } = await worker.recognize(processed);

        const text = data.text.trim();

        const confidence = Number(data.confidence || 0);

        const score =
          selectedMode === "code" || selectedMode === "auto"
            ? scoreCodeResult(text) + confidence * 0.35
            : confidence;

        results.push({
          text,
          confidence,
          score,
        });
      }

      results.sort((a, b) => b.score - a.score);

      const best = results[0];

      if (!best?.text) {
        return "";
      }

      if (selectedMode === "code" || selectedMode === "auto") {
        return cleanOCRCode(best.text);
      }

      return best.text;
    } finally {
      await worker.terminate();
    }
  }

  // -------------------------------------------------------
  // EXTRACT
  // -------------------------------------------------------

  async function extract() {
    if (!file) return;

    setLoading(true);

    setStatus("Preparing screenshot…");

    try {
      // ---------------------------------------------------
      // GET ACTIVE PROVIDER
      // ---------------------------------------------------

      const providerResponse = await fetch("/api/provider", {
        cache: "no-store",
      });

      const providerData = providerResponse.ok
        ? await providerResponse.json()
        : {
            provider: "local",
          };

      let text = "";

      // ---------------------------------------------------
      // AI PROVIDER WITH LOCAL FALLBACK
      // ---------------------------------------------------

      if (
        providerData.provider === "gemini" ||
        providerData.provider === "openai"
      ) {
        try {
          const form = new FormData();

          form.append("image", file);

          form.append("mode", mode);

          const response = await fetch("/api/extract", {
            method: "POST",
            body: form,
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Extraction failed.");
          }

          text = data.text || "";

          setStatus("AI extraction complete.");
        } catch (aiError) {
          setStatus("AI extraction unavailable · trying local OCR…");

          text = await runLocalOCR(file, mode);

          if (!text) {
            throw aiError instanceof Error
              ? aiError
              : new Error("Extraction failed.");
          }

          setStatus("Local OCR complete (AI was unavailable).");
        }
      }

      // ---------------------------------------------------
      // LOCAL OCR
      // ---------------------------------------------------
      else {
        text = await runLocalOCR(file, mode);

        if (!text) {
          throw new Error("No readable content was detected.");
        }

        setStatus("Local OCR complete.");
      }

      // ---------------------------------------------------
      // CODE DETECTION
      // ---------------------------------------------------

      const looksLikeCode =
        mode === "code" ||
        (mode === "auto" &&
          (/[{};]/.test(text) ||
            /=>/.test(text) ||
            /console\./.test(text) ||
            /\bconst\s+\w+\s*=/.test(text) ||
            /\blet\s+\w+\s*=/.test(text) ||
            /\bfunction\s+\w+\s*\(/.test(text) ||
            /\.forEach\s*\(/.test(text) ||
            /\.reduce\s*\(/.test(text) ||
            /#include/.test(text) ||
            /\bint\s+main\s*\(/.test(text) ||
            /\bprintf\s*\(/.test(text) ||
            /\bscanf\s*\(/.test(text)));

      if (looksLikeCode) {
        const cleaned = cleanOCRCode(text);

        const language = guessCodeLanguage(cleaned);

        setCodeLanguage(language);

        const outcome = await repairAndFormat(text, language);

        text = outcome.text;

        setStatus(
          outcome.formatted
            ? `Code extracted · ${language}`
            : `Code extracted · ${language} (formatting skipped)`,
        );
      }

      // ---------------------------------------------------
      // FINAL RESULT
      // ---------------------------------------------------

      setResult(text);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  // -------------------------------------------------------
  // PASTE IMAGE
  // -------------------------------------------------------

  async function pasteImage() {
    try {
      const items = await navigator.clipboard.read();

      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));

        if (type) {
          const blob = await item.getType(type);

          selectFile(
            new File([blob], "pasted-image.png", {
              type,
            }),
          );

          return;
        }
      }

      setStatus("No image found in your clipboard.");
    } catch {
      setStatus("Clipboard access was blocked. Use Ctrl+V or upload instead.");
    }
  }

  // -------------------------------------------------------
  // COPY
  // -------------------------------------------------------

  async function copy() {
    if (!result || copying) {
      return;
    }

    try {
      await navigator.clipboard.writeText(result);

      setCopying(true);

      setStatus("Copied to clipboard.");

      window.setTimeout(() => {
        setCopying(false);
      }, 1800);
    } catch {
      setStatus("Couldn't copy automatically.");
    }
  }

  // -------------------------------------------------------
  // DOWNLOAD
  // -------------------------------------------------------

  function download() {
    if (!result) return;

    const extension =
      codeLanguage === "javascript"
        ? "js"
        : codeLanguage === "typescript"
          ? "ts"
          : codeLanguage === "html"
            ? "html"
            : codeLanguage === "css"
              ? "css"
              : codeLanguage === "c"
                ? "c"
                : "txt";

    const isCode = mode === "code" || codeLanguage !== "javascript";

    const blob = new Blob([result], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;

    a.download = isCode ? `snapextract.${extension}` : "snapextract.txt";

    document.body.appendChild(a);

    a.click();

    a.remove();

    URL.revokeObjectURL(url);

    setStatus("Downloaded successfully.");
  }

  // -------------------------------------------------------
  // CLEAR
  // -------------------------------------------------------

  function clear() {
    setFile(null);

    setPreview("");

    setResult("");

    setStatus("");

    setCopying(false);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  // -------------------------------------------------------
  // UPLOAD SCREEN
  // -------------------------------------------------------

  if (!file) {
    return (
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();

          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <div className="upload-inner">
          <div className="upload-icon">
            <FileImage size={28} />
          </div>

          <h2>Drop a screenshot here</h2>

          <div className="muted">PNG, JPG, WEBP · up to 10 MB</div>

          <div className="actions">
            <button
              className="upload-btn"
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={15} />
              Upload image
            </button>

            <button className="secondary" onClick={pasteImage}>
              <Clipboard size={15} />
              Paste
            </button>
          </div>

          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept="image/*"
            onChange={onChange}
          />

          {status && <div className="status error">{status}</div>}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------
  // RESULT SCREEN
  // -------------------------------------------------------

  return (
    <>
      <div className="preview">
        {/* ------------------------------------------------ */}
        {/* SCREENSHOT */}
        {/* ------------------------------------------------ */}

        <div className="panel">
          <div className="panel-head">
            <span>Screenshot</span>

            <button className="secondary" onClick={clear}>
              <X size={14} />
              Remove
            </button>
          </div>

          <img
            className="preview-image"
            src={preview}
            alt="Uploaded screenshot"
          />
        </div>

        {/* ------------------------------------------------ */}
        {/* RESULT */}
        {/* ------------------------------------------------ */}

        <div className="panel">
          <div className="panel-head">
            <span>Extracted content</span>

            <div className="panel-controls">
              <label className="mode-label">
                Extract as
                <select
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as Mode);

                    setResult("");
                  }}
                >
                  <option value="auto">Auto detect</option>

                  <option value="text">Text</option>

                  <option value="code">Code</option>

                  <option value="table">Table</option>
                </select>
              </label>
            </div>
          </div>

          {/* ------------------------------------------------ */}
          {/* CODE BADGE */}
          {/* ------------------------------------------------ */}

          {result &&
            (mode === "code" ||
              /[{};]/.test(result) ||
              /=>/.test(result) ||
              /console\./.test(result) ||
              /\bconst\s+\w+\s*=/.test(result) ||
              /\.forEach\s*\(/.test(result) ||
              /\.reduce\s*\(/.test(result) ||
              /#include/.test(result) ||
              /\bint\s+main\s*\(/.test(result)) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border, #e5e7eb)",
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "#000000",
                    color: "#ffffff",
                    fontWeight: 600,
                  }}
                >
                  {codeLanguage}
                </span>

                <span
                  style={{
                    opacity: 0.65,
                  }}
                >
                  Editable code
                </span>
              </div>
            )}

          <textarea
            className="result"
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder="Your clean result will appear here…"
            spellCheck={mode !== "code"}
          />
        </div>
      </div>

      {/* -------------------------------------------------- */}
      {/* ACTIONS */}
      {/* -------------------------------------------------- */}

      <div
        className="actions"
        style={{
          justifyContent: "center",
          marginTop: 14,
        }}
      >
        <button className="primary" onClick={extract} disabled={loading}>
          <Sparkles size={16} />

          {loading ? "Extracting…" : "Extract content"}
        </button>

        {result && (
          <>
            {/* -------------------------------------------- */}
            {/* COPY */}
            {/* -------------------------------------------- */}

            <button
              onClick={copy}
              disabled={copying}
              aria-live="polite"
              className="secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                minWidth: 100,
                transition: "all 180ms ease",
                border: copying ? "1px solid #16a34a" : undefined,
                background: copying ? "#dcfce7" : undefined,
                color: copying ? "#15803d" : undefined,
                transform: copying ? "scale(1.03)" : "scale(1)",
                cursor: copying ? "default" : "pointer",
              }}
            >
              {copying ? <Check size={15} /> : <Copy size={15} />}

              {copying ? "Copied!" : "Copy"}
            </button>

            {/* -------------------------------------------- */}
            {/* DOWNLOAD */}
            {/* -------------------------------------------- */}

            <button className="secondary" onClick={download}>
              <Download size={15} />
              Download
            </button>
          </>
        )}
      </div>

      {/* -------------------------------------------------- */}
      {/* STATUS */}
      {/* -------------------------------------------------- */}

      {status && (
        <div className="status" aria-live="polite">
          {status}
        </div>
      )}
    </>
  );
}
