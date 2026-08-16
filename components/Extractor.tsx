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

import initClangFormat, {
  format as clangFormat,
} from "@wasm-fmt/clang-format/web";

type Mode = "auto" | "text" | "code" | "table";

type CodeLanguage = "javascript" | "typescript" | "json" | "html" | "css" | "c";

type ProcessingMode = "original" | "contrast" | "threshold" | "sharp";

/* =========================================================
   LANGUAGE DETECTION
========================================================= */

function guessCodeLanguage(text: string): CodeLanguage {
  // C
  if (
    /#include\s*[<"][a-zA-Z0-9_.]+[">]/.test(text) ||
    /\bint\s+main\s*\(/.test(text) ||
    /\bprintf\s*\(/.test(text) ||
    /\bscanf\s*\(/.test(text)
  ) {
    return "c";
  }

  // HTML
  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    return "html";
  }

  // TypeScript
  if (
    /\b(interface|type)\s+\w+/.test(text) ||
    /:\s*(string|number|boolean)\b/.test(text)
  ) {
    return "typescript";
  }

  // JSON
  if (/^\s*[\[{]/.test(text) && /"\w+"\s*:/.test(text)) {
    return "json";
  }

  // JavaScript
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

/* =========================================================
   IMAGE PREPROCESSING
========================================================= */

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

          if (processing === "original") {
            value = gray;
          }

          if (processing === "contrast") {
            const contrast = mode === "code" || mode === "auto" ? 1.55 : 1.15;

            value = (gray - 128) * contrast + 128;

            value = Math.max(0, Math.min(255, value));
          }

          if (processing === "threshold") {
            const contrast = mode === "code" || mode === "auto" ? 1.7 : 1.2;

            value = (gray - 128) * contrast + 128;

            value = Math.max(0, Math.min(255, value));

            value = value < 175 ? 0 : 255;
          }

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

/* =========================================================
   CODE SCORING
========================================================= */

function scoreCodeResult(text: string): number {
  if (!text.trim()) {
    return -Infinity;
  }

  let score = 0;

  // JavaScript / TypeScript
  if (/const\s+\w+\s*=/.test(text)) score += 25;
  if (/let\s+\w+\s*=/.test(text)) score += 15;
  if (/var\s+\w+\s*=/.test(text)) score += 10;
  if (/function\s+\w+\s*\(/.test(text)) score += 20;
  if (/=>/.test(text)) score += 20;
  if (/console\.\w+\(/.test(text)) score += 15;
  if (/\.forEach\s*\(/.test(text)) score += 15;
  if (/\.reduce\s*\(/.test(text)) score += 15;

  // C
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

  // General code
  if (/[{}]/.test(text)) score += 15;
  if (/\[[\s\S]*\]/.test(text)) score += 15;
  if (/[();]/.test(text)) score += 10;
  if (/["'`]/.test(text)) score += 5;
  if (/\breturn\b/.test(text)) score += 10;
  if (/\bif\s*\(/.test(text)) score += 10;
  if (/\bfor\s*\(/.test(text)) score += 10;

  if (text.split("\n").length >= 3) {
    score += 5;
  }

  // Suspicious OCR
  if (/\b1s\b/.test(text)) score -= 15;
  if (/\bIH\b/.test(text)) score -= 20;
  if (/\b©\b/.test(text)) score -= 15;

  return score;
}

/* =========================================================
   OCR CLEANUP
========================================================= */

function cleanOCRCode(text: string): string {
  let result = text;

  result = result
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // OCR © -> 0 in numeric contexts
  result = result.replace(/(?<=^|[\s,(=;])©(?=\s*[,;)\]}]|$)/gm, "0");

  // Fix spaces around dots
  result = result.replace(
    /(\b[A-Za-z_$][\w$]*)\.\s+([A-Za-z_$][\w$]*)/g,
    "$1.$2",
  );

  // Punctuation spacing
  result = result.replace(/\s+([,;)\]}])/g, "$1");

  result = result.replace(/([([{])\s+/g, "$1");

  // Common OCR array closing problem
  if (
    /(?:const|let|var)\s+\w+\s*=\s*\[/.test(result) &&
    /\b\w+\.forEach\s*\(/.test(result)
  ) {
    result = result.replace(
      /\n\s*(?:IH|1|1;|1s)\s*(?=\n\s*\w+\.forEach\s*\()/g,
      "\n];",
    );
  }

  // Common forEach ending problem
  if (/\b\w+\.forEach\s*\(/.test(result) && /=>\s*\{/.test(result)) {
    result = result.replace(/\n\s*(?:1|1;|1\)|1\);|1s|IH)\s*$/g, "\n});");
  }

  // React component OCR
  result = result.replace(/\)\s*s\s*(?=\s*export\s+default)/g, ")}");

  // C include
  result = result.replace(/#include\s*\n\s*([<"][^>"]+[>"])/g, "#include $1");

  // C return
  result = result.replace(/\breturn\s+©\s*;/g, "return 0;");

  // C loop variable
  result = result.replace(
    /for\s*\(\s*int\s+1\s*=\s*0\s*;\s*i\s*</g,
    "for (int i = 0; i <",
  );

  result = result.replace(/for\s*\(\s*int\s+i\s*=\s*©/g, "for (int i = 0");

  return result.trim();
}

/* =========================================================
   TEMPLATE LITERAL REPAIR
========================================================= */

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

  return result;
}

/* =========================================================
   BRACKET REPAIR
========================================================= */

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

      continue;
    }

    out += ch;
  }

  while (stack.length) {
    out += stack.pop();
  }

  return out;
}

/* =========================================================
   JAVASCRIPT REPAIR
========================================================= */

function repairJavaScript(text: string): string {
  let result = text;

  result = repairTemplateLiteralDelimiters(result);

  result = result.replace(/©(?=\.\d+)/g, "0");

  result = result.replace(
    /^©\s+(?=(return|const|let|var|if|for|while|function)\b)/gm,
    "",
  );

  result = result.replace(/\$%\$/g, "$$");

  result = result.replace(/\}s\}/g, "};}");

  result = result.replace(/=\s*\|\s*$/gm, "= [");

  // OCR numbers at end of forEach
  if (/\.forEach\s*\(/.test(result) && /=>\s*\{/.test(result)) {
    result = result.replace(/\n[ \t]*[0-9]+;?[ \t]*\}[ \t]*$/g, "\n});");
  }

  // Stray OCR 1
  result = result.replace(/\n[ \t]*1;?[ \t]*\n(?=[ \t]*\S)/g, "\n});\n");

  // Orphan ending parenthesis
  result = result.replace(/;\s*\)+\s*$/g, ";");

  result = repairMismatchedBrackets(result);

  return result;
}

/* =========================================================
   TYPESCRIPT REPAIR
========================================================= */

function repairTypeScript(text: string): string {
  return repairJavaScript(text);
}

/* =========================================================
   C REPAIR
========================================================= */

function repairC(text: string): string {
  let result = text;

  // for (int 1 = 0; i < 5; i++)
  result = result.replace(
    /for\s*\(\s*int\s+1\s*=\s*0\s*;\s*i\s*</g,
    "for (int i = 0; i <",
  );

  // for (int i = 0; 1 < 5; i++)
  result = result.replace(
    /for\s*\(\s*int\s+i\s*=\s*0\s*;\s*1\s*<\s*([^;]+);\s*i\s*\)/g,
    "for (int i = 0; i < $1; i++)",
  );

  // Ensure normal C loop header
  result = result.replace(
    /for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*([^;]+);\s*i\s*\)/g,
    "for (int i = 0; i < $1; i++)",
  );

  // OCR "1e" -> "10"
  result = result.replace(
    /\b(\d+)e\b/g,
    (_match, digits: string) => `${digits}0`,
  );

  // return ©
  result = result.replace(/\breturn\s+©\s*;/g, "return 0;");

  // Specific 5-number sequence repair
  result = result.replace(
    /(\{\s*)(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(\s*\})/g,
    (full, opening, a, b, c, d, e, closing) => {
      const values = [Number(a), Number(b), Number(c), Number(d), Number(e)];

      const firstStep = values[1] - values[0];

      const secondStep = values[2] - values[1];

      if (
        firstStep === secondStep &&
        firstStep !== 0 &&
        values[4] === values[0] + firstStep * 4
      ) {
        const expectedFourth = values[0] + firstStep * 3;

        if (values[3] !== expectedFourth) {
          return `${opening}${values[0]}, ${values[1]}, ${values[2]}, ${expectedFourth}, ${values[4]}${closing}`;
        }
      }

      return full;
    },
  );

  result = repairMismatchedBrackets(result);

  return result;
}

/* =========================================================
   LANGUAGE REPAIR
========================================================= */

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

/* =========================================================
   C FORMATTER (fallback, regex-based)

   This is only used if the real clang-format WASM engine
   (see below) fails to load or fails to format the given
   text. It is deliberately forgiving rather than precise.
========================================================= */

function formatCCodeFallback(text: string): string {
  let source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  source = source.replace(/\{/g, "{\n").replace(/\}/g, "\n}\n");

  source = source.replace(
    /;\s*(?=(?:int|char|float|double|printf|scanf|return|if|for|while)\b)/g,
    ";\n",
  );

  const rawLines = source.split("\n");

  const output: string[] = [];

  let indent = 0;

  const INDENT = "    ";

  for (const raw of rawLines) {
    let line = raw.trim();

    if (!line) {
      continue;
    }

    line = line.replace(/[ \t]+/g, " ");
    line = line.replace(/\(\s+/g, "(");
    line = line.replace(/\s+\)/g, ")");
    line = line.replace(/\[\s+/g, "[");
    line = line.replace(/\s+\]/g, "]");

    if (line.startsWith("}")) {
      indent = Math.max(0, indent - 1);
    }

    output.push(`${INDENT.repeat(indent)}${line}`);

    let open = 0;
    let close = 0;

    let inString: string | null = null;

    let escaped = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inString) {
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
        continue;
      }

      if (ch === "/" && line[i + 1] === "/") {
        break;
      }

      if (ch === "{") {
        open++;
      }

      if (ch === "}") {
        close++;
      }
    }

    indent += open - close;

    if (indent < 0) {
      indent = 0;
    }
  }

  // Re-attach a stray closing brace + semicolon, e.g.
  //   }
  //   ;
  // back into "};" — a common artifact of the naive
  // brace-splitting above.
  let joined = output.join("\n");

  joined = joined.replace(/\}\n(\s*);/g, "};");

  // Re-attach "} else" split across lines back into
  // "} else {" on one line.
  joined = joined.replace(/\}\n(\s*)else\b/g, "} else");

  return joined.trim();
}

/* =========================================================
   C FORMATTER (real formatter, via clang-format WASM)

   Uses the actual clang-format engine compiled to WASM
   instead of regex patching, so brace/semicolon/else
   placement is handled correctly by construction.
========================================================= */

let clangFormatReady: Promise<void> | null = null;

async function ensureClangFormat(): Promise<void> {
  if (!clangFormatReady) {
    clangFormatReady = initClangFormat().catch((error) => {
      // Allow retrying on the next call instead of caching a failure.
      clangFormatReady = null;
      throw error;
    });
  }

  return clangFormatReady;
}

async function formatCCode(text: string): Promise<string> {
  try {
    await ensureClangFormat();

    return clangFormat(text, "main.c", "LLVM").trim();
  } catch {
    return formatCCodeFallback(text);
  }
}

/* =========================================================
   GENERAL FORMATTER
========================================================= */

async function formatCode(
  text: string,
  language: CodeLanguage,
): Promise<string> {
  /*
   * C uses the clang-format WASM engine (with a regex
   * fallback if the WASM module can't load).
   */
  if (language === "c") {
    return formatCCode(text);
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

/* =========================================================
   REPAIR + FORMAT
========================================================= */

async function repairAndFormat(
  text: string,
  language: CodeLanguage,
): Promise<{
  text: string;
  formatted: boolean;
}> {
  /*
   * First repair obvious OCR mistakes.
   */
  let repaired = repairByLanguage(text, language);

  /*
   * Then attempt formatting.
   *
   * IMPORTANT:
   *
   * Formatting can reject malformed OCR.
   * We DO NOT let that break extraction.
   *
   * If formatting fails, we return the
   * repaired code instead of displaying:
   *
   * "formatting skipped"
   *
   * as the actual result.
   */
  try {
    const formatted = await formatCode(repaired, language);

    return {
      text: formatted,
      formatted: true,
    };
  } catch {
    /*
     * One more repair attempt.
     */
    repaired = repairByLanguage(repaired, language);

    /*
     * For C, our formatter is deliberately
     * forgiving, so try it again.
     */
    if (language === "c") {
      try {
        return {
          text: await formatCCode(repaired),
          formatted: true,
        };
      } catch {
        // Ignore and return repaired code.
      }
    }

    return {
      text: repaired.trim(),
      formatted: false,
    };
  }
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

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

  /* =======================================================
     WARM UP CLANG-FORMAT

     Kick off the WASM download/init as soon as the
     component mounts so the first C extraction isn't
     slowed down waiting on it.
  ======================================================= */

  useEffect(() => {
    ensureClangFormat().catch(() => {
      // Ignored here; formatCCode() falls back gracefully.
    });
  }, []);

  /* =======================================================
     CLEANUP
  ======================================================= */

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  /* =======================================================
     SELECT FILE
  ======================================================= */

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

    if (preview) {
      URL.revokeObjectURL(preview);
    }

    setFile(next);

    setPreview(URL.createObjectURL(next));

    setResult("");

    setStatus("");

    setCopying(false);
  }

  /* =======================================================
     INPUT
  ======================================================= */

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    selectFile(e.target.files?.[0]);
  }

  /* =======================================================
     DROP
  ======================================================= */

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();

    setDrag(false);

    selectFile(e.dataTransfer.files?.[0]);
  }

  /* =======================================================
     LOCAL OCR
  ======================================================= */

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

  /* =======================================================
     EXTRACT
  ======================================================= */

  async function extract() {
    if (!file) return;

    setLoading(true);

    setStatus("Preparing screenshot…");

    try {
      const providerResponse = await fetch("/api/provider", {
        cache: "no-store",
      });

      const providerData = providerResponse.ok
        ? await providerResponse.json()
        : {
            provider: "local",
          };

      let text = "";

      /* ===================================================
         AI PROVIDER
      =================================================== */

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

      /* ===================================================
         LOCAL OCR
      =================================================== */
      else {
        text = await runLocalOCR(file, mode);

        if (!text) {
          throw new Error("No readable content was detected.");
        }

        setStatus("Local OCR complete.");
      }

      /* ===================================================
         CODE DETECTION
      =================================================== */

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
            /\bscanf\s*\(/.test(text) ||
            /<\/?[a-z][\s\S]*>/i.test(text)));

      if (looksLikeCode) {
        const cleaned = cleanOCRCode(text);

        const language = guessCodeLanguage(cleaned);

        setCodeLanguage(language);

        const outcome = await repairAndFormat(text, language);

        text = outcome.text;

        /*
         * We only mention formatting
         * if it actually failed.
         */
        setStatus(
          outcome.formatted
            ? `Code extracted · ${language}`
            : `Code extracted · ${language} · OCR cleanup applied`,
        );
      }

      setResult(text);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  /* =======================================================
     PASTE IMAGE
  ======================================================= */

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

  /* =======================================================
     COPY
  ======================================================= */

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

  /* =======================================================
     DOWNLOAD
  ======================================================= */

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

  /* =======================================================
     CLEAR
  ======================================================= */

  function clear() {
    if (preview) {
      URL.revokeObjectURL(preview);
    }

    setFile(null);
    setPreview("");
    setResult("");
    setStatus("");
    setCopying(false);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  /* =======================================================
     UPLOAD SCREEN
  ======================================================= */

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

  /* =======================================================
     RESULT SCREEN
  ======================================================= */

  const resultLooksLikeCode =
    mode === "code" ||
    /[{};]/.test(result) ||
    /=>/.test(result) ||
    /console\./.test(result) ||
    /\bconst\s+\w+\s*=/.test(result) ||
    /\.forEach\s*\(/.test(result) ||
    /\.reduce\s*\(/.test(result) ||
    /#include/.test(result) ||
    /\bint\s+main\s*\(/.test(result) ||
    /<\/?[a-z][\s\S]*>/i.test(result);

  return (
    <>
      <div className="preview">
        {/* SCREENSHOT */}

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

        {/* RESULT */}

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

          {/* CODE BADGE */}

          {result && resultLooksLikeCode && (
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

      {/* ACTIONS */}

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
            {/* COPY */}

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

            {/* DOWNLOAD */}

            <button className="secondary" onClick={download}>
              <Download size={15} />
              Download
            </button>
          </>
        )}
      </div>

      {/* STATUS */}

      {status && (
        <div className="status" aria-live="polite">
          {status}
        </div>
      )}
    </>
  );
}
