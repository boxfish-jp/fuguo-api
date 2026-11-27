import {
  type CloudflareKvConfig,
  putKvValue,
  readKvConfig,
} from "./cloudflare_kv";
import {
  readStreamingKitHubUrl,
  type StreamingInfoMessage,
  type SubscribeToStreamingInfo,
  subscribeToStreamingInfo,
} from "./streaming_kit_hub";
import { type StreamingUrls, streamUrlOf } from "./streaming_urls";

export const SERVER_STATUS_KEY = "server_status";
const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_STALE_MS = 120_000;

export type HomeStatus = StreamingUrls & {
  updated_at: string;
};

export type HomeStatusConfig = {
  kv: CloudflareKvConfig;
  hubUrl: string;
  intervalMs: number;
  ttlSeconds: number;
  staleMs: number;
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

export const readHomeStatusConfig = (
  env: NodeJS.ProcessEnv,
): HomeStatusConfig => {
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
  return {
    kv,
    hubUrl: readStreamingKitHubUrl(env),
    intervalMs,
    ttlSeconds,
    staleMs: DEFAULT_STALE_MS,
  };
};

export const startHomeStatusRecording = (
  config: HomeStatusConfig,
  subscribe: SubscribeToStreamingInfo = subscribeToStreamingInfo,
  request: typeof fetch = fetch,
): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writeChain: Promise<void> = Promise.resolve();
  let lastWrittenUrls: StreamingUrls | undefined;
  let lastMessageAt: number | undefined;
  const urlsBySite: Partial<StreamingUrls> = {};

  const clearHeartbeat = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const clearStaleUrls = (): void => {
    if (
      lastMessageAt !== undefined &&
      Date.now() - lastMessageAt >= config.staleMs
    ) {
      delete urlsBySite.niconico;
      delete urlsBySite.youtube;
    }
  };

  const urlsForHeartbeat = (): StreamingUrls => {
    const niconico = urlsBySite.niconico;
    const youtube = urlsBySite.youtube;
    if (niconico === undefined || youtube === undefined) {
      return { niconico: null, youtube: null };
    }
    return { niconico, youtube };
  };

  const writeStatus = (urls: StreamingUrls): void => {
    clearHeartbeat();
    lastWrittenUrls = urls;
    const status: HomeStatus = {
      updated_at: new Date().toISOString(),
      niconico: urls.niconico,
      youtube: urls.youtube,
    };
    const value = JSON.stringify(status);
    writeChain = writeChain.then(async () => {
      if (stopped) {
        return;
      }
      try {
        await putKvValue(
          config.kv,
          SERVER_STATUS_KEY,
          value,
          config.ttlSeconds,
          request,
        );
      } catch (error) {
        console.error(error);
      }
      scheduleHeartbeat();
    });
  };

  const heartbeat = (): void => {
    if (stopped) {
      return;
    }
    clearStaleUrls();
    writeStatus(urlsForHeartbeat());
  };

  const scheduleHeartbeat = (): void => {
    if (stopped) {
      return;
    }
    clearHeartbeat();
    timer = setTimeout(heartbeat, config.intervalMs);
  };

  const handleMessage = (message: StreamingInfoMessage): void => {
    if (stopped) {
      return;
    }
    lastMessageAt = Date.now();
    urlsBySite[message.site] = streamUrlOf(message);
    const niconico = urlsBySite.niconico;
    const youtube = urlsBySite.youtube;
    if (niconico === undefined || youtube === undefined) {
      return;
    }
    const urls: StreamingUrls = { niconico, youtube };
    if (
      lastWrittenUrls !== undefined &&
      lastWrittenUrls.niconico === urls.niconico &&
      lastWrittenUrls.youtube === urls.youtube
    ) {
      return;
    }
    writeStatus(urls);
  };

  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = subscribe(config.hubUrl, handleMessage);
  } catch (error) {
    stopped = true;
    throw error;
  }
  if (lastWrittenUrls === undefined) {
    writeStatus({ niconico: null, youtube: null });
  }

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearHeartbeat();
    unsubscribe?.();
  };
};
