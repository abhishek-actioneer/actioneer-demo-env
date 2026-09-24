import { afterEach, describe, expect, it, vi } from "vitest";
import { handleBdrStream } from "@/lib/bdr/bridge";
import type { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
  realtimeSockets: [] as Array<{ emit: (event: string, value?: unknown) => void }>,
  speech: vi.fn(),
}));

vi.mock("ws", () => {
  class FakeRealtimeSocket {
    static OPEN = 1;
    readyState = 1;
    handlers = new Map<string, Array<(value?: unknown) => void>>();
    constructor() { mocks.realtimeSockets.push(this); }
    on(event: string, handler: (value?: unknown) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) || []), handler]);
    }
    emit(event: string, value?: unknown) {
      for (const handler of this.handlers.get(event) || []) handler(value);
    }
    send() {}
    close() { this.readyState = 3; this.emit("close"); }
  }
  return { WebSocket: FakeRealtimeSocket };
});
vi.mock("@/lib/bdr/cartesia", () => ({ bdrSpeech: mocks.speech }));
vi.mock("@/lib/bdr/store", () => ({
  findBdrCall: () => ({
    campaign: { language: "English", opening: "Hi {{first_name}}, this is Actioneer.", script: "Ask about customer calls.", voiceId: "voice" },
    recipient: { firstName: "Abhishek", status: "calling", phone: "+16502509069" },
  }),
  suppressBdrPhone: vi.fn(), updateBdrCall: vi.fn(),
}));
vi.mock("@/lib/bdr/telephony", () => ({
  applyBdrCallStatus: vi.fn(), bdrTwilio: vi.fn(), validBdrStreamToken: () => true,
}));

class FakeTwilioSocket {
  readyState = 1;
  handlers = new Map<string, Array<(value?: unknown) => void>>();
  sent: Array<{ event: string; mark?: { name: string } }> = [];
  on(event: string, handler: (value?: unknown) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) || []), handler]);
  }
  emit(event: string, value?: unknown) {
    for (const handler of this.handlers.get(event) || []) handler(value);
  }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit("close"); }
}

afterEach(() => { mocks.realtimeSockets.length = 0; mocks.speech.mockReset(); });

describe("BDR call opening", () => {
  it("sends Cartesia audio before waiting for the OpenAI conversation", async () => {
    mocks.speech.mockResolvedValue(Buffer.alloc(160, 0xff));
    const socket = new FakeTwilioSocket();
    handleBdrStream(socket as unknown as WebSocket);
    socket.emit("message", Buffer.from(JSON.stringify({ event: "start", start: {
      customParameters: { callId: "call", token: "token" },
      accountSid: process.env.TWILIO_ACCOUNT_SID, callSid: "CA-test", streamSid: "MZ-test",
    } })));
    await vi.waitFor(() => expect(socket.sent.map((message) => message.event)).toEqual(["media", "mark"]));
    expect(socket.sent[1].mark?.name).toBe("bdr-opening");
    expect(mocks.realtimeSockets).toHaveLength(0);
    socket.emit("message", Buffer.from(JSON.stringify({ event: "mark", mark: { name: "bdr-opening" } })));
    expect(mocks.realtimeSockets).toHaveLength(1);
    socket.close();
  });
});
