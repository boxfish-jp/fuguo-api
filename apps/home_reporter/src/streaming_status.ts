import { type CloudflareKvConfig, putKvValue } from "./cloudflare_kv";
import {
  type StreamingInfoMessage,
  type StreamingSite,
  type SubscribeToStreamingInfo,
  subscribeToStreamingInfo,
} from "./streaming_kit_hub";

export const STREAMING_STATUS_KEY = "streaming_status";

export type StreamingStatus = Record<StreamingSite, string | null>;

export type StreamingStatusRecordConfig = {
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

export const recordStreamingStatus = async (
  config: StreamingStatusRecordConfig,
  status: StreamingStatus,
  request: typeof fetch = fetch,
): Promise<void> => {
  await putKvValue(
    config.kv,
    STREAMING_STATUS_KEY,
    JSON.stringify({
      niconico: status.niconico,
      youtube: status.youtube,
    }),
    config.ttlSeconds,
    request,
  );
};

export const startStreamingStatusRecording = (
  config: StreamingStatusRecordConfig,
  subscribe: SubscribeToStreamingInfo = subscribeToStreamingInfo,
  request: typeof fetch = fetch,
): (() => void) => {
  let stopped = false;
  let writeChain: Promise<void> = Promise.resolve();
  let lastWriteRequest: { status: StreamingStatus; at: number } | undefined;
  const statuses: Partial<StreamingStatus> = {};

  const handleMessage = (message: StreamingInfoMessage): void => {
    if (stopped) {
      return;
    }
    statuses[message.site] = streamUrlOf(message);
    const niconico = statuses.niconico;
    const youtube = statuses.youtube;
    if (niconico === undefined || youtube === undefined) {
      return;
    }
    const status: StreamingStatus = { niconico, youtube };
    const changed =
      lastWriteRequest === undefined ||
      lastWriteRequest.status.niconico !== status.niconico ||
      lastWriteRequest.status.youtube !== status.youtube;
    const now = Date.now();
    const elapsedMs =
      lastWriteRequest === undefined
        ? Number.POSITIVE_INFINITY
        : now - lastWriteRequest.at;
    if (!changed && elapsedMs < config.intervalMs) {
      return;
    }
    lastWriteRequest = { status, at: now };
    writeChain = writeChain.then(async () => {
      if (stopped) {
        return;
      }
      try {
        await recordStreamingStatus(config, status, request);
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
