import { type CloudflareKvConfig, readKvConfig } from "./cloudflare_kv";
import { startKvWriting } from "./kv_writer";
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

type StreamingUrlsSource = {
  read: () => StreamingUrls;
  handle: (message: StreamingInfoMessage) => void;
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

const createStreamingUrlsSource = (staleMs: number): StreamingUrlsSource => {
  let lastMessageAt: number | undefined;
  const urlsBySite: Partial<StreamingUrls> = {};

  const clearStaleUrls = (): void => {
    if (lastMessageAt !== undefined && Date.now() - lastMessageAt >= staleMs) {
      delete urlsBySite.niconico;
      delete urlsBySite.youtube;
    }
  };

  return {
    read: (): StreamingUrls => {
      clearStaleUrls();
      const niconico = urlsBySite.niconico;
      const youtube = urlsBySite.youtube;
      if (niconico === undefined || youtube === undefined) {
        return { niconico: null, youtube: null };
      }
      return { niconico, youtube };
    },
    handle: (message: StreamingInfoMessage): void => {
      lastMessageAt = Date.now();
      urlsBySite[message.site] = streamUrlOf(message);
    },
  };
};

const sameStreamingUrls = (
  left: StreamingUrls,
  right: StreamingUrls,
): boolean =>
  left.niconico === right.niconico && left.youtube === right.youtube;

const toHomeStatusJson = (urls: StreamingUrls): string =>
  JSON.stringify({
    updated_at: new Date().toISOString(),
    niconico: urls.niconico,
    youtube: urls.youtube,
  } satisfies HomeStatus);

export const startHomeStatusRecording = (
  config: HomeStatusConfig,
  subscribe: SubscribeToStreamingInfo = subscribeToStreamingInfo,
  request: typeof fetch = fetch,
): (() => void) => {
  const source = createStreamingUrlsSource(config.staleMs);
  return startKvWriting(
    {
      kv: config.kv,
      key: SERVER_STATUS_KEY,
      intervalMs: config.intervalMs,
      ttlSeconds: config.ttlSeconds,
      source: {
        read: source.read,
        equals: sameStreamingUrls,
        serialize: toHomeStatusJson,
      },
      subscribe: (onChange) =>
        subscribe(config.hubUrl, (message) => {
          source.handle(message);
          onChange();
        }),
    },
    request,
  );
};
