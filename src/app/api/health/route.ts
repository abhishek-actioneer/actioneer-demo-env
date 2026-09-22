import { isDBReady } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const datasetId = url.searchParams.get("datasetId") || undefined;
  const dbReady = await isDBReady(datasetId);

  // Debug: check which env vars are present (values redacted)
  const envCheck = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL || "(not set)",
    OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL || "(not set)",
    CLERK_SECRET_KEY: !!process.env.CLERK_SECRET_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    VOICE_STORAGE_DIR: process.env.VOICE_STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "(not set)",
    DUCKDB_MEMORY_LIMIT: process.env.DUCKDB_MEMORY_LIMIT || "(not set)",
    DUCKDB_THREADS: process.env.DUCKDB_THREADS || "(not set)",
    NODE_ENV: process.env.NODE_ENV || "(not set)",
    RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN || "(not set)",
  };

  return Response.json({ dbReady, env: envCheck });
}
