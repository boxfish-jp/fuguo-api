import {
  type CloudflareKvConfig,
  putKvValue,
  readKvConfig,
} from "./cloudflare_kv";
import { SERVER_STATUS_KEY } from "./kv_keys";

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_TTL_SECONDS = 600;

export type LivenessConfig = {
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

export const readLivenessConfig = (env: NodeJS.ProcessEnv): LivenessConfig => {
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

export const startLivenessRecording = (
  config: LivenessConfig,
  request: typeof fetch = fetch,
): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleNext = (): void => {
    if (stopped) {
      return;
    }
    clearTimer();
    timer = setTimeout(writeServerStatus, config.intervalMs);
  };

  const writeServerStatus = (): void => {
    if (stopped) {
      return;
    }
    void putKvValue(
      config.kv,
      SERVER_STATUS_KEY,
      new Date().toISOString(),
      config.ttlSeconds,
      request,
    )
      .catch((error) => {
        console.error(error);
      })
      .finally(scheduleNext);
  };

  writeServerStatus();

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearTimer();
  };
};
