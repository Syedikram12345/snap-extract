import fs from "node:fs/promises";
import path from "node:path";

export type Provider = "local" | "openai";

const defaultProvider: Provider =
  process.env.DEFAULT_PROVIDER === "openai" ? "openai" : "local";

const filePath = path.join(process.cwd(), "data", "provider.json");

const REDIS_KEY = "snapextract:provider";

function valid(value: unknown): value is Provider {
  return value === "local" || value === "openai";
}

// ---------------------------------------------------------
// FILE STORAGE
// ---------------------------------------------------------

async function fileGet(): Promise<Provider> {
  try {
    const raw = await fs.readFile(filePath, "utf8");

    const parsed = JSON.parse(raw);

    return valid(parsed.provider) ? parsed.provider : defaultProvider;
  } catch {
    return defaultProvider;
  }
}

async function fileSet(provider: Provider) {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        provider,
      },
      null,
      2,
    ),
    "utf8",
  );
}

// ---------------------------------------------------------
// REDIS CONFIG
// ---------------------------------------------------------

function redisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

// ---------------------------------------------------------
// REDIS GET
// ---------------------------------------------------------

async function redisGet(): Promise<Provider | null> {
  if (!redisConfigured()) {
    return null;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    const response = await fetch(
      `${url}/get/${encodeURIComponent(REDIS_KEY)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },

        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        "Upstash provider GET failed:",
        response.status,
        response.statusText,
      );

      return null;
    }

    const data = (await response.json()) as {
      result?: unknown;
    };

    return valid(data.result) ? data.result : null;
  } catch (error) {
    console.error("Upstash provider GET error:", error);

    return null;
  }
}

// ---------------------------------------------------------
// REDIS SET
// ---------------------------------------------------------

async function redisSet(provider: Provider): Promise<boolean> {
  if (!redisConfigured()) {
    return false;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    const response = await fetch(
      `${url}/set/${encodeURIComponent(REDIS_KEY)}/${provider}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },

        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        "Upstash provider SET failed:",
        response.status,
        response.statusText,
      );

      return false;
    }

    return true;
  } catch (error) {
    console.error("Upstash provider SET error:", error);

    return false;
  }
}

// ---------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------

export async function getProvider(): Promise<Provider> {
  /*
   * Production:
   *
   * Upstash Redis
   *
   * Local development:
   *
   * provider.json
   */

  const remote = await redisGet();

  if (remote) {
    return remote;
  }

  return fileGet();
}

export async function setProvider(provider: Provider): Promise<Provider> {
  if (!valid(provider)) {
    throw new Error("Invalid provider");
  }

  /*
   * Prefer Redis whenever it is configured.
   *
   * If Redis is not configured, use the local JSON file.
   */

  const storedRemotely = await redisSet(provider);

  if (!storedRemotely) {
    await fileSet(provider);
  }

  return provider;
}
