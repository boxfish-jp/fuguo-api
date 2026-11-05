import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StreamingInfoMessage,
  StreamingSite,
  SubscribeToStreamingInfo,
} from "../src/streaming_kit_hub";
import {
  recordStreamingUrls,
  type StreamingUrlsRecordConfig,
  startStreamingUrlsRecording,
  streamUrlOf,
} from "../src/streaming_urls";

const config: StreamingUrlsRecordConfig = {
  kv: {
    accountId: "account",
    namespaceId: "namespace",
    token: "token",
  },
  hubUrl: "http://hub.example:8888",
  intervalMs: 60_000,
  ttlSeconds: 600,
};

const okRequest = () =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );

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

const bodyOf = (
  request: ReturnType<typeof okRequest>,
  index: number,
): string => {
  const [, init] = request.mock.calls[index];
  return String(init?.body);
};

const flush = () => vi.advanceTimersByTimeAsync(0);

const createHarness = (request = okRequest()) => {
  const listeners: ((message: StreamingInfoMessage) => void)[] = [];
  const unsubscribe = vi.fn<() => void>();
  const subscribe = vi.fn<SubscribeToStreamingInfo>(
    (_hubUrl, onStreamingInfo) => {
      listeners.push(onStreamingInfo);
      return unsubscribe;
    },
  );

  const stop = startStreamingUrlsRecording(config, subscribe, request);

  return {
    stop,
    subscribe,
    request,
    unsubscribe,
    emit: (info: StreamingInfoMessage) => {
      for (const listener of listeners) {
        listener(info);
      }
    },
  };
};

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

describe("recordStreamingUrls", () => {
  it("streaming_urlsキーへサイト別URLのJSONをTTL付きで書く", async () => {
    const request = okRequest();

    await recordStreamingUrls(
      config,
      {
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
        youtube: null,
      },
      request,
    );

    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname.endsWith("/values/streaming_urls")).toBe(true);
    expect(url.searchParams.get("expiration_ttl")).toBe("600");
    expect(init?.body).toBe(
      '{"niconico":"https://live.nicovideo.jp/watch/lv351748501","youtube":null}',
    );
  });

  it("両サイトのURLをJSONで書ける", async () => {
    const request = okRequest();

    await recordStreamingUrls(
      config,
      {
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
        youtube: "https://www.youtube.com/watch?v=abc123",
      },
      request,
    );

    const [, init] = request.mock.calls[0];
    expect(init?.body).toBe(
      '{"niconico":"https://live.nicovideo.jp/watch/lv351748501","youtube":"https://www.youtube.com/watch?v=abc123"}',
    );
  });
});

describe("startStreamingUrlsRecording", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("subscribeにhubUrlとメッセージ購読を渡す", () => {
    const harness = createHarness();

    expect(harness.subscribe).toHaveBeenCalledWith(
      config.hubUrl,
      expect.any(Function),
    );

    harness.stop();
  });

  it("subscribeが例外を投げたらstartStreamingUrlsRecordingも同じ例外を投げる", () => {
    const error = new Error("subscribe failed");
    const subscribe = vi.fn<SubscribeToStreamingInfo>(() => {
      throw error;
    });

    expect(() => startStreamingUrlsRecording(config, subscribe)).toThrow(error);
  });

  it("メッセージが来なければ書き込まない", async () => {
    const harness = createHarness();

    await vi.advanceTimersByTimeAsync(config.intervalMs * 3);

    expect(harness.request).not.toHaveBeenCalled();

    harness.stop();
  });

  it("両サイトの配信情報が揃うまで書き込まない", async () => {
    const harness = createHarness();

    harness.emit(message("niconico", true, "lv351748501"));
    await vi.advanceTimersByTimeAsync(config.intervalMs * 2);
    expect(harness.request).not.toHaveBeenCalled();

    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(bodyOf(harness.request, 0)).toBe(
      '{"niconico":"https://live.nicovideo.jp/watch/lv351748501","youtube":null}',
    );

    harness.stop();
  });

  it("両サイトがfalseなら両方nullで書き込む", async () => {
    const harness = createHarness();

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(bodyOf(harness.request, 0)).toBe('{"niconico":null,"youtube":null}');

    harness.stop();
  });

  it("片方のsiteがtrueになったら即時書き込む", async () => {
    const harness = createHarness();

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(1);

    harness.emit(message("youtube", true, "abc123"));
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(2);
    expect(bodyOf(harness.request, 1)).toBe(
      '{"niconico":null,"youtube":"https://www.youtube.com/watch?v=abc123"}',
    );

    harness.stop();
  });

  it("両サイトが同時に配信していれば両方のURLを書き込む", async () => {
    const harness = createHarness();

    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", true, "abc123"));
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(bodyOf(harness.request, 0)).toBe(
      '{"niconico":"https://live.nicovideo.jp/watch/lv351748501","youtube":"https://www.youtube.com/watch?v=abc123"}',
    );

    harness.stop();
  });

  it("変化がなくてもinterval経過後のメッセージで書き込む", async () => {
    const harness = createHarness();

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(config.intervalMs - 1);
    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    harness.emit(message("niconico", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    harness.stop();
  });

  it("停止すると購読を解除し、以降のメッセージで書き込まない", async () => {
    const harness = createHarness();

    harness.stop();
    harness.stop();

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();

    expect(harness.request).not.toHaveBeenCalled();
  });

  it("停止時にキュー済みの書き込みをスキップする", async () => {
    let resolveFirst: (() => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = () => resolve(new Response(null, { status: 200 }));
    });
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first)
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
    const harness = createHarness(request);

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", true, "lv1"));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    harness.stop();
    resolveFirst?.();
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("書き込みに失敗しても配信URLが変われば次のメッセージで書き込む", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
    const harness = createHarness(request);

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", true, "lv1"));
    await flush();

    expect(request).toHaveBeenCalledTimes(2);

    harness.stop();
  });

  it("書き込みに失敗しても同じ配信URLのままinterval経過後に再試行する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
    const harness = createHarness(request);

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(config.intervalMs);
    harness.emit(message("niconico", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);

    harness.stop();
  });

  it("書き込みが未完了の間は次の書き込みを重ねない", async () => {
    let resolveFirst: (() => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = () => resolve(new Response(null, { status: 200 }));
    });
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first)
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
    const harness = createHarness(request);

    harness.emit(message("niconico", false));
    harness.emit(message("youtube", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", true, "lv1"));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(bodyOf(request, 1)).toBe(
      '{"niconico":"https://live.nicovideo.jp/watch/lv1","youtube":null}',
    );

    harness.stop();
  });
});
