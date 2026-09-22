import { auth } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { url } = (await req.json()) as { url: string };

  if (!url) {
    return Response.json({ error: "URL is required" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return Response.json({ error: "A valid URL is required" }, { status: 400 });
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return Response.json({ error: "Only public HTTP and HTTPS URLs are supported" }, { status: 400 });
  }
  if (isPrivateHostname(parsedUrl.hostname)) {
    return Response.json({ error: "Private and local network URLs are not supported" }, { status: 400 });
  }

  try {
    const res = await fetch(parsedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Actioneer/1.0)",
        Accept: "text/html,text/plain,text/markdown,application/json,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return Response.json(
        { error: `Failed to fetch: ${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();

    // For HTML content, strip tags to get plain text
    let text: string;
    if (contentType.includes("html")) {
      text = stripHtml(raw);
    } else {
      text = raw;
    }

    // Truncate if too large (100k chars)
    if (text.length > 100000) {
      text = text.slice(0, 100000) + "\n\n[Content truncated — too large]";
    }

    return Response.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function stripHtml(html: string): string {
  // Remove script/style blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove nav, header, footer
  text = text.replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, "");
  // Convert common block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}
