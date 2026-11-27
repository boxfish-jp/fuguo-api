import type { StreamingInfoMessage, StreamingSite } from "./streaming_kit_hub";

export type StreamingUrls = Record<StreamingSite, string | null>;

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
