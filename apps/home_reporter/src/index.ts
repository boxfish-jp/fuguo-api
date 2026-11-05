import {
  readLivenessRecordConfig,
  SERVER_STATUS_KEY,
  startLivenessRecording,
} from "./liveness_record";
import { readStreamingKitHubUrl } from "./streaming_kit_hub";
import {
  STREAMING_STATUS_KEY,
  startStreamingStatusRecording,
} from "./streaming_status";

const livenessConfig = readLivenessRecordConfig(process.env);
const streamingConfig = {
  kv: livenessConfig.kv,
  hubUrl: readStreamingKitHubUrl(process.env),
  intervalMs: livenessConfig.intervalMs,
  ttlSeconds: livenessConfig.ttlSeconds,
};

const stopLiveness = startLivenessRecording(livenessConfig);
const stopStreaming = startStreamingStatusRecording(streamingConfig);

const shutdown = (): void => {
  stopLiveness();
  stopStreaming();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.info(
  `liveness recording scheduled: key=${SERVER_STATUS_KEY} intervalMs=${livenessConfig.intervalMs}`,
);
console.info(
  `streaming status recording started: key=${STREAMING_STATUS_KEY} hubUrl=${streamingConfig.hubUrl} intervalMs=${streamingConfig.intervalMs} ttlSeconds=${streamingConfig.ttlSeconds}`,
);
