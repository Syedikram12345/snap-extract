export type Provider = "local" | "gemini" | "openai";

const DEFAULT_PROVIDER: Provider =
  process.env.DEFAULT_PROVIDER === "gemini"
    ? "gemini"
    : process.env.DEFAULT_PROVIDER === "openai"
      ? "openai"
      : "local";

let memoryProvider: Provider = DEFAULT_PROVIDER;

export async function getProvider(): Promise<Provider> {
  return memoryProvider;
}

export async function setProvider(provider: Provider): Promise<void> {
  memoryProvider = provider;
}
