import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { requireAdminApi } from "@/lib/server/require-admin";
import { DEFAULT_SAMPLE_DATASETS } from "@/lib/datasets/constants";
import {
  companyLoginEmail,
  generateDemoPassword,
  buildMagicLink,
  MAGIC_LINK_TTL_SECONDS,
} from "@/lib/server/provision-utils";
import {
  insertProvisionedCred,
  getProvisionedCred,
  getProvisionedCredByLogin,
  setProvisionedCredEmailStatus,
  type ProvisionedCred,
} from "@/lib/server/provisioned-creds-repo";
import { renderInviteEmail } from "@/lib/server/invite-email";
import { sendProspectEmail } from "@/lib/server/send-prospect-email";

const PersonSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
});

const ProvisionSchema = z.object({
  champion: PersonSchema,
  dealOwner: PersonSchema,
  company: z.string().min(1).max(120),
  industries: z.array(z.string().min(1)).min(1).max(5),
  cc: z.array(z.string().email()).max(10).optional(),
  bcc: z.array(z.string().email()).max(10).optional(),
});

const SENDER_NAME = "Divyansh";

export async function POST(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ProvisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { champion, dealOwner, company, industries, cc, bcc } = parsed.data;

  const known = new Set<string>(DEFAULT_SAMPLE_DATASETS);
  const unknown = industries.filter((i) => !known.has(i));
  if (unknown.length > 0) {
    return Response.json({ error: `Unknown industry: ${unknown.join(", ")}` }, { status: 400 });
  }

  const loginEmail = companyLoginEmail(company);
  if (getProvisionedCredByLogin(loginEmail)) {
    return Response.json(
      { error: `A login already exists for this company (${loginEmail}). Use that cred or change the password from the panel.` },
      { status: 409 },
    );
  }

  const password = generateDemoPassword();

  // 1. Create the Clerk login identity scoped to the chosen industry.
  let clerkUserId: string;
  try {
    const client = await clerkClient();
    const user = await client.users.createUser({
      emailAddress: [loginEmail],
      password,
      skipPasswordChecks: true,
      publicMetadata: {
        onboardingComplete: true,
        isProspect: true,
        restrictDatasets: true,
        selectedSampleDatasets: industries,
        orgName: company,
        role: "prospect",
      },
    });
    clerkUserId = user.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[admin/provision] Clerk createUser failed:", message);
    return Response.json(
      { error: "Could not create the login. The address may already be taken in Clerk." },
      { status: 502 },
    );
  }

  // 2. Mint a 48h magic link (sign-in token consumed by /auth/agent-consume).
  let magicLink: string;
  try {
    const client = await clerkClient();
    const ticket = await client.signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds: MAGIC_LINK_TTL_SECONDS,
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_BASE_URL?.trim() || new URL(req.url).origin;
    magicLink = buildMagicLink(appUrl, ticket.token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[admin/provision] sign-in token failed:", message);
    return Response.json({ error: "Login created, but the magic link could not be minted." }, { status: 502 });
  }

  const now = new Date();
  const cred: ProvisionedCred = {
    id: crypto.randomUUID(),
    clerkUserId,
    loginEmail,
    password,
    company,
    industries,
    championName: champion.name,
    championEmail: champion.email,
    dealOwnerName: dealOwner.name,
    dealOwnerEmail: dealOwner.email,
    cc: cc ?? [],
    bcc: bcc ?? [],
    magicLink,
    magicLinkExpiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_SECONDS * 1000).toISOString(),
    status: "active",
    lastEmailStatus: null,
    createdBy: admin.email,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  insertProvisionedCred(cred);

  // 3. Send the invite. A send failure does NOT fail provisioning — the cred and
  // magic link are saved, and the panel surfaces "failed" so the admin can resend.
  try {
    const { html, text, subject } = await renderInviteEmail({
      championName: champion.name,
      dealOwnerName: dealOwner.name,
      senderName: SENDER_NAME,
      loginEmail,
      password,
      magicLink,
      loomUrl: process.env.INVITE_LOOM_URL?.trim() || undefined,
    });
    await sendProspectEmail({
      to: [champion.email],
      cc: [dealOwner.email, ...(cred.cc ?? [])],
      bcc: cred.bcc,
      subject,
      html,
      text,
      fromName: `${SENDER_NAME} from Actioneer`,
      categories: ["actioneer", "prospect-invite"],
      customArgs: { credId: cred.id, company },
    });
    setProvisionedCredEmailStatus(cred.id, "sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[admin/provision] invite email failed:", message);
    setProvisionedCredEmailStatus(cred.id, "failed");
  }

  return Response.json({ cred: getProvisionedCred(cred.id) }, { status: 201 });
}
