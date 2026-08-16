import { Redis } from "@upstash/redis";

export type Provider = "local" | "gemini" | "openai";

const DEFAULT_PROVIDER: Provider =
  process.env.DEFAULT_PROVIDER === "gemini"
    ? "gemini"
    : process.env.DEFAULT_PROVIDER === "openai"
      ? "openai"
      : "local";

const PROVIDER_KEY = "snapextract:provider";

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return new Redis({
    url,
    token,
  });
}

export async function getProvider(): Promise<Provider> {
  const redis = getRedis();

  // -------------------------------------------------------
  // PRODUCTION / UPSTASH
  // -------------------------------------------------------

  if (redis) {
    const saved = await redis.get<string>(PROVIDER_KEY);

    if (saved === "local" || saved === "gemini" || saved === "openai") {
      return saved;
    }

    return DEFAULT_PROVIDER;
  }

  // -------------------------------------------------------
  // LOCAL DEVELOPMENT FALLBACK
  // -------------------------------------------------------

  return DEFAULT_PROVIDER;
}

export async function setProvider(provider: Provider): Promise<void> {
  const redis = getRedis();

  if (redis) {
    await redis.set(PROVIDER_KEY, provider);
    return;
  }

  console.warn(
    "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not configured. Provider was not persisted.",
  );
}
