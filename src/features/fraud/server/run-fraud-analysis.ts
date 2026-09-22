import type { VoiceTranscriptTurn } from "@/lib/voice-campaign-types";
import { analyzeCall, fetchRecordingBytes } from "./analysis-service-client";
import { persistFraudAnalysisResult } from "./results-repo";
import { computeTranscriptFeatures } from "./transcript-features";

export async function runFraudAnalysis(
  callId: string,
  campaignId: string,
  recordingUrl: string,
  transcript: VoiceTranscriptTurn[],
  datasetId: string,
): Promise<void> {
  const transcriptFeatures = computeTranscriptFeatures(transcript);

  let recordingBytes: Buffer;
  try {
    recordingBytes = await fetchRecordingBytes(recordingUrl);
  } catch (err) {
    console.error(`[fraud-analysis] failed to fetch recording for ${callId}:`, err);
    return;
  }

  const result = await analyzeCall({
    wavBase64: recordingBytes.toString("base64"),
    transcriptFeatures,
  });

  await persistFraudAnalysisResult(callId, campaignId, datasetId, result, transcriptFeatures);
  console.log(`[fraud-analysis] wrote call_id=${callId} recommendation=${result.recommendation ?? "unknown"}`);
}

export async function runFraudAnalysisFromBytes(
  callId: string,
  campaignId: string,
  recordingBytes: Buffer,
  transcript: VoiceTranscriptTurn[],
  datasetId: string,
): Promise<void> {
  const transcriptFeatures = computeTranscriptFeatures(transcript);
  const result = await analyzeCall({
    wavBase64: recordingBytes.toString("base64"),
    transcriptFeatures,
  });

  await persistFraudAnalysisResult(callId, campaignId, datasetId, result, transcriptFeatures);
  console.log(`[fraud-analysis] wrote call_id=${callId} recommendation=${result.recommendation ?? "unknown"}`);
}
