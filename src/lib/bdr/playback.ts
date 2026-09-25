import { BdrCartesiaStream } from "./cartesia-stream";

export interface BdrSpeechSegment {
  text: string;
  itemId: string;
  kind?: "opening" | "farewell" | "screening" | "voicemail";
}

interface QueuedSegment extends BdrSpeechSegment { mark: string; bytes: number }

export class BdrPlayback {
  private epoch = 0;
  private sequence = 0;
  private queue = Promise.resolve();
  private controller?: AbortController;
  private segments = new Map<string, QueuedSegment>();
  private speech: BdrCartesiaStream;

  constructor(private options: {
    language: string;
    voiceId: string;
    send: (event: Record<string, unknown>) => void;
    played: (segment: BdrSpeechSegment) => void;
    interrupted: (segment: BdrSpeechSegment) => void;
    firstAudio: (segment: BdrSpeechSegment, synthesisMs: number) => void;
    failed: (error: unknown) => void;
  }) { this.speech = new BdrCartesiaStream(options.language, options.voiceId); }

  get pending(): boolean { return this.segments.size > 0; }

  speak(segment: BdrSpeechSegment): void {
    const epoch = this.epoch;
    const queued = { ...segment, mark: `bdr-speech-${++this.sequence}`, bytes: 0 };
    this.segments.set(queued.mark, queued);
    this.queue = this.queue.then(async () => {
      if (epoch !== this.epoch) return;
      const controller = new AbortController();
      this.controller = controller;
      const started = Date.now();
      for await (const audio of this.speech.speak(segment.text, segment.itemId, controller.signal, !!segment.kind)) {
        if (epoch !== this.epoch) return;
        if (!queued.bytes) this.options.firstAudio(segment, Date.now() - started);
        queued.bytes += audio.length;
        this.options.send({ event: "media", media: { payload: audio.toString("base64") } });
      }
      if (epoch !== this.epoch) return;
      this.options.send({ event: "mark", mark: { name: queued.mark } });
    }).catch((error: unknown) => {
      // A deliberate interruption aborts in-flight TTS, not the phone call.
      if (epoch === this.epoch) this.options.failed(error);
    });
  }

  finishTurn(itemId: string): void {
    const epoch = this.epoch;
    this.queue = this.queue.then(() => {
      if (epoch === this.epoch) this.speech.finish(itemId);
    }).catch((error: unknown) => { if (epoch === this.epoch) this.options.failed(error); });
  }

  acknowledge(mark: string): void {
    const segment = this.segments.get(mark);
    if (!segment) return; // Twilio also returns marks for audio removed by clear.
    this.segments.delete(mark);
    this.options.played(segment);
  }

  clear(sendClear = true): void {
    this.epoch += 1;
    this.controller?.abort();
    this.controller = undefined;
    this.speech.cancel();
    if (!sendClear) this.speech.close();
    this.queue = Promise.resolve();
    const discarded = [...this.segments.values()];
    this.segments.clear();
    if (sendClear) this.options.send({ event: "clear" });
    for (const segment of discarded) {
      if (segment.bytes) this.options.interrupted(segment);
    }
  }
}
