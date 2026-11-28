import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STREAMING_URL_KEYS } from "../src/kv_keys";
import type {
  StreamingInfoMessage,
  StreamingSite,
  SubscribeToStreamingInfo,
} from "../src/streaming_kit_hub";
import {
  readStreamingUrlsConfig,
  startStreamingUrlsRecording,
  streamUrlOf,
} from "../src/streaming_urls";

const config = {
  kv: {
    accountId: "account",
    namespaceId: "namespace",
    token: "token",
  },
  hubUrl: "http://hub.example:8888",
};

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_KV_NAMESPACE_ID: "namespace",
  CLOUDFLARE_API_TOKEN: "token",
};

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

const flush = () => vi.advanceTimersByTimeAsync(0);

const createKvRequest = () => {
  const store = new Map<string, string>();
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const key = decodeURIComponent(url.pathname.split("/values/")[1] ?? "");
    if (init?.method === "PUT") {
      store.set(key, String(init.body));
      return new Response(null, { status: 200 });
    }
    const value = store.get(key);
    if (value === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(value, { status: 200 });
  });
  return { request, store };
};

const putCalls = (request: ReturnType<typeof createKvRequest>["request"]) =>
  request.mock.calls.filter(([, init]) => init?.method === "PUT");

const createHarness = (request: typeof fetch) => {
  let onStreamingInfo: ((message: StreamingInfoMessage) => void) | undefined;
  let onDisconnect: (() => void) | undefined;
  const unsubscribe = vi.fn<() => void>();
  const subscribe = vi.fn<SubscribeToStreamingInfo>(
    (_hubUrl, nextOnStreamingInfo, nextOnDisconnect) => {
      onStreamingInfo = nextOnStreamingInfo;
      onDisconnect = nextOnDisconnect;
      return unsubscribe;
    },
  );

  const stop = startStreamingUrlsRecording(config, subscribe, request);

  return {
    stop,
    subscribe,
    unsubscribe,
    emit: (info: StreamingInfoMessage) => onStreamingInfo?.(info),
    disconnect: () => onDisconnect?.(),
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

describe("startStreamingUrlsRecording", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("配信中のメッセージでそのサイトのキーへURLを書く", async () => {
    const kv = createKvRequest();
    const harness = createHarness(kv.request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe(
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );
    expect(kv.store.has(STREAMING_URL_KEYS.youtube)).toBe(false);

    const [put] = putCalls(kv.request);
    const url = new URL(String(put[0]));
    expect(url.searchParams.has("expiration_ttl")).toBe(false);

    harness.stop();
  });

  it("配信していないメッセージでKVが未作成なら書かない", async () => {
    const kv = createKvRequest();
    const harness = createHarness(kv.request);

    harness.emit(message("youtube", false));
    await flush();

    expect(kv.store.size).toBe(0);
    expect(putCalls(kv.request)).toHaveLength(0);
    expect(kv.request).toHaveBeenCalledTimes(1);

    harness.stop();
  });

  it("KVの値と同じならPUTしない", async () => {
    const kv = createKvRequest();
    kv.store.set(
      STREAMING_URL_KEYS.niconico,
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );
    const harness = createHarness(kv.request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    expect(putCalls(kv.request)).toHaveLength(0);
    expect(kv.request).toHaveBeenCalledTimes(1);

    harness.stop();
  });

  it("KVの値と違えばPUTする", async () => {
    const kv = createKvRequest();
    kv.store.set(
      STREAMING_URL_KEYS.niconico,
      JSON.stringify("https://live.nicovideo.jp/watch/old"),
    );
    const harness = createHarness(kv.request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe(
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );
    expect(putCalls(kv.request)).toHaveLength(1);

    harness.stop();
  });

  it("KVの値が壊れていれば上書きする", async () => {
    const kv = createKvRequest();
    kv.store.set(STREAMING_URL_KEYS.niconico, "{broken");
    const harness = createHarness(kv.request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe(
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );
    expect(putCalls(kv.request)).toHaveLength(1);

    harness.stop();
  });

  it("読み取りに失敗したらconsole.errorを出しPUTしない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("read failed")),
    );
    const harness = createHarness(request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);

    harness.stop();
  });

  it("書き込みに失敗したらconsole.errorを出し次のメッセージで再試行する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const kv = createKvRequest();
    let failNextPut = true;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === "PUT" && failNextPut) {
        failNextPut = false;
        throw new Error("write failed");
      }
      return kv.request(input, init);
    });
    const harness = createHarness(request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(kv.store.size).toBe(0);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe(
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );

    harness.stop();
  });

  it("hub切断で両キーにnullを書く", async () => {
    const kv = createKvRequest();
    kv.store.set(
      STREAMING_URL_KEYS.niconico,
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );
    kv.store.set(
      STREAMING_URL_KEYS.youtube,
      JSON.stringify("https://www.youtube.com/watch?v=abc123"),
    );
    const harness = createHarness(kv.request);

    harness.disconnect();
    await flush();

    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe("null");
    expect(kv.store.get(STREAMING_URL_KEYS.youtube)).toBe("null");
    expect(putCalls(kv.request)).toHaveLength(2);

    harness.stop();
  });

  it("hub切断時に既にnullならPUTしない", async () => {
    const kv = createKvRequest();
    kv.store.set(STREAMING_URL_KEYS.niconico, "null");
    kv.store.set(STREAMING_URL_KEYS.youtube, "null");
    const harness = createHarness(kv.request);

    harness.disconnect();
    await flush();

    expect(putCalls(kv.request)).toHaveLength(0);

    harness.stop();
  });

  it("停止すると購読を解除し、以降書かない", async () => {
    const kv = createKvRequest();
    const harness = createHarness(kv.request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    expect(putCalls(kv.request)).toHaveLength(1);

    harness.stop();
    harness.stop();

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);

    harness.emit(message("youtube", true, "abc123"));
    await flush();

    expect(kv.store.has(STREAMING_URL_KEYS.youtube)).toBe(false);
    expect(putCalls(kv.request)).toHaveLength(1);
  });

  it("subscribeが同期メッセージを流した後に例外を投げたら書き込まず同じ例外を投げる", async () => {
    const kv = createKvRequest();
    const error = new Error("subscribe failed");
    const subscribe = vi.fn<SubscribeToStreamingInfo>(
      (_hubUrl, onStreamingInfo) => {
        onStreamingInfo(message("niconico", true, "lv351748501"));
        throw error;
      },
    );

    expect(() =>
      startStreamingUrlsRecording(config, subscribe, kv.request),
    ).toThrow(error);

    await flush();

    expect(kv.store.size).toBe(0);
    expect(putCalls(kv.request)).toHaveLength(0);
  });

  it("起動時は書き込まない", async () => {
    const kv = createKvRequest();
    kv.store.set(
      STREAMING_URL_KEYS.niconico,
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );
    const harness = createHarness(kv.request);

    await flush();

    expect(kv.request).not.toHaveBeenCalled();
    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe(
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );

    harness.stop();
  });

  it("書き込みが直列化される", async () => {
    const store = new Map<string, string>();
    const pendingPuts: (() => void)[] = [];
    let activePuts = 0;
    let maxActivePuts = 0;
    const request = vi.fn<typeof fetch>((input, init) => {
      const url = new URL(String(input));
      const key = decodeURIComponent(url.pathname.split("/values/")[1] ?? "");
      if (init?.method === "PUT") {
        activePuts += 1;
        maxActivePuts = Math.max(maxActivePuts, activePuts);
        return new Promise<Response>((resolve) => {
          pendingPuts.push(() => {
            activePuts -= 1;
            store.set(key, String(init.body));
            resolve(new Response(null, { status: 200 }));
          });
        });
      }
      const value = store.get(key);
      if (value === undefined) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(new Response(value, { status: 200 }));
    });

    const harness = createHarness(request);
    harness.emit(message("niconico", true, "lv351748501"));
    harness.emit(message("youtube", true, "abc123"));
    await flush();

    expect(pendingPuts).toHaveLength(1);
    expect(maxActivePuts).toBe(1);

    pendingPuts.shift()?.();
    await flush();
    expect(pendingPuts).toHaveLength(1);
    expect(maxActivePuts).toBe(1);

    pendingPuts.shift()?.();
    await flush();

    expect(maxActivePuts).toBe(1);
    expect(store.get(STREAMING_URL_KEYS.niconico)).toBe(
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );
    expect(store.get(STREAMING_URL_KEYS.youtube)).toBe(
      JSON.stringify("https://www.youtube.com/watch?v=abc123"),
    );

    harness.stop();
  });

  it("停止時に読み取り中の書き込みをスキップする", async () => {
    let resolveGet: (() => void) | undefined;
    const request = vi.fn<typeof fetch>((_input, init) => {
      if (init?.method === "PUT") {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return new Promise<Response>((resolve) => {
        resolveGet = () => resolve(new Response(null, { status: 404 }));
      });
    });
    const harness = createHarness(request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    harness.stop();
    resolveGet?.();
    await flush();

    expect(putCalls(request)).toHaveLength(0);
  });

  it("読み取り失敗後の次のメッセージで再試行する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const kv = createKvRequest();
    let failNextGet = true;
    const request = vi.fn<typeof fetch>((input, init) => {
      if (init?.method !== "PUT" && failNextGet) {
        failNextGet = false;
        return Promise.reject(new Error("read failed"));
      }
      return kv.request(input, init);
    });
    const harness = createHarness(request);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(kv.store.size).toBe(0);

    harness.emit(message("niconico", true, "lv351748501"));
    await flush();

    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe(
      JSON.stringify("https://live.nicovideo.jp/watch/lv351748501"),
    );

    harness.stop();
  });

  it("壊れた値と配信停止メッセージでnullに直す", async () => {
    const kv = createKvRequest();
    kv.store.set(STREAMING_URL_KEYS.niconico, "{broken");
    const harness = createHarness(kv.request);

    harness.emit(message("niconico", false));
    await flush();

    expect(kv.store.get(STREAMING_URL_KEYS.niconico)).toBe("null");
    expect(putCalls(kv.request)).toHaveLength(1);

    harness.stop();
  });

  it("subscribeにhubUrlを渡す", () => {
    const kv = createKvRequest();
    const harness = createHarness(kv.request);

    expect(harness.subscribe).toHaveBeenCalledWith(
      config.hubUrl,
      expect.any(Function),
      expect.any(Function),
    );

    harness.stop();
  });
});

describe("readStreamingUrlsConfig", () => {
  it("KVの資格情報と既定hubUrlを返す", () => {
    expect(readStreamingUrlsConfig(env)).toEqual({
      kv: {
        accountId: "account",
        namespaceId: "namespace",
        token: "token",
      },
      hubUrl: "http://localhost:8888",
    });
  });

  it("環境変数でhubUrlを上書きする", () => {
    expect(
      readStreamingUrlsConfig({
        ...env,
        STREAMING_KIT_HUB_URL: "https://hub.example:8888",
      }),
    ).toMatchObject({
      hubUrl: "https://hub.example:8888",
    });
  });

  it("hubUrlがhttpでもhttpsでもなければエラーを投げる", () => {
    expect(() =>
      readStreamingUrlsConfig({
        ...env,
        STREAMING_KIT_HUB_URL: "ftp://hub.example:8888",
      }),
    ).toThrow("STREAMING_KIT_HUB_URL");
  });
});
