import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { requireAdminApi } from "@/lib/server/require-admin";
import {
  generateDemoPassword,
  buildMagicLink,
  MAGIC_LINK_TTL_SECONDS,
} from "@/lib/server/provision-utils";
import {
  getProvisionedCred,
  updateProvisionedCredPassword,
  setProvisionedCredStatus,
  setProvisionedCredEmailStatus,
  updateProvisionedCredMagicLink,
  deleteProvisionedCred,
} from "@/lib/server/provisioned-creds-repo";
import { renderInviteEmail } from "@/lib/server/invite-email";
import { sendProspectEmail } from "@/lib/server/send-prospect-email";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-password"), password: z.string().min(6).max(72).optional() }),
  z.object({ action: z.literal("revoke") }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("resend") }),
]);

const SENDER_NAME = "Divyansh";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const cred = getProvisionedCred(id);
  if (!cred) return Response.json({ error: "Not found" }, { status: 404 });

  // Best-effort: remove the Clerk user too, then drop the cred row.
  try {
    const client = await clerkClient();
    await client.users.deleteUser(cred.clerkUserId);
  } catch (err) {
    console.warn("[admin/creds delete] Clerk user delete failed:", err instanceof Error ? err.message : err);
  }
  deleteProvisionedCred(id);
  return Response.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const cred = getProvisionedCred(id);
  if (!cred) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const action = parsed.data;

  try {
    const client = await clerkClient();

    if (action.action === "set-password") {
      const password = action.password?.trim() || generateDemoPassword();
      await client.users.updateUser(cred.clerkUserId, { password, skipPasswordChecks: true });
      updateProvisionedCredPassword(id, password);
      return Response.json({ cred: getProvisionedCred(id) });
    }

    if (action.action === "revoke") {
      await client.users.banUser(cred.clerkUserId);
      setProvisionedCredStatus(id, "revoked");
      return Response.json({ cred: getProvisionedCred(id) });
    }

    if (action.action === "reactivate") {
      await client.users.unbanUser(cred.clerkUserId);
      setProvisionedCredStatus(id, "active");
      return Response.json({ cred: getProvisionedCred(id) });
    }

    // resend: mint a fresh 48h magic link and re-send the invite.
    const ticket = await client.signInTokens.createSignInToken({
      userId: cred.clerkUserId,
      expiresInSeconds: MAGIC_LINK_TTL_SECONDS,
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_BASE_URL?.trim() || new URL(req.url).origin;
    const magicLink = buildMagicLink(appUrl, ticket.token);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000).toISOString();
    updateProvisionedCredMagicLink(id, magicLink, expiresAt);

    try {
      const { html, text, subject } = await renderInviteEmail({
        championName: cred.championName,
        dealOwnerName: cred.dealOwnerName,
        senderName: SENDER_NAME,
        loginEmail: cred.loginEmail,
        password: cred.password,
        magicLink,
        loomUrl: process.env.INVITE_LOOM_URL?.trim() || undefined,
      });
      await sendProspectEmail({
        to: [cred.championEmail],
        cc: [cred.dealOwnerEmail, ...cred.cc],
        bcc: cred.bcc,
        subject,
        html,
        text,
        fromName: `${SENDER_NAME} from Actioneer`,
        categories: ["actioneer", "prospect-invite", "resend"],
        customArgs: { credId: cred.id, company: cred.company },
      });
      setProvisionedCredEmailStatus(id, "sent");
    } catch (err) {
      console.error("[admin/creds resend] email failed:", err instanceof Error ? err.message : err);
      setProvisionedCredEmailStatus(id, "failed");
    }
    return Response.json({ cred: getProvisionedCred(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[admin/creds] action ${action.action} failed:`, message);
    return Response.json({ error: "The action could not be completed in Clerk." }, { status: 502 });
  }
}
