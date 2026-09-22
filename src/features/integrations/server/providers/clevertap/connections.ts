import { clerkClient } from "@clerk/nextjs/server";

export interface CleverTapConnection {
  accountId: string;
  passcode: string;
  apiBase: string;
  adminEmail?: string;
  testEmails?: string[];
  projectName?: string;
  region?: string;
  connectedAt: string;
}

interface IntegrationsMetadata {
  clevertap?: CleverTapConnection;
}

type PrivateMetadataWithIntegrations = {
  integrations?: IntegrationsMetadata;
  [key: string]: unknown;
};

async function readPrivateMetadata(userId: string): Promise<PrivateMetadataWithIntegrations> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return (user.privateMetadata as PrivateMetadataWithIntegrations) ?? {};
}

export async function getCleverTapConnection(userId: string): Promise<CleverTapConnection | null> {
  const meta = await readPrivateMetadata(userId);
  return meta.integrations?.clevertap ?? null;
}

export async function saveCleverTapConnection(
  userId: string,
  conn: CleverTapConnection,
): Promise<void> {
  const client = await clerkClient();
  const meta = await readPrivateMetadata(userId);
  const nextIntegrations: IntegrationsMetadata = {
    ...(meta.integrations ?? {}),
    clevertap: conn,
  };
  await client.users.updateUser(userId, {
    privateMetadata: { ...meta, integrations: nextIntegrations },
  });
}

export async function removeCleverTapConnection(userId: string): Promise<void> {
  const client = await clerkClient();
  const meta = await readPrivateMetadata(userId);
  const nextIntegrations: IntegrationsMetadata = { ...(meta.integrations ?? {}) };
  delete nextIntegrations.clevertap;
  await client.users.updateUser(userId, {
    privateMetadata: { ...meta, integrations: nextIntegrations },
  });
}

export interface MaskedCleverTapConnection {
  accountId: string;
  apiBase: string;
  passcodeLast4: string;
  adminEmail?: string;
  testEmails?: string[];
  projectName?: string;
  region?: string;
  connectedAt: string;
}

export function maskCleverTapConnection(conn: CleverTapConnection): MaskedCleverTapConnection {
  return {
    accountId: conn.accountId,
    apiBase: conn.apiBase,
    passcodeLast4: conn.passcode.slice(-4),
    adminEmail: conn.adminEmail,
    testEmails: conn.testEmails,
    projectName: conn.projectName,
    region: conn.region,
    connectedAt: conn.connectedAt,
  };
}
