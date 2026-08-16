import fs from "node:fs/promises";
import path from "node:path";

export type Provider = "local" | "openai";

const defaultProvider: Provider = process.env.DEFAULT_PROVIDER === "openai" ? "openai" : "local";
const filePath = path.join(process.cwd(), "data", "provider.json");

function valid(value: unknown): value is Provider {
  return value === "local" || value === "openai";
}

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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ provider }, null, 2), "utf8");
}

async function redisGet(): Promise<Provider | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(`${url}/get/snapextract:provider`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Provider store unavailable");
  const data = await response.json() as { result?: unknown };
  return valid(data.result) ? data.result : null;
}

async function redisSet(provider: Provider): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  const response = await fetch(`${url}/set/snapextract:provider/${provider}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Provider store unavailable");
  return true;
}

export async function getProvider(): Promise<Provider> {
  const remote = await redisGet();
  if (remote) return remote;
  return fileGet();
}

export async function setProvider(provider: Provider): Promise<Provider> {
  if (!valid(provider)) throw new Error("Invalid provider");
  const storedRemotely = await redisSet(provider);
  if (!storedRemotely) await fileSet(provider);
  return provider;
}
