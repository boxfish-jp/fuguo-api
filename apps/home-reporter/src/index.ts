import {
  readHomeStatusConfig,
  SERVER_STATUS_KEY,
  startHomeStatusRecording,
} from "./home_status";

const config = readHomeStatusConfig(process.env);

const stop = startHomeStatusRecording(config);

const shutdown = (): void => {
  stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.info(
  `home status recording started: key=${SERVER_STATUS_KEY} intervalMs=${config.intervalMs} ttlSeconds=${config.ttlSeconds} staleMs=${config.staleMs} hubUrl=${config.hubUrl}`,
);
