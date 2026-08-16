import { NextRequest, NextResponse } from "next/server";

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { getProvider } from "@/lib/provider";

export const runtime = "nodejs";

// ---------------------------------------------------------
// REQUEST VALIDATION
// ---------------------------------------------------------

const requestSchema = z.object({
  image: z.string().min(1),
  mode: z.enum(["auto", "text", "code", "table"]).default("auto"),
});

// ---------------------------------------------------------
// EXTRACTION PROMPT
// ---------------------------------------------------------

const extractionPrompt = `
You are SnapExtract, a highly accurate screenshot-to-text and screenshot-to-code extraction engine.

Your ONLY job is to transcribe what is visible in the screenshot.

GENERAL RULES:

- Extract only visible content.
- Do not summarize.
- Do not explain.
- Do not add commentary.
- Do not invent content.
- Do not remove visible content.
- Preserve the original order.
- Preserve capitalization.
- Preserve numbers exactly.
- Preserve strings exactly.
- Return ONLY the extracted content.

CODE ACCURACY IS EXTREMELY IMPORTANT.

When the image contains programming code, carefully inspect every character.

You MUST preserve:

{ } [ ] ( ) < >
: ; , .
= == === != !==
=> + - * / % && || ! ?

Pay special attention to:

- Curly braces
- Square brackets
- Parentheses
- Colons
- Semicolons
- Commas
- Quotes
- Backticks
- Operators
- Numbers
- Decimal points
- Array syntax
- Object syntax
- Function syntax
- Arrow functions
- Indentation
- Line breaks

IMPORTANT:

Do NOT turn:

10 into 1
10 into 1@
10 into 1e
0 into 8
1500 into 15ee
4000 into 4e00

Numbers must be copied exactly as they appear.

Do not "correct" programming mistakes.
Do not optimize code.
Do not rewrite code.
Do not add missing code.

If the screenshot contains code, preserve the complete structure.

Return ONLY the extracted content.
`;

// ---------------------------------------------------------
// MODE INSTRUCTIONS
// ---------------------------------------------------------

function getModeInstruction(mode: "auto" | "text" | "code" | "table") {
  return {
    auto: `
Determine whether the screenshot contains:

- normal text
- programming code
- a table
- another structured format

Extract it accurately.
`,

    text: `
Treat this primarily as normal text.

Preserve paragraphs, line breaks, punctuation and wording.
`,

    code: `
Treat this as programming code.

Prioritize:

1. Exact characters
2. Numbers
3. Brackets
4. Operators
5. Strings
6. Indentation
7. Line breaks

Never simplify or rewrite the code.
`,

    table: `
Treat this as a table.

Preserve rows, columns, headings and cell values.
`,
  }[mode];
}

// ---------------------------------------------------------
// BASE64 IMAGE PARSER
// ---------------------------------------------------------

function extractBase64Image(image: string) {
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new Error("Invalid image format.");
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

// =========================================================
// OPENAI
// =========================================================

async function extractWithOpenAI(
  image: string,
  mode: "auto" | "text" | "code" | "table",
) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const client = new OpenAI({
    apiKey,
  });

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",

    input: [
      {
        role: "user",

        content: [
          {
            type: "input_text",

            text: `${extractionPrompt}

EXTRACTION MODE:

${getModeInstruction(mode)}`,
          },

          {
            type: "input_image",

            image_url: image,

            detail: "high",
          },
        ],
      },
    ],
  });

  return response.output_text?.trim() || "";
}

// =========================================================
// GEMINI
// =========================================================

async function extractWithGemini(
  image: string,
  mode: "auto" | "text" | "code" | "table",
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const { mimeType, base64 } = extractBase64Image(image);

  const ai = new GoogleGenAI({
    apiKey,
  });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",

    contents: [
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },

      {
        text: `${extractionPrompt}

EXTRACTION MODE:

${getModeInstruction(mode)}`,
      },
    ],
  });

  return response.text?.trim() || "";
}

// =========================================================
// MAIN API
// =========================================================

export async function POST(request: NextRequest) {
  try {
    // -----------------------------------------------------
    // GET CURRENT PROVIDER
    // -----------------------------------------------------

    const provider = await getProvider();

    // -----------------------------------------------------
    // REQUEST DATA
    // -----------------------------------------------------

    const contentType = request.headers.get("content-type") || "";

    let image = "";

    let mode: "auto" | "text" | "code" | "table" = "auto";

    // =====================================================
    // FORM DATA
    // =====================================================

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();

      const file = formData.get("image");

      const formMode = formData.get("mode");

      if (!(file instanceof File)) {
        return NextResponse.json(
          {
            error: "No image was provided.",
          },
          {
            status: 400,
          },
        );
      }

      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          {
            error: "The uploaded file must be an image.",
          },
          {
            status: 400,
          },
        );
      }

      const maxBytes = Number(process.env.MAX_IMAGE_BYTES || 10485760);

      if (file.size > maxBytes) {
        return NextResponse.json(
          {
            error: "Image is too large.",
          },
          {
            status: 413,
          },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      image = `data:${file.type};base64,${buffer.toString("base64")}`;

      if (
        formMode === "auto" ||
        formMode === "text" ||
        formMode === "code" ||
        formMode === "table"
      ) {
        mode = formMode;
      }
    }

    // =====================================================
    // JSON
    // =====================================================
    else {
      const body = await request.json();

      const parsed = requestSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Invalid request.",
          },
          {
            status: 400,
          },
        );
      }

      image = parsed.data.image;

      mode = parsed.data.mode;
    }

    // -----------------------------------------------------
    // IMAGE CHECK
    // -----------------------------------------------------

    if (!image) {
      return NextResponse.json(
        {
          error: "No image was provided.",
        },
        {
          status: 400,
        },
      );
    }

    // =====================================================
    // LOCAL
    // =====================================================

    if (provider === "local") {
      return NextResponse.json(
        {
          success: false,
          provider: "local",
          local: true,
          error: "Local OCR should be processed by the browser.",
        },
        {
          status: 400,
        },
      );
    }

    // =====================================================
    // GEMINI
    // =====================================================

    if (provider === "gemini") {
      const text = await extractWithGemini(image, mode);

      if (!text) {
        return NextResponse.json(
          {
            error: "Gemini could not extract text from this image.",
          },
          {
            status: 422,
          },
        );
      }

      return NextResponse.json({
        success: true,
        provider: "gemini",
        text,
        mode,
      });
    }

    // =====================================================
    // OPENAI
    // =====================================================

    if (provider === "openai") {
      const text = await extractWithOpenAI(image, mode);

      if (!text) {
        return NextResponse.json(
          {
            error: "OpenAI could not extract text from this image.",
          },
          {
            status: 422,
          },
        );
      }

      return NextResponse.json({
        success: true,
        provider: "openai",
        text,
        mode,
      });
    }

    // -----------------------------------------------------
    // UNKNOWN PROVIDER
    // -----------------------------------------------------

    return NextResponse.json(
      {
        error: "Unknown extraction provider.",
      },
      {
        status: 500,
      },
    );
  } catch (error: unknown) {
    console.error("Extraction error:", error);

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: error.message || "Unable to process this image right now.",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json(
      {
        error: "Unable to process this image right now.",
      },
      {
        status: 500,
      },
    );
  }
}
