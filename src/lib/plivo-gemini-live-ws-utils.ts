import { parse } from "url";
import { WebSocket } from "ws";
import type { IncomingMessage } from "http";

export function isOpen(ws: WebSocket | undefined): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function socketCanClose(ws: WebSocket | undefined): boolean {
  return !!ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING;
}

export function sendJson(ws: WebSocket | undefined, payload: unknown): void {
  if (isOpen(ws)) ws.send(JSON.stringify(payload), { compress: false });
}

export function parseEvent(data: WebSocket.RawData): Record<string, unknown> | null {
  try {
    return JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function boolValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

export function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function callIdFromRequest(req: IncomingMessage): string {
  const { pathname, query } = parse(req.url || "", true);
  if (typeof query.callId === "string") return query.callId;
  const match = pathname?.match(/^\/(?:api\/voice\/plivo-ws|plivo-media-stream)\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function outputAudioRate(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) || 24000 : 24000;
}
