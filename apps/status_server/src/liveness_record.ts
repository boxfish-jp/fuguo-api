import {
  type CloudflareKvConfig,
  putKvValue,
  readKvConfig,
} from "./cloudflare_kv";

export const SERVER_STATUS_KEY = "server_status";
const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_TTL_SECONDS = 600;

export type LivenessRecordConfig = {
  kv: CloudflareKvConfig;
  intervalMs: number;
  ttlSeconds: number;
};

const readSafeInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number => {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return value;
};

export const readLivenessRecordConfig = (
  env: NodeJS.ProcessEnv,
): LivenessRecordConfig => {
  const kv = readKvConfig(env);
  const intervalMs = readSafeInteger(
    env,
    "LIVENESS_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
  );
  const ttlSeconds = readSafeInteger(
    env,
    "LIVENESS_TTL_SECONDS",
    DEFAULT_TTL_SECONDS,
  );
  if (intervalMs < 1000 || intervalMs > 2_147_483_647) {
    throw new Error("LIVENESS_INTERVAL_MS must be between 1000 and 2147483647");
  }
  if (ttlSeconds < 60) {
    throw new Error("LIVENESS_TTL_SECONDS must be at least 60");
  }
  if (intervalMs >= ttlSeconds * 1000) {
    throw new Error(
      "LIVENESS_INTERVAL_MS must be less than LIVENESS_TTL_SECONDS * 1000",
    );
  }
  return { kv, intervalMs, ttlSeconds };
};

export const recordLiveness = async (
  config: LivenessRecordConfig,
  request: typeof fetch = fetch,
): Promise<void> => {
  await putKvValue(
    config.kv,
    SERVER_STATUS_KEY,
    new Date().toISOString(),
    config.ttlSeconds,
    request,
  );
};

export const startLivenessRecording = (
  config: LivenessRecordConfig,
  request: typeof fetch = fetch,
): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const writeOnce = async (): Promise<void> => {
    try {
      await recordLiveness(config, request);
    } catch (error) {
      console.error(error);
    }
  };

  const loop = (): void => {
    void writeOnce().finally(() => {
      if (stopped) {
        return;
      }
      timer = setTimeout(loop, config.intervalMs);
    });
  };

  loop();

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
};
