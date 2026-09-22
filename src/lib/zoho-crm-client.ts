// src/lib/zoho-crm-client.ts

const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.in";
const ZOHO_ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.in";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
  });
  const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    body: params,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!data.access_token) throw new Error(`Zoho token error: ${JSON.stringify(data)}`);
  cachedToken = {
    value: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  };
  return cachedToken.value;
}

async function zohoGet(path: string): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v2/${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const text = await res.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

async function zohoPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v2/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function findContactByPhone(phone: string): Promise<string | null> {
  const data = await zohoGet(
    `Contacts/search?criteria=((Phone:equals:${encodeURIComponent(phone)}))`,
  );
  return ((data?.data as Array<{ id: string }>)?.[0]?.id) ?? null;
}

async function findContactByUserId(userId: string): Promise<string | null> {
  const data = await zohoGet(
    `Contacts/search?criteria=((CF_Customer_ID:equals:${encodeURIComponent(userId)}))`,
  );
  return ((data?.data as Array<{ id: string }>)?.[0]?.id) ?? null;
}

async function createLead(phone: string, userId: string): Promise<string> {
  const data = await zohoPost("Leads", {
    data: [{ Last_Name: phone, Phone: phone, CF_Customer_ID: userId }],
  });
  return ((data?.data as Array<{ details: { id: string } }>)?.[0]?.details?.id) ?? "";
}

async function resolveOrCreateRecord(
  phone: string,
  userId: string,
): Promise<{ module: "Contacts" | "Leads"; id: string }> {
  const byPhone = await findContactByPhone(phone);
  if (byPhone) return { module: "Contacts", id: byPhone };

  const byUserId = await findContactByUserId(userId);
  if (byUserId) return { module: "Contacts", id: byUserId };

  const leadId = await createLead(phone, userId);
  return { module: "Leads", id: leadId };
}

export interface ZohoCrmPushInput {
  campaignId: string;
  callId: string;
  campaignName: string;
  phone: string;
  userId: string;
  summary: string;
  nextStep: string | null;
  callbackPreference: string | null;
  outcome: string;
  recordingUrl?: string;
  baseUrl: string;
}

export async function pushCallToZohoCrm(input: ZohoCrmPushInput): Promise<void> {
  const { module, id } = await resolveOrCreateRecord(input.phone, input.userId);

  const callUrl = `${input.baseUrl}/voice-campaigns/${input.campaignId}/calls/${input.callId}`;
  const date = new Date().toLocaleDateString("en-IN");

  const noteLines = [
    `Summary: ${input.summary}`,
    "",
    ...(input.nextStep ? [`Next Step: ${input.nextStep}`, ""] : []),
    `Callback Preference: ${input.callbackPreference ?? "Not mentioned"}`,
    `Outcome: ${input.outcome}`,
    "",
    "---",
    `Call Details: ${callUrl}`,
    ...(input.recordingUrl ? [`Recording: ${input.recordingUrl}`] : []),
  ];

  await zohoPost("Notes", {
    data: [
      {
        Note_Title: `Voice Call – ${input.campaignName} – ${date}`,
        Note_Content: noteLines.join("\n"),
        Parent_Id: id,
        $se_module: module,
      },
    ],
  });

  if (input.callbackPreference) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);
    await zohoPost("Tasks", {
      data: [
        {
          Subject: `Callback – ${input.phone}`,
          Description: `Customer preferred: "${input.callbackPreference}"`,
          Status: "Not Started",
          Due_Date: dueDate.toISOString().split("T")[0],
          ...(module === "Contacts" ? { Who_Id: { id } } : {}),
        },
      ],
    });
  }
}
