import { Cursor } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) throw new Error("CURSOR_API_KEY is required");

const models = await Cursor.models.list({ apiKey });
console.log(JSON.stringify(models, null, 2));
