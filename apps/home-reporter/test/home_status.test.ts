import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HomeStatus,
  type HomeStatusConfig,
  readHomeStatusConfig,
  SERVER_STATUS_KEY,
  startHomeStatusRecording,
} from "../src/home_status";
import type {
  StreamingInfoMessage,
  StreamingSite,
  SubscribeToStreamingInfo,
} from "../src/streaming_kit_hub";

const config: HomeStatusConfig = {
  kv: {
    accountId: "account",
    namespaceId: "namespace",
    token: "token",
  },
  hubUrl: "http://hub.example:8888",
  intervalMs: 60_000,
  ttlSeconds: 600,
  staleMs: 120_000,
};

const timingConfig: HomeStatusConfig = {
  ...config,
  intervalMs: 1_000,
  ttlSeconds: 60,
  staleMs: 700,
};

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_KV_NAMESPACE_ID: "namespace",
  CLOUDFLARE_API_TOKEN: "token",
};

const initialTime = new Date("2026-11-27T12:00:00.000Z");

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
): HomeStatus => JSON.parse(String(request.mock.calls[index][1]?.body));

const flush = () => vi.advanceTimersByTimeAsync(0);

const createHarness = (
  override: Partial<HomeStatusConfig> = {},
  request = okRequest(),
) => {
  const listeners: ((message: StreamingInfoMessage) => void)[] = [];
  const unsubscribe = vi.fn<() => void>();
  const subscribe = vi.fn<SubscribeToStreamingInfo>(
    (_hubUrl, onStreamingInfo) => {
      listeners.push(onStreamingInfo);
      return unsubscribe;
    },
  );

  const stop = startHomeStatusRecording(
    { ...config, ...override },
    subscribe,
    request,
  );

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

describe("startHomeStatusRecording", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("起動直後にserver_statusへnullの配信URLとupdated_atを書く", async () => {
    const harness = createHarness();

    await flush();

    expect(harness.request).toHaveBeenCalledTimes(1);
    const [input, init] = harness.request.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname.endsWith(`/values/${SERVER_STATUS_KEY}`)).toBe(true);
    expect(url.searchParams.get("expiration_ttl")).toBe("600");
    expect(init?.method).toBe("PUT");
    expect(bodyOf(harness.request, 0)).toEqual({
      updated_at: initialTime.toISOString(),
      niconico: null,
      youtube: null,
    });
    expect(vi.getTimerCount()).toBe(1);

    harness.stop();
  });

  it("subscribeが同期的に両siteを流しても初回のnullで上書きしない", async () => {
    const request = okRequest();
    const unsubscribe = vi.fn<() => void>();
    const subscribe = vi.fn<SubscribeToStreamingInfo>(
      (_hubUrl, onStreamingInfo) => {
        onStreamingInfo(message("niconico", true, "lv351748501"));
        onStreamingInfo(message("youtube", false));
        return unsubscribe;
      },
    );

    const stop = startHomeStatusRecording(config, subscribe, request);
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
    expect(bodyOf(request, 0)).toMatchObject({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: null,
    });

    stop();
  });

  it("subscribeが同期メッセージを流した後に例外を投げたら書き込まずタイマーも残さない", async () => {
    const request = okRequest();
    const error = new Error("subscribe failed");
    const subscribe = vi.fn<SubscribeToStreamingInfo>(
      (_hubUrl, onStreamingInfo) => {
        onStreamingInfo(message("niconico", true, "lv351748501"));
        onStreamingInfo(message("youtube", false));
        throw error;
      },
    );

    expect(() => startHomeStatusRecording(config, subscribe, request)).toThrow(
      error,
    );

    await flush();
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("intervalごとにupdated_atを更新して書く", async () => {
    const harness = createHarness();
    await flush();
    const first = bodyOf(harness.request, 0);

    await vi.advanceTimersByTimeAsync(config.intervalMs);
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(2);
    const second = bodyOf(harness.request, 1);
    expect(second.updated_at).toBe(
      new Date(initialTime.getTime() + config.intervalMs).toISOString(),
    );
    expect(second.updated_at).not.toBe(first.updated_at);

    harness.stop();
  });

  it("両siteのstreaming_infoが揃ったら配信URLを即時書く", async () => {
    const harness = createHarness();
    await flush();

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(1);

    harness.emit(message("youtube", false));
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(2);
    expect(bodyOf(harness.request, 1)).toEqual({
      updated_at: initialTime.toISOString(),
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: null,
    });

    harness.stop();
  });

  it("配信URLに変化がなければintervalまでは書かない", async () => {
    const harness = createHarness();
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(config.intervalMs - 1);
    expect(harness.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(3);

    harness.stop();
  });

  it("片siteだけ既知の定期書き込みはnullを書く", async () => {
    const harness = createHarness();
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(config.intervalMs);
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(2);
    expect(bodyOf(harness.request, 1)).toMatchObject({
      niconico: null,
      youtube: null,
    });

    harness.emit(message("youtube", false));
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(3);
    expect(bodyOf(harness.request, 2)).toMatchObject({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: null,
    });

    harness.stop();
  });

  it("配信URLが変わったら即時書く", async () => {
    const harness = createHarness();
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    harness.emit(message("niconico", false));
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(3);
    expect(bodyOf(harness.request, 2)).toMatchObject({
      niconico: null,
      youtube: null,
    });

    harness.stop();
  });

  it("staleMsを超えてstreaming_infoが来なければ次の定期書き込みでnullを書く", async () => {
    const harness = createHarness(timingConfig);
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(timingConfig.intervalMs);
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(3);
    expect(bodyOf(harness.request, 2)).toMatchObject({
      niconico: null,
      youtube: null,
    });

    harness.stop();
  });

  it("staleMs以内にstreaming_infoが来れば定期書き込みで配信URLを書く", async () => {
    const harness = createHarness(timingConfig);
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", true, "abc123"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(400);
    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(3);
    expect(bodyOf(harness.request, 2)).toMatchObject({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: "https://www.youtube.com/watch?v=abc123",
    });

    harness.stop();
  });

  it("stale後に片方のsiteだけ来た場合は両方揃うまで配信URLを書かない", async () => {
    const harness = createHarness(timingConfig);
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", true, "abc123"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(timingConfig.intervalMs);
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(3);
    expect(bodyOf(harness.request, 2)).toMatchObject({
      niconico: null,
      youtube: null,
    });

    await vi.advanceTimersByTimeAsync(500);
    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(4);
    expect(bodyOf(harness.request, 3)).toMatchObject({
      niconico: null,
      youtube: null,
    });

    harness.emit(message("youtube", true, "abc123"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(5);
    expect(bodyOf(harness.request, 4)).toMatchObject({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: "https://www.youtube.com/watch?v=abc123",
    });

    harness.stop();
  });

  it("片方のsiteの通知だけ止まっても最後の値を使う", async () => {
    const harness = createHarness(timingConfig);
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", true, "abc123"));
    await flush();
    expect(harness.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(400);
    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(harness.request).toHaveBeenCalledTimes(3);
    expect(bodyOf(harness.request, 2)).toMatchObject({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: "https://www.youtube.com/watch?v=abc123",
    });

    harness.stop();
  });

  it("停止すると購読を解除し、以降は書かない", async () => {
    const harness = createHarness();
    await flush();

    harness.stop();
    harness.stop();

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    await vi.advanceTimersByTimeAsync(config.intervalMs);

    expect(harness.request).toHaveBeenCalledTimes(1);
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
    const harness = createHarness({}, request);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    harness.stop();
    resolveFirst?.();
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
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
    const harness = createHarness({}, request);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(bodyOf(request, 1)).toMatchObject({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: null,
    });

    harness.stop();
  });

  it("書き込みに失敗しても同じ値の再メッセージでは即時再試行せず次の定期書き込みで再試行する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
    const harness = createHarness({}, request);
    await flush();
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);

    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", false));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(config.intervalMs);
    await flush();

    expect(request).toHaveBeenCalledTimes(3);
    expect(bodyOf(request, 2)).toMatchObject({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: null,
    });

    harness.stop();
  });

  it("subscribeが例外を投げたらstartHomeStatusRecordingも同じ例外を投げる", () => {
    const error = new Error("subscribe failed");
    const subscribe = vi.fn<SubscribeToStreamingInfo>(() => {
      throw error;
    });
    const request = okRequest();

    expect(() => startHomeStatusRecording(config, subscribe, request)).toThrow(
      error,
    );

    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("readHomeStatusConfig", () => {
  it("KVの資格情報と既定値を返す", () => {
    expect(readHomeStatusConfig(env)).toEqual({
      kv: {
        accountId: "account",
        namespaceId: "namespace",
        token: "token",
      },
      hubUrl: "http://localhost:8888",
      intervalMs: 300_000,
      ttlSeconds: 600,
      staleMs: 120_000,
    });
  });

  it("環境変数でintervalとttlとhubUrlを上書きする", () => {
    expect(
      readHomeStatusConfig({
        ...env,
        LIVENESS_INTERVAL_MS: "60000",
        LIVENESS_TTL_SECONDS: "120",
        STREAMING_KIT_HUB_URL: "https://hub.example:8888",
      }),
    ).toMatchObject({
      hubUrl: "https://hub.example:8888",
      intervalMs: 60_000,
      ttlSeconds: 120,
    });
  });

  it("整数でないintervalなら変数名を含むエラーを投げる", () => {
    expect(() =>
      readHomeStatusConfig({ ...env, LIVENESS_INTERVAL_MS: "1.5" }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });

  it("intervalが0ならエラーを投げる", () => {
    expect(() =>
      readHomeStatusConfig({ ...env, LIVENESS_INTERVAL_MS: "0" }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });

  it("ttlSecondsが60未満ならエラーを投げる", () => {
    expect(() =>
      readHomeStatusConfig({ ...env, LIVENESS_TTL_SECONDS: "59" }),
    ).toThrow("LIVENESS_TTL_SECONDS");
  });

  it("intervalMsがttlSeconds以上ならエラーを投げる", () => {
    expect(() =>
      readHomeStatusConfig({
        ...env,
        LIVENESS_INTERVAL_MS: "600000",
        LIVENESS_TTL_SECONDS: "600",
      }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });

  it("hubUrlがhttpでもhttpsでもなければエラーを投げる", () => {
    expect(() =>
      readHomeStatusConfig({
        ...env,
        STREAMING_KIT_HUB_URL: "ftp://hub.example:8888",
      }),
    ).toThrow("STREAMING_KIT_HUB_URL");
  });
});
