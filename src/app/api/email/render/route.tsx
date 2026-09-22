import { auth } from "@clerk/nextjs/server";
import { render } from "@react-email/render";
import {
  DEMO_PROPS,
  EMAIL_TEMPLATES,
  getTemplate,
  type MarketingEmailProps,
} from "@/emails";

function mergeSpec(base: MarketingEmailProps, patch: Partial<MarketingEmailProps>): MarketingEmailProps {
  return {
    ...base,
    ...patch,
    hero: { ...base.hero, ...(patch.hero ?? {}) },
    closing: patch.closing
      ? { ...(base.closing ?? ({} as NonNullable<MarketingEmailProps["closing"]>)), ...patch.closing }
      : base.closing,
    footer: { ...(base.footer ?? {}), ...(patch.footer ?? {}) },
    theme: { ...(base.theme ?? {}), ...(patch.theme ?? {}) },
  };
}

export async function GET(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const tpl = getTemplate(url.searchParams.get("template"));
  const Component = tpl.Component;

  const html = await render(<Component {...DEMO_PROPS} />, { pretty: false });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const root = body && typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const templateId = typeof root.template === "string" ? root.template : "marketing";
  const tpl = getTemplate(templateId);
  const Component = tpl.Component;

  const patch = (root.spec ?? body) as Partial<MarketingEmailProps> | null;
  // For user drafts: don't carry over the demo's hero image / images.
  // Caller must explicitly opt-in to a hero bgImage by passing it.
  const cleanBase: MarketingEmailProps = {
    ...DEMO_PROPS,
    hero: { ...DEMO_PROPS.hero, bgImage: "" },
    imageSection: undefined,
    features: undefined,
    closing: undefined,
  };
  const merged = patch ? mergeSpec(cleanBase, patch) : cleanBase;

  const html = await render(<Component {...merged} />, { pretty: false });

  return Response.json({
    html,
    template: tpl.id,
    available: EMAIL_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description })),
  });
}
