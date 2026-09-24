import { z } from "zod/v4";
import type { BdrAudience, BdrContact } from "./types";

const Audience = z.object({ id: z.string(), name: z.string(), contact_count: z.number(), status: z.string() });
const Contact = z.object({
  id: z.string(), first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(), title: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(), do_not_contact: z.boolean().default(false),
});
const Pagination = z.object({ total_pages: z.number().int().nonnegative(), total_count: z.number().int().nonnegative() });

async function monaco(path: string, body?: object): Promise<unknown> {
  const key = process.env.MONACO_API_KEY?.trim();
  if (!key) throw new Error("Add MONACO_API_KEY to the server's Railway variables to connect Monaco.");
  const response = await fetch(`https://api.monaco.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error(`Monaco request failed (${response.status}). Check the server API key and workspace access.`);
  return response.json();
}
function contactFromApi(row: z.infer<typeof Contact>): BdrContact {
  return { id: row.id, firstName: row.first_name || "", lastName: row.last_name || "", company: row.account_name || "", title: row.title || "", phone: row.phone_number || "", doNotContact: row.do_not_contact };
}
export async function listMonacoAudiences(): Promise<BdrAudience[]> {
  const all: BdrAudience[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = z.object({ data: z.array(Audience), pagination: Pagination }).parse(await monaco("/audiences/list", { page, page_size: 100 }));
    all.push(...result.data);
    if (page >= result.pagination.total_pages) return all.filter((row) => row.status !== "archived");
  }
  throw new Error("Too many Monaco audience pages. No partial result was imported.");
}
export async function importMonacoAudience(id: string): Promise<{ audience: BdrAudience; contacts: BdrContact[] }> {
  const { data: audience } = z.object({ data: Audience }).parse(await monaco(`/audiences/${encodeURIComponent(id)}`));
  if (audience.status === "archived") throw new Error("This Monaco audience is archived.");
  const contacts: BdrContact[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = z.object({ data: z.array(Contact), pagination: Pagination }).parse(await monaco(`/audiences/${encodeURIComponent(id)}/contacts?page=${page}&page_size=100`));
    if (result.pagination.total_count > 10_000) throw new Error("Select an audience with at most 10,000 contacts.");
    contacts.push(...result.data.map(contactFromApi));
    if (page >= result.pagination.total_pages) return { audience, contacts: [...new Map(contacts.map((c) => [c.id, c])).values()] };
  }
  throw new Error("Audience pagination exceeded the import limit. No partial import was saved.");
}
export async function getMonacoContact(id: string): Promise<BdrContact> {
  const result = z.object({ data: Contact }).parse(await monaco(`/contacts/${encodeURIComponent(id)}`));
  return contactFromApi(result.data);
}
