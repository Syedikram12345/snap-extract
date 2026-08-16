export type Provider = "local" | "gemini" | "openai";

const DEFAULT_PROVIDER: Provider =
  process.env.DEFAULT_PROVIDER === "gemini"
    ? "gemini"
    : process.env.DEFAULT_PROVIDER === "openai"
      ? "openai"
      : "local";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const PROVIDER_KEY = "snapextract:provider";

let memoryProvider: Provider = DEFAULT_PROVIDER;

function isValidProvider(value: unknown): value is Provider {
  return value === "local" || value === "gemini" || value === "openai";
}

async function upstashCommand(command: unknown[]) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return null;
  }

  const response = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Upstash request failed: ${response.status}`);
  }

  const data = await response.json();

  return data.result;
}

export async function getProvider(): Promise<Provider> {
  /*
   * Production:
   *
   * If Upstash is configured, always read the provider
   * from persistent storage.
   */

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const result = await upstashCommand(["GET", PROVIDER_KEY]);

      if (isValidProvider(result)) {
        return result;
      }
    } catch (error) {
      console.error("Failed to read provider from Upstash:", error);
    }
  }

  /*
   * Fallback for local development / servers without Upstash.
   */

  return memoryProvider;
}

export async function setProvider(provider: Provider): Promise<void> {
  if (!isValidProvider(provider)) {
    throw new Error("Invalid provider.");
  }

  /*
   * Update memory immediately.
   */

  memoryProvider = provider;

  /*
   * Persist globally when Upstash is configured.
   */

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await upstashCommand(["SET", PROVIDER_KEY, provider]);
    } catch (error) {
      console.error("Failed to save provider to Upstash:", error);

      throw new Error("Could not persist provider setting.");
    }
  }
}
