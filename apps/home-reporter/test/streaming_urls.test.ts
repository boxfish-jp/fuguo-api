import { describe, expect, it } from "vitest";
import type {
  StreamingInfoMessage,
  StreamingSite,
} from "../src/streaming_kit_hub";
import { streamUrlOf } from "../src/streaming_urls";

const message = (
  site: StreamingSite,
  isStreaming: boolean,
  streamId?: string,
): StreamingInfoMessage => ({
  type: "streaming_info",
  site,
  isStreaming,
  wasStreaming: false,
  streamId,
});

describe("streamUrlOf", () => {
  it("niconicoのstreamIdから視聴URLを作る", () => {
    expect(streamUrlOf(message("niconico", true, "lv351748501"))).toBe(
      "https://live.nicovideo.jp/watch/lv351748501",
    );
  });

  it("youtubeのstreamIdから視聴URLを作る", () => {
    expect(streamUrlOf(message("youtube", true, "abc123"))).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
  });

  it("配信していなければnullを返す", () => {
    expect(streamUrlOf(message("niconico", false, "lv351748501"))).toBeNull();
  });

  it("配信中でもstreamIdが無ければnullを返す", () => {
    expect(streamUrlOf(message("youtube", true))).toBeNull();
  });

  it("streamIdが空文字ならnullを返す", () => {
    expect(streamUrlOf(message("niconico", true, ""))).toBeNull();
  });
});
