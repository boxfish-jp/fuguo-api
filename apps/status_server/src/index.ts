import {
  readLivenessRecordConfig,
  SERVER_STATUS_KEY,
  startLivenessRecording,
} from "./liveness_record";

const config = readLivenessRecordConfig(process.env);
const stop = startLivenessRecording(config);

const shutdown = (): void => {
  stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.info(
  `liveness recording scheduled: key=${SERVER_STATUS_KEY} intervalMs=${config.intervalMs}`,
);
