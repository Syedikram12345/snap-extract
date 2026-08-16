import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

const requestSchema = z.object({
  image: z.string().min(1),
  mode: z.enum(["auto", "text", "code", "table"]).default("auto"),
});

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
" ' \`

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

If the screenshot contains:

const users = [
  { name: "John", age: 20 },
  { name: "Sarah", age: 21 }
];

the output must preserve the complete structure.

Return ONLY the extracted content.
`;

export async function POST(request: NextRequest) {
  try {
    // -----------------------------------------------------
    // CHECK OPENAI CONFIGURATION
    // -----------------------------------------------------

    /*
     * IMPORTANT:
     *
     * We intentionally create the OpenAI client ONLY after
     * checking for the API key.
     *
     * This allows the application to build successfully
     * without an OpenAI API key.
     *
     * Local OCR does not require OpenAI.
     */

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "OpenAI API key is not configured. Use Local OCR or configure OPENAI_API_KEY.",
        },
        { status: 503 },
      );
    }

    const client = new OpenAI({
      apiKey,
    });

    // -----------------------------------------------------
    // READ REQUEST
    // -----------------------------------------------------

    /*
     * Support BOTH:
     *
     * 1. multipart/form-data
     * 2. JSON
     */

    const contentType = request.headers.get("content-type") || "";

    let image = "";

    let mode: "auto" | "text" | "code" | "table" = "auto";

    // -----------------------------------------------------
    // FORM DATA
    // -----------------------------------------------------

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();

      const file = formData.get("image");

      const formMode = formData.get("mode");

      if (!(file instanceof File)) {
        return NextResponse.json(
          {
            error: "No image was provided.",
          },
          { status: 400 },
        );
      }

      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          {
            error: "The uploaded file must be an image.",
          },
          { status: 400 },
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

    // -----------------------------------------------------
    // JSON
    // -----------------------------------------------------
    else {
      const body = await request.json();

      const parsed = requestSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Invalid request.",
          },
          { status: 400 },
        );
      }

      image = parsed.data.image;

      mode = parsed.data.mode;
    }

    // -----------------------------------------------------
    // VALIDATE IMAGE
    // -----------------------------------------------------

    if (!image) {
      return NextResponse.json(
        {
          error: "No image was provided.",
        },
        { status: 400 },
      );
    }

    // -----------------------------------------------------
    // MODE INSTRUCTIONS
    // -----------------------------------------------------

    const modeInstruction = {
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

    // -----------------------------------------------------
    // OPENAI REQUEST
    // -----------------------------------------------------

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

${modeInstruction}`,
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

    // -----------------------------------------------------
    // GET RESULT
    // -----------------------------------------------------

    const text = response.output_text?.trim();

    if (!text) {
      return NextResponse.json(
        {
          error: "No text could be extracted from this image.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      text,
      mode,
    });
  } catch (error: unknown) {
    console.error("Extraction error:", error);

    // -----------------------------------------------------
    // OPENAI QUOTA ERROR
    // -----------------------------------------------------

    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (errorCode === "insufficient_quota") {
      return NextResponse.json(
        {
          error:
            "Your OpenAI account has no remaining quota. Check your OpenAI billing. This isn't a code issue.",

          quotaExceeded: true,
        },
        { status: 429 },
      );
    }

    // -----------------------------------------------------
    // GENERAL ERROR
    // -----------------------------------------------------

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: error.message || "Unable to process this image right now.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        error: "Unable to process this image right now.",
      },
      { status: 500 },
    );
  }
}
