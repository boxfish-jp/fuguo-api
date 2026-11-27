import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/env";
import app from "../src/index";

type KvGet = (
  key: string,
  options?: { cacheTtl?: number },
) => Promise<string | null>;

const createEnv = (get: KvGet) =>
  ({ HOME_REPORTER_KV: { get } }) as unknown as Bindings;

const withUpdatedAt = (value: object): string =>
  JSON.stringify({
    updated_at: "2026-11-27T12:34:56.789Z",
    ...value,
  });

describe("GET /api/streaming_urls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("server_statusキーからサイト別の配信URLを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(
      withUpdatedAt({
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
        youtube: null,
      }),
    );

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: null,
    });
    expect(get).toHaveBeenCalledWith("server_status", { cacheTtl: 30 });
  });

  it("updated_atはレスポンスに含めない", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(
      withUpdatedAt({
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
        youtube: "https://www.youtube.com/watch?v=abc123",
      }),
    );

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    const body = await response.json();
    expect(body).not.toHaveProperty("updated_at");
    expect(body).toEqual({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: "https://www.youtube.com/watch?v=abc123",
    });
  });

  it("KVにキーが無ければnullを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(null);

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(get).toHaveBeenCalledWith("server_status", { cacheTtl: 30 });
  });

  it("値がJSONのnullならnullを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue("null");

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("両サイトともnullならnullを返す", async () => {
    const get = vi
      .fn<KvGet>()
      .mockResolvedValue(withUpdatedAt({ niconico: null, youtube: null }));

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("両サイトとも配信中なら両方のURLを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(
      withUpdatedAt({
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
        youtube: "https://www.youtube.com/watch?v=abc123",
      }),
    );

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: "https://www.youtube.com/watch?v=abc123",
    });
  });

  it("片方のキーが欠落していたらconsole.errorしてnullを返す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn<KvGet>().mockResolvedValue(
      withUpdatedAt({
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
      }),
    );

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("非オブジェクトのJSONならconsole.errorしてnullを返す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn<KvGet>().mockResolvedValue("123");

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("旧形式のISO文字列ならconsole.errorしてnullを返す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn<KvGet>().mockResolvedValue("2026-11-02T00:00:00.000Z");

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("壊れたJSONならconsole.errorしてnullを返す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn<KvGet>().mockResolvedValue("{broken");

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("配信URLがbooleanならconsole.errorしてnullを返す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi
      .fn<KvGet>()
      .mockResolvedValue(withUpdatedAt({ niconico: true, youtube: false }));

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("KVの読み取りに失敗したら500を返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn<KvGet>().mockRejectedValue(new Error("kv unavailable"));

    const response = await app.request(
      "/api/streaming_urls",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(500);
  });
});
