import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBdrStream } from "@/lib/bdr/bridge";
import type { WebSocket } from "ws";
import type { BdrRecipient } from "@/lib/bdr/types";

interface Message { type?: string; event?: string; mark?: { name: string }; [key: string]: unknown }
const mocks = vi.hoisted(() => ({
  realtimeSockets: [] as Array<{ emit: (event: string, value?: unknown) => void; sent: Message[] }>,
  speech: vi.fn(), hangup: vi.fn(), suppress: vi.fn(),
  row: { transcript: [] } as unknown as BdrRecipient,
}));

vi.mock("ws", () => {
  class FakeRealtimeSocket {
    static OPEN = 1;
    readyState = 1;
    sent: Message[] = [];
    handlers = new Map<string, Array<(value?: unknown) => void>>();
    constructor() { mocks.realtimeSockets.push(this); }
    on(event: string, handler: (value?: unknown) => void) { this.handlers.set(event, [...(this.handlers.get(event) || []), handler]); }
    emit(event: string, value?: unknown) { for (const handler of this.handlers.get(event) || []) handler(value); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.emit("close"); }
  }
  return { WebSocket: FakeRealtimeSocket };
});
vi.mock("@/lib/bdr/cartesia", () => ({ bdrSpeechChunks: mocks.speech }));
vi.mock("@/lib/bdr/store", () => ({
  findBdrCall: () => ({
    campaign: { language: "English", opening: "Hi {{first_name}}, this is Actioneer.", script: "Ask about customer calls.", voiceId: "voice" },
    recipient: { firstName: "Abhishek", status: "calling", phone: "+16502509069" },
  }),
  suppressBdrPhone: mocks.suppress,
  updateBdrCall: (_id: string, mutate: (row: BdrRecipient, campaign: object) => void) => mutate(mocks.row, {}),
}));
vi.mock("@/lib/bdr/telephony", () => ({
  applyBdrCallStatus: vi.fn(), bdrTwilio: () => ({ calls: () => ({ update: mocks.hangup }) }), validBdrStreamToken: () => true,
}));

class FakeTwilioSocket {
  readyState = 1;
  handlers = new Map<string, Array<(value?: unknown) => void>>();
  sent: Message[] = [];
  on(event: string, handler: (value?: unknown) => void) { this.handlers.set(event, [...(this.handlers.get(event) || []), handler]); }
  emit(event: string, value?: unknown) { for (const handler of this.handlers.get(event) || []) handler(value); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit("close"); }
}
const sockets: FakeTwilioSocket[] = [];
function start() {
  const socket = new FakeTwilioSocket(); sockets.push(socket);
  handleBdrStream(socket as unknown as WebSocket);
  socket.emit("message", Buffer.from(JSON.stringify({ event: "start", start: {
    customParameters: { callId: "call", token: "token" }, accountSid: process.env.TWILIO_ACCOUNT_SID, callSid: "CA-test", streamSid: "MZ-test",
  } })));
  return socket;
}
function ai(event: Message) { mocks.realtimeSockets[0].emit("message", Buffer.from(JSON.stringify(event))); }
function acknowledge(socket: FakeTwilioSocket, index = 0) {
  const mark = socket.sent.filter((m) => m.event === "mark")[index].mark;
  socket.emit("message", Buffer.from(JSON.stringify({ event: "mark", mark })));
}
async function ready() {
  const socket = start();
  mocks.realtimeSockets[0].emit("open");
  ai({ type: "session.updated" });
  await vi.waitFor(() => expect(socket.sent.some((m) => m.event === "mark")).toBe(true));
  acknowledge(socket);
  return socket;
}
function user(text: string, itemId = "user-1") {
  ai({ type: "input_audio_buffer.speech_started", item_id: itemId });
  ai({ type: "input_audio_buffer.speech_stopped", item_id: itemId });
  ai({ type: "conversation.item.input_audio_transcription.completed", item_id: itemId, transcript: text });
}
function reply(text: string, id = "response-1", itemId = "assistant-1") {
  ai({ type: "response.created", response: { id } });
  ai({ type: "response.output_text.delta", response_id: id, item_id: itemId, delta: text });
  ai({ type: "response.output_text.done", response_id: id, item_id: itemId, text });
}
beforeEach(() => {
  mocks.row.transcript = [];
  mocks.speech.mockImplementation(async function* () { yield Buffer.alloc(160, 0xff); });
  mocks.hangup.mockResolvedValue({});
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  mocks.realtimeSockets.length = 0;
  mocks.speech.mockReset(); mocks.hangup.mockReset(); mocks.suppress.mockReset();
  vi.useRealTimers();
});

