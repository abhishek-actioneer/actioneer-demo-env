import OpenAI from "openai";

let _client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required but missing from environment");
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}
