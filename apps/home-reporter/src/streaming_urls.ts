import { type CloudflareKvConfig, putKvValue } from "./cloudflare_kv";
import {
  type StreamingInfoMessage,
  type StreamingSite,
  type SubscribeToStreamingInfo,
  subscribeToStreamingInfo,
} from "./streaming_kit_hub";

export const STREAMING_URLS_KEY = "streaming_urls";

export type StreamingUrls = Record<StreamingSite, string | null>;

export type StreamingUrlsRecordConfig = {
  kv: CloudflareKvConfig;
  hubUrl: string;
  intervalMs: number;
  ttlSeconds: number;
};

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

export const recordStreamingUrls = async (
  config: StreamingUrlsRecordConfig,
  urls: StreamingUrls,
  request: typeof fetch = fetch,
): Promise<void> => {
  await putKvValue(
    config.kv,
    STREAMING_URLS_KEY,
    JSON.stringify({
      niconico: urls.niconico,
      youtube: urls.youtube,
    }),
    config.ttlSeconds,
    request,
  );
};

export const startStreamingUrlsRecording = (
  config: StreamingUrlsRecordConfig,
  subscribe: SubscribeToStreamingInfo = subscribeToStreamingInfo,
  request: typeof fetch = fetch,
): (() => void) => {
  let stopped = false;
  let writeChain: Promise<void> = Promise.resolve();
  let lastWriteRequest: { urls: StreamingUrls; at: number } | undefined;
  const urlsBySite: Partial<StreamingUrls> = {};

  const handleMessage = (message: StreamingInfoMessage): void => {
    if (stopped) {
      return;
    }
    urlsBySite[message.site] = streamUrlOf(message);
    const niconico = urlsBySite.niconico;
    const youtube = urlsBySite.youtube;
    if (niconico === undefined || youtube === undefined) {
      return;
    }
    const urls: StreamingUrls = { niconico, youtube };
    const changed =
      lastWriteRequest === undefined ||
      lastWriteRequest.urls.niconico !== urls.niconico ||
      lastWriteRequest.urls.youtube !== urls.youtube;
    const now = Date.now();
    const elapsedMs =
      lastWriteRequest === undefined
        ? Number.POSITIVE_INFINITY
        : now - lastWriteRequest.at;
    if (!changed && elapsedMs < config.intervalMs) {
      return;
    }
    lastWriteRequest = { urls, at: now };
    writeChain = writeChain.then(async () => {
      if (stopped) {
        return;
      }
      try {
        await recordStreamingUrls(config, urls, request);
      } catch (error) {
        console.error(error);
      }
    });
  };

  const unsubscribe = subscribe(config.hubUrl, handleMessage);

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    unsubscribe();
  };
};
