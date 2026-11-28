import {
  type CloudflareKvConfig,
  putKvValue,
  readKvConfig,
  readKvValue,
} from "./cloudflare_kv";
import { STREAMING_URL_KEYS } from "./kv_keys";
import {
  readStreamingKitHubUrl,
  type StreamingInfoMessage,
  type StreamingSite,
  type SubscribeToStreamingInfo,
  subscribeToStreamingInfo,
} from "./streaming_kit_hub";

const STREAM_URL_BUILDERS: Record<StreamingSite, (streamId: string) => string> =
  {
    niconico: (streamId) => `https://live.nicovideo.jp/watch/${streamId}`,
    youtube: (streamId) => `https://www.youtube.com/watch?v=${streamId}`,
  };

export const streamUrlOf = (message: StreamingInfoMessage): string | null => {
  if (!message.isStreaming || !message.streamId) {
    return null;
  }
  return STREAM_URL_BUILDERS[message.site](message.streamId);
};

export type StreamingUrlsConfig = {
  kv: CloudflareKvConfig;
  hubUrl: string;
};

export const readStreamingUrlsConfig = (
  env: NodeJS.ProcessEnv,
): StreamingUrlsConfig => ({
  kv: readKvConfig(env),
  hubUrl: readStreamingKitHubUrl(env),
});

const parseStreamingUrl = (raw: string | null): string | null | undefined => {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed === "string") {
    return parsed;
  }
  return undefined;
};

export const startStreamingUrlsRecording = (
  config: StreamingUrlsConfig,
  subscribe: SubscribeToStreamingInfo = subscribeToStreamingInfo,
  request: typeof fetch = fetch,
): (() => void) => {
  let stopped = false;
  let writeChain: Promise<void> = Promise.resolve();

  const writeUrl = (site: StreamingSite, next: string | null): void => {
    const key = STREAMING_URL_KEYS[site];
    writeChain = writeChain
      .then(async () => {
        if (stopped) {
          return;
        }
        let raw: string | null;
        try {
          raw = await readKvValue(config.kv, key, request);
        } catch (error) {
          console.error(error);
          return;
        }
        if (stopped) {
          return;
        }
        if (parseStreamingUrl(raw) === next) {
          return;
        }
        try {
          await putKvValue(
            config.kv,
            key,
            JSON.stringify(next),
            undefined,
            request,
          );
        } catch (error) {
          console.error(error);
        }
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const handleStreamingInfo = (message: StreamingInfoMessage): void => {
    if (stopped) {
      return;
    }
    writeUrl(message.site, streamUrlOf(message));
  };

  const clearStreamingUrls = (): void => {
    if (stopped) {
      return;
    }
    writeUrl("niconico", null);
    writeUrl("youtube", null);
  };

  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = subscribe(
      config.hubUrl,
      handleStreamingInfo,
      clearStreamingUrls,
    );
  } catch (error) {
    stopped = true;
    throw error;
  }

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    unsubscribe?.();
  };
};
