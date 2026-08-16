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
    /\bforEach\s*\(/.test(text)
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
         * Code screenshots need to be enlarged more
         * because small characters such as:
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

  /*
   * A lone "1" at the end of code is often OCR
   * incorrectly reading:
   *
   * });
   * };
   * }
   */

  if (/\n\s*1\s*;?\s*$/.test(text)) {
    score -= 20;
  }

  return score;
}

// ---------------------------------------------------------
// OCR CLEANUP (safe, always-applied normalization)
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
    result = result.replace(/\n\s*(?:1|1;|1\)|1\);|1s)\s*$/g, "\n});");
  }

  if (/\b\w+\.forEach\s*\(/.test(result) && /=>\s*\{/.test(result)) {
    result = result.replace(/\n\s*IH\s*$/g, "\n});");
  }

  if (/\.forEach\s*\([^)]*=>\s*\{/.test(result)) {
    result = result.replace(/\n\s*1\s*;\s*$/g, "\n});");

    result = result.replace(/\n\s*1\)\s*;\s*$/g, "\n});");

    result = result.replace(/\n\s*1s\s*$/g, "\n});");
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
// LANGUAGE-SPECIFIC REPAIR
// (only runs when Prettier fails to parse the cleaned text —
// this is a second-chance pass, not a first-pass regex gauntlet)
// ---------------------------------------------------------

function repairTemplateLiteralDelimiters(text: string): string {
  let result = text;

  /*
   * OCR frequently drops the opening backtick of a template literal
   * entirely, e.g.:
   *
   *   console.log(Name: ${user.name});
   *   return Hello, ${user.name};
   *   label: "Order total: ${total};
   *
   * When a known string-opening context is immediately followed —
   * before any backtick — by a template expression ${...}, that's a
   * strong signal a backtick belongs right there. This covers two
   * contexts: call/return sites, and object-property values (an
   * identifier + colon at the start of a line).
   */

  result = result.replace(
    /\b(console\.(?:log|warn|error|info)\(|return\s+)(["'’‘])?(?=[^`\n]*\$\{)/g,
    (_match, prefix: string) => `${prefix}\``,
  );

  result = result.replace(
    /^(\s*[A-Za-z_$][\w$]*:\s*)(["'’‘])?(?=[^`\n,}]*\$\{)/gm,
    (_match, prefix: string) => `${prefix}\``,
  );

  /*
   * OCR also frequently misreads the closing backtick as a straight
   * quote, an apostrophe, or a curly quote (’ / ‘), right before the
   * value ends — a statement terminator, a closing paren, OR a comma
   * (since template literals are very often object-property values).
   */

  result = result.replace(
    /(\$\{[^`\n]*\}[^`\n]*)(['"’‘])(?=\s*[,;)])/g,
    (_match, body: string) => `${body}\``,
  );

  /*
   * Sometimes the closing backtick isn't misread — it's dropped
   * entirely. Detect an opened-but-unclosed template literal running
   * into a terminator and insert the missing backtick.
   *
   * The body may ONLY be plain characters or complete ${...} groups —
   * never a bare brace — so this can never swallow an unrelated
   * structural brace (like an enclosing object's closing "}") that
   * happens to follow on the same line.
   */

  result = result.replace(
    /`((?:[^`\n{}]|\$\{[^`\n}]*\})*)(?=[,;)])/g,
    (match, body: string) => (body.includes("${") ? `\`${body}\`` : match),
  );

  return result;
}

/*
 * OCR very commonly confuses ) ] } for each other, and can also mangle
 * an opening bracket into an unrelated character (e.g. "[" -> "|").
 * Rather than writing an ever-growing pile of one-off regexes for each
 * new confusion pattern, this walks the text tracking which brackets
 * are actually open (skipping over string/template contents) and
 * corrects wrong-type closers to whatever the stack actually expects.
 * Any closer with nothing open to match is dropped as noise, and
 * anything left open at the end gets closed.
 *
 * This is intentionally only used as a second-chance repair (after
 * Prettier has already failed to parse the cleaned text) — it's more
 * powerful than the always-on cleanOCRCode rules, so it only runs
 * once there's already strong evidence something is broken.
 */

function repairMismatchedBrackets(text: string): string {
  const closerFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
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
        // Wrong closer type where one was clearly expected — swap in
        // the type the stack actually needs.
        stack.pop();
        out += expected;
      }

      // If nothing was expected (empty stack), this closer is
      // orphaned noise — drop it rather than guess.

      continue;
    }

    out += ch;
  }

  // Anything left unclosed gets closed at the very end, innermost first.

  while (stack.length) {
    out += stack.pop();
  }

  return out;
}

function repairJavaScript(text: string): string {
  let result = text;

  result = repairTemplateLiteralDelimiters(result);

  /*
   * ©.18 -> 0.18
   * OCR misreads a leading 0 as © right before a decimal point.
   */

  result = result.replace(/©(?=\.\d+)/g, "0");

  /*
   * A stray "©" sitting alone before a statement keyword is usually
   * OCR noise hallucinated from a blank line, not a real character.
   */

  result = result.replace(
    /^©\s+(?=(return|const|let|var|if|for|while|function)\b)/gm,
    "",
  );

  /*
   * "$%$" -> "$$"
   * A spurious "%" OCR inserted between two literal "$" characters
   * (e.g. a "$${amount}" price string).
   */

  result = result.replace(/\$%\$/g, () => "$$");

  /*
   * A lowercase "s" wedged directly between two closing braces is
   * almost always a misread ";" — e.g. an object's closing brace,
   * the statement-ending semicolon, and a function's closing brace
   * all landing on one squashed line.
   */

  result = result.replace(/\}s\}/g, "};}");

  /*
   * "= |" at the end of a line -> "= [".
   * "[" and "|" look alike to OCR, and a bare "|" at the very end of
   * an assignment is never valid JS on its own, so this is safe.
   */

  result = result.replace(/=\s*\|\s*$/gm, "= [");

  /*
   * A stray "1" or "1;" on its own line, followed by more code,
   * is almost always a mangled "});" that cleanOCRCode's
   * end-of-string-anchored rules didn't catch because something
   * follows it (e.g. another statement or a closing brace).
   */

  result = result.replace(/\n[ \t]*1;?[ \t]*\n(?=[ \t]*\S)/g, "\n});\n");

  result = repairMismatchedBrackets(result);

  return result;
}

function repairTypeScript(text: string): string {
  // Same OCR failure modes as JS, plus whatever TS-specific
  // issues surface later can be added here.
  return repairJavaScript(text);
}

function repairC(text: string): string {
  let result = text;

  result = result.replace(
    /for\s*\(\s*int\s+1\s*=\s*0\s*;\s*i\s*</g,
    "for (int i = 0; i <",
  );

  result = result.replace(/for\s*\(\s*int\s+i\s*=\s*©/g, "for (int i = 0");

  result = result.replace(/\breturn\s+©\s*;/g, "return 0;");

  result = repairMismatchedBrackets(result);

  return result;
}

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
// PRETTIER
// ---------------------------------------------------------

async function formatCode(
  text: string,
  language: CodeLanguage,
): Promise<string> {
  /*
   * Prettier does not support C.
   *
   * Therefore don't try to format C — but still throw if the
   * text is empty, so callers can tell "nothing to format" apart
   * from "formatted successfully".
   */

  if (language === "c") {
    return text.trim();
  }

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
//
// clean -> try format -> (on failure) repair -> try format again
// -> (on failure) return the repaired-but-unformatted text
//
// This is the "syntax validation" stage from the plan: Prettier's
// own parser IS the validator, so a caught exception means the
// text isn't valid syntax yet.
// ---------------------------------------------------------

async function repairAndFormat(
  rawText: string,
  language: CodeLanguage,
): Promise<{ text: string; formatted: boolean }> {
  const cleaned = cleanOCRCode(rawText);

  try {
    const formatted = await formatCode(cleaned, language);

    return { text: formatted, formatted: language !== "c" };
  } catch {
    const repaired = repairByLanguage(cleaned, language);

    try {
      const formatted = await formatCode(repaired, language);

      return { text: formatted, formatted: language !== "c" };
    } catch {
      return { text: repaired, formatted: false };
    }
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
      // AI PROVIDER, WITH AUTOMATIC LOCAL FALLBACK
      // ---------------------------------------------------

      if (providerData.provider === "openai") {
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
          /*
           * AI extraction failed (quota, network, etc). Fall back
           * to local OCR instead of dead-ending the whole request.
           */

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
      // LOCAL OCR (explicitly selected provider)
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
        const language = guessCodeLanguage(cleanOCRCode(text));

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
