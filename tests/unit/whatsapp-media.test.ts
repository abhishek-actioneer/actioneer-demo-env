import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendWhatsAppSessionMedia,
  sendWhatsAppSessionText,
  sendWhatsAppTemplate,
} from "@/features/integrations/server/providers/gupshup/whatsapp-client";

const IMAGE = "https://example.test/assets/offer.png";

/** Capture the form Gupshup would have received, without hitting the network. */
function captureFetch() {
  const calls: Array<{ url: string; fields: Record<string, string> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: URLSearchParams }) => {
      calls.push({
        url: String(url),
        fields: Object.fromEntries(new URLSearchParams(init.body).entries()),
      });
      return new Response(JSON.stringify({ status: "submitted", messageId: "msg-1" }), {
        status: 200,
      });
    }),
  );
  return calls;
}

function messageField(fields: Record<string, string>): Record<string, unknown> {
  return JSON.parse(fields.message);
}

describe("WhatsApp media sends", () => {
  let calls: ReturnType<typeof captureFetch>;

  beforeEach(() => {
    process.env.GUPSHUP_WHATSAPP_API_KEY = "sk_test";
    process.env.GUPSHUP_WHATSAPP_SOURCE = "919991990651";
    process.env.GUPSHUP_WHATSAPP_APP_NAME = "TestApp";
    process.env.GUPSHUP_WHATSAPP_TEMPLATE_ID = "tpl-1";
    calls = captureFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GUPSHUP_WHATSAPP_TEMPLATE_ID;
  });

  describe("session endpoint (/msg)", () => {
    it("sends an image as originalUrl + previewUrl + caption", async () => {
      await sendWhatsAppSessionMedia("+91 99819 99999", {
        type: "image",
        url: IMAGE,
        caption: "Your EMI details",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.gupshup.io/wa/api/v1/msg");
      expect(calls[0].fields.destination).toBe("919981999999");
      expect(messageField(calls[0].fields)).toEqual({
        type: "image",
        originalUrl: IMAGE,
        // Falls back to the image itself when no explicit thumbnail is given.
        previewUrl: IMAGE,
        caption: "Your EMI details",
      });
    });

    it("uses `url`, not `originalUrl`, for non-image types", async () => {
      await sendWhatsAppSessionMedia("919981999999", { type: "video", url: IMAGE, caption: "Demo" });
      expect(messageField(calls[0].fields)).toEqual({ type: "video", url: IMAGE, caption: "Demo" });
    });

    it("requires a filename for documents", async () => {
      await expect(
        sendWhatsAppSessionMedia("919981999999", { type: "file", url: IMAGE }),
      ).rejects.toThrow(/filename/i);
      expect(calls).toHaveLength(0);
    });

    it("drops a caption on types WhatsApp cannot caption", async () => {
      await sendWhatsAppSessionMedia("919981999999", {
        type: "audio",
        url: IMAGE,
        caption: "ignored",
      });
      expect(messageField(calls[0].fields)).toEqual({ type: "audio", url: IMAGE });
    });

    it("still sends plain text unchanged", async () => {
      await sendWhatsAppSessionText("919981999999", "hello  there");
      expect(messageField(calls[0].fields)).toEqual({ type: "text", text: "hello there" });
    });
  });

  describe("template endpoint (/template/msg)", () => {
    it("puts the media header in its own `message` field, not inside `template`", async () => {
      await sendWhatsAppTemplate("919981999999", {
        runtimeVariables: { message: "hi" },
        media: { type: "image", url: IMAGE },
      });

      const { fields } = calls[0];
      expect(calls[0].url).toBe("https://api.gupshup.io/wa/api/v1/template/msg");
      expect(JSON.parse(fields.template)).toEqual({ id: "tpl-1", params: ["hi"] });
      // Template media uses image.link — a different shape from the session endpoint.
      expect(messageField(fields)).toEqual({ type: "image", image: { link: IMAGE } });
    });

    it("omits the message field entirely for a text-only template", async () => {
      await sendWhatsAppTemplate("919981999999", { runtimeVariables: { message: "hi" } });
      expect(calls[0].fields.message).toBeUndefined();
    });

    it("maps file to a document header with its filename", async () => {
      await sendWhatsAppTemplate("919981999999", {
        runtimeVariables: { message: "hi" },
        media: { type: "file", url: IMAGE, filename: "statement.pdf" },
      });
      expect(messageField(calls[0].fields)).toEqual({
        type: "document",
        document: { link: IMAGE, filename: "statement.pdf" },
      });
    });

    it("rejects sticker headers, which templates do not support", async () => {
      await expect(
        sendWhatsAppTemplate("919981999999", {
          runtimeVariables: { message: "hi" },
          media: { type: "sticker", url: IMAGE },
        }),
      ).rejects.toThrow(/sticker/i);
    });
  });

  describe("media url validation", () => {
    // Gupshup fetches the URL from their own network, so a local URL fails
    // provider-side with an opaque error. Catch it here instead.
    it.each(["http://localhost:3000/a.png", "https://127.0.0.1/a.png"])(
      "rejects %s as unreachable",
      async (url) => {
        await expect(
          sendWhatsAppSessionMedia("919981999999", { type: "image", url }),
        ).rejects.toThrow(/not reachable from Gupshup/i);
        expect(calls).toHaveLength(0);
      },
    );

    // Regression guard for a live failure: ngrok returned an HTML interstitial
    // to Gupshup's fetcher, so the message delivered with the image missing and
    // no error raised anywhere. A loud local failure beats a silent drop.
    it.each([
      "https://ether-rebuilt-skewer.ngrok-free.dev/assets/a.png",
      "https://foo.ngrok.io/a.png",
      "https://bar.trycloudflare.com/a.png",
    ])("rejects dev tunnel host %s", async (url) => {
      await expect(
        sendWhatsAppSessionMedia("919981999999", { type: "image", url }),
      ).rejects.toThrow(/dev tunnel/i);
      expect(calls).toHaveLength(0);
    });

    it("allows a presigned S3 url", async () => {
      await sendWhatsAppSessionMedia("919981999999", {
        type: "image",
        url: "https://sentinel-bucket.s3.eu-north-1.amazonaws.com/whatsapp-media/a.png?X-Amz-Signature=abc",
      });
      expect(calls).toHaveLength(1);
    });

    it("rejects a relative path", async () => {
      await expect(
        sendWhatsAppSessionMedia("919981999999", { type: "image", url: "/assets/a.png" }),
      ).rejects.toThrow(/absolute http/i);
    });
  });
});