describe("BDR playback and turn-taking", () => {
  it("streams the opening without waiting for OpenAI, warming the connection in parallel", async () => {
    const socket = start();
    expect(mocks.realtimeSockets).toHaveLength(1);
    await vi.waitFor(() => expect(socket.sent.map((m) => m.event)).toEqual(["media", "mark"]));
    expect(mocks.row.transcript).toEqual([]);
    acknowledge(socket);
    expect(mocks.row.transcript?.[0]).toMatchObject({ role: "assistant", delivery: "played" });
  });

  it("owns turn-taking and doesn't clear audio for brief speech or a listening acknowledgement", async () => {
    const socket = await ready();
    const session = mocks.realtimeSockets[0].sent.find((m) => m.type === "session.update")!.session as { audio: { input: { turn_detection: object } } };
    expect(session.audio.input.turn_detection).toMatchObject({ create_response: false, interrupt_response: false });
    user("Yes, go ahead"); reply("We help your team handle customer calls.");
    await vi.waitFor(() => expect(socket.sent.filter((m) => m.event === "mark")).toHaveLength(2));
    user("yeah", "user-2");
    expect(socket.sent.filter((m) => m.event === "clear")).toHaveLength(0);
    expect(mocks.realtimeSockets[0].sent.filter((m) => m.type === "response.create")).toHaveLength(1);
    expect(mocks.realtimeSockets[0].sent.filter((m) => m.type === "response.cancel")).toHaveLength(0);
  });

  it("treats yes after completed playback as an answer, not an ignored backchannel", async () => {
    await ready(); user("yes");
    expect(mocks.realtimeSockets[0].sent.some((m) => m.type === "response.create")).toBe(true);
  });

  it("starts a normal reply from committed audio without waiting for transcription", async () => {
    const socket = await ready();
    ai({ type: "input_audio_buffer.speech_started", item_id: "user-1" });
    ai({ type: "input_audio_buffer.speech_stopped", item_id: "user-1" });
    ai({ type: "input_audio_buffer.committed", item_id: "user-1" });
    expect(mocks.realtimeSockets[0].sent.filter((m) => m.type === "response.create")).toHaveLength(1);
    reply("We help answer customer calls.");
    ai({ type: "conversation.item.input_audio_transcription.completed", item_id: "user-1", transcript: "Tell me more" });
    expect(socket.sent.some((m) => m.event === "clear")).toBe(false);
    expect(mocks.realtimeSockets[0].sent.some((m) => m.type === "response.cancel")).toBe(false);
    expect(mocks.realtimeSockets[0].sent.filter((m) => m.type === "response.create")).toHaveLength(1);
  });

  it("keeps a yes that overlaps the end of a question and replies after playback", async () => {
    const socket = await ready();
    user("Go ahead"); reply("Would a follow-up be useful?");
    ai({ type: "response.done", response: { id: "response-1", status: "completed" } });
    await vi.waitFor(() => expect(socket.sent.filter((m) => m.event === "mark")).toHaveLength(2));
    user("yes", "user-2");
    expect(socket.sent.some((m) => m.event === "clear")).toBe(false);
    expect(mocks.realtimeSockets[0].sent.filter((m) => m.type === "response.create")).toHaveLength(1);
    acknowledge(socket, 1);
    expect(mocks.realtimeSockets[0].sent.filter((m) => m.type === "response.create")).toHaveLength(2);
  });

  it("allows sustained speech to interrupt but ignores a brief VAD noise burst", async () => {
    const socket = await ready();
    user("Go ahead"); reply("We help teams handle their calls.");
    await vi.waitFor(() => expect(socket.sent.filter((m) => m.event === "mark")).toHaveLength(2));
    vi.useFakeTimers();
    ai({ type: "input_audio_buffer.speech_started", item_id: "noise" });
    vi.advanceTimersByTime(500);
    ai({ type: "input_audio_buffer.speech_stopped", item_id: "noise" });
    vi.advanceTimersByTime(800);
    expect(socket.sent.some((m) => m.event === "clear")).toBe(false);
    ai({ type: "input_audio_buffer.speech_started", item_id: "long-question" });
    vi.advanceTimersByTime(1200);
    expect(socket.sent.filter((m) => m.event === "clear")).toHaveLength(1);
  });

  it("removes unheard model text on a real interruption and ignores late cancelled deltas/marks", async () => {
    const socket = await ready();
    user("Go ahead"); reply("We answer missed calls. We also qualify leads.");
    await vi.waitFor(() => expect(socket.sent.filter((m) => m.event === "mark")).toHaveLength(3));
    acknowledge(socket, 1);
    user("Wait, how does that work?", "user-2");
    expect(socket.sent.filter((m) => m.event === "clear")).toHaveLength(1);
    ai({ type: "response.output_text.delta", response_id: "response-1", item_id: "assistant-1", delta: "Do not play this stale sentence." });
    ai({ type: "response.done", response: { id: "response-1", status: "cancelled" } });
    expect(mocks.realtimeSockets[0].sent).toContainEqual({ type: "conversation.item.delete", item_id: "assistant-1" });
    expect(mocks.realtimeSockets[0].sent).toContainEqual(expect.objectContaining({ previous_item_id: "user-1", item: expect.objectContaining({ content: [{ type: "output_text", text: "We answer missed calls." }] }) }));
    acknowledge(socket, 2); // cleared marks must not be marked as played
    expect(mocks.row.transcript?.filter((t) => t.text === "We also qualify leads.")).toEqual([expect.objectContaining({ delivery: "interrupted" })]);
    expect(mocks.speech.mock.calls.some(([text]) => String(text).includes("stale"))).toBe(false);
    expect(mocks.realtimeSockets[0].sent.filter((m) => m.type === "response.create")).toHaveLength(2);
  });

  it("drains the final script sentence and farewell before hanging up", async () => {
    const socket = await ready();
    user("Yes, a human follow-up would be good"); reply("A colleague can follow up with you.");
    ai({ type: "response.function_call_arguments.done", response_id: "response-1", name: "end_call" });
    await vi.waitFor(() => expect(socket.sent.filter((m) => m.event === "mark")).toHaveLength(3));
    expect(socket.sent.filter((m) => m.event === "clear")).toHaveLength(0);
    expect(mocks.hangup).not.toHaveBeenCalled();
    acknowledge(socket, 1);
    expect(mocks.hangup).not.toHaveBeenCalled();
    acknowledge(socket, 2);
    expect(mocks.hangup).toHaveBeenCalledWith({ status: "completed" });
  });

  it("stops the pitch and suppresses the number on an explicit opt-out", async () => {
    const socket = await ready();
    user("Do not call again"); reply("Understood.");
    ai({ type: "response.function_call_arguments.done", response_id: "response-1", name: "opt_out" });
    expect(mocks.suppress).toHaveBeenCalledWith("+16502509069");
    expect(socket.sent.some((m) => m.event === "clear")).toBe(true);
    await vi.waitFor(() => expect(mocks.speech.mock.calls.some(([text]) => String(text).includes("won't call you again"))).toBe(true));
  });
});
