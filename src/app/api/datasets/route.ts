import { auth, clerkClient } from "@clerk/nextjs/server";
import { getAllDatasetsForUser, getDataset, DEFAULT_DATASET } from "@/lib/datasets";
import { deleteDynamicDataset } from "@/lib/datasets/dynamic-registry";
import { isTeamEmail } from "@/lib/auth-domain";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Read user's selected sample datasets from Clerk metadata.
  // [] = user chose no samples (show none). Default-DENY: assume restricted until
  // we can prove the caller is an internal team member.
  let selectedSampleIds: string[] | undefined;
  // Prospect accounts set restrictDatasets:true so their workspace shows ONLY
  // the single industry chosen in the admin panel.
  let restrictToSelected = true;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const meta = user.publicMetadata as
      | { selectedSampleDatasets?: string[]; restrictDatasets?: boolean }
      | undefined;
    if (Array.isArray(meta?.selectedSampleDatasets)) {
      selectedSampleIds = meta.selectedSampleDatasets;
    }
    // Locked to their chosen dataset unless they are an internal team member
    // (@actioneer.com / @gameramp.com). Trust the primary email ONLY if it is
    // verified — an unverified address must never unlock switching.
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    const verifiedEmail =
      primary?.verification?.status === "verified" ? primary.emailAddress : undefined;
    restrictToSelected = meta?.restrictDatasets === true || !isTeamEmail(verifiedEmail);
  } catch {
    // Clerk lookup failed — fail CLOSED: we cannot prove the caller is team, so
    // restrict (the fallback to a single dataset happens just below).
    restrictToSelected = true;
  }

  // Fail closed: a restricted caller with no concrete selection (Clerk error, or
  // metadata never written) is pinned to the default dataset — never "show all".
  if (restrictToSelected && !Array.isArray(selectedSampleIds)) {
    selectedSampleIds = [DEFAULT_DATASET];
  }

  const datasets = getAllDatasetsForUser(userId, selectedSampleIds, restrictToSelected);
  // Strip non-serializable fields (viewSQL is a function)
  const serializable = datasets.map(({ viewSQL, ...rest }) => {
    void viewSQL;
    return rest;
  });
  return Response.json(serializable);
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = (await req.json()) as { id: string };
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  // Verify ownership — only the uploader can delete their dataset
  const ds = getDataset(id);
  if (ds.ownerId && ds.ownerId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!ds.isDynamic) {
    return Response.json({ error: "Cannot delete built-in datasets" }, { status: 400 });
  }

  const deleted = deleteDynamicDataset(id);
  if (!deleted) {
    return Response.json({ error: "Dataset not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
