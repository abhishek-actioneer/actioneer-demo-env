import { auth, clerkClient } from "@clerk/nextjs/server";
import { DEFAULT_SAMPLE_DATASETS } from "@/lib/datasets/constants";
import { renderWelcomeEmail } from "@/lib/server/welcome-email";
import { sendProspectEmail } from "@/lib/server/send-prospect-email";

const KNOWN_SAMPLE_IDS = new Set<string>(DEFAULT_SAMPLE_DATASETS as readonly string[]);

const CALENDLY_URL = process.env.CALENDLY_URL?.trim() || "https://calendly.com/aneriya/actioneer-intro";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    role?: string;
    orgName?: string;
    selectedSampleDatasets?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const prev = (user.publicMetadata ?? {}) as {
      onboardingComplete?: boolean;
      restrictDatasets?: boolean;
      selectedSampleDatasets?: string[];
      role?: string;
      orgName?: string;
      welcomeEmailSent?: boolean;
    };

    // Validate the requested selection against known sample ids (drop anything
    // unknown) so a client cannot inject arbitrary dataset ids into metadata.
    const requested = Array.isArray(body.selectedSampleDatasets) ? body.selectedSampleDatasets : [];
    const validSelection = requested.filter((id) => KNOWN_SAMPLE_IDS.has(id));

    // The dataset selection is WRITE-ONCE, and admin-provisioned restrictions are
    // immutable here: once onboarded (or for a restrictDatasets prospect) the
    // selection cannot be changed by re-POSTing — that was a lock-bypass vector.
    const frozen = prev.onboardingComplete === true || prev.restrictDatasets === true;
    const selectedSampleDatasets = frozen ? prev.selectedSampleDatasets ?? [] : validSelection;

    // Send a one-time welcome email from Divyansh. Best-effort: a failure here
    // must never block onboarding completion, and we only ever send it once.
    let welcomeEmailSent = prev.welcomeEmailSent === true;
    if (!welcomeEmailSent) {
      try {
        const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
        const to = primary?.emailAddress;
        if (to) {
          const { html, text, subject } = await renderWelcomeEmail({
            name: user.firstName ?? user.fullName ?? undefined,
            calendlyUrl: CALENDLY_URL,
          });
          await sendProspectEmail({
            to: [to],
            subject,
            html,
            text,
            fromName: "Divyansh from Actioneer",
            categories: ["actioneer", "onboarding-welcome"],
          });
          welcomeEmailSent = true;
        }
      } catch (err) {
        console.error("[onboarding/complete] welcome email failed:", err);
      }
    }

    await client.users.updateUser(userId, {
      publicMetadata: {
        ...prev, // preserve restrictDatasets and any other existing metadata
        onboardingComplete: true,
        role: body.role || prev.role || undefined,
        orgName: body.orgName || prev.orgName || undefined,
        selectedSampleDatasets,
        welcomeEmailSent,
      },
    });
  } catch (err) {
    console.error("[onboarding/complete] Failed to update Clerk metadata:", err);
    return Response.json({ error: "Failed to save onboarding data" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
