import { requireBdrOperator } from "./access";
export async function bdrRoute(run: (userId: string) => Promise<Response>): Promise<Response> {
  let userId: string;
  try { userId = await requireBdrOperator(); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Access denied." }, { status: 403 }); }
  try { return await run(userId); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to complete this request." }, { status: 400 }); }
}
