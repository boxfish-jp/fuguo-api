import { SERVER_STATUS_KEY, STREAMING_URL_KEYS } from "./kv_keys";
import { readLivenessConfig, startLivenessRecording } from "./liveness";
import {
  readStreamingUrlsConfig,
  startStreamingUrlsRecording,
} from "./streaming_urls";

const livenessConfig = readLivenessConfig(process.env);
const streamingUrlsConfig = readStreamingUrlsConfig(process.env);

const stopLiveness = startLivenessRecording(livenessConfig);
const stopStreamingUrls = startStreamingUrlsRecording(streamingUrlsConfig);

const shutdown = (): void => {
  stopLiveness();
  stopStreamingUrls();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.info(
  `liveness recording started: key=${SERVER_STATUS_KEY} intervalMs=${livenessConfig.intervalMs} ttlSeconds=${livenessConfig.ttlSeconds}`,
);
console.info(
  `streaming urls recording started: keys=${STREAMING_URL_KEYS.niconico},${STREAMING_URL_KEYS.youtube} hubUrl=${streamingUrlsConfig.hubUrl}`,
);
