import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/env";
import app from "../src/index";

type KvGet = (
  key: string,
  options?: { cacheTtl?: number },
) => Promise<string | null>;

const createEnv = (get: KvGet) =>
  ({ HOME_REPORTER_KV: { get } }) as unknown as Bindings;

describe("GET /api/streaming_status", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("サイト別の配信URLを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(
      JSON.stringify({
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
        youtube: null,
      }),
    );

    const response = await app.request(
      "/api/streaming_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: "https://live.nicovideo.jp/watch/lv351748501",
      youtube: null,
    });
    expect(get).toHaveBeenCalledWith("streaming_status", { cacheTtl: 30 });
  });

  it("KVにキーが無ければnullを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(null);

    const response = await app.request(
      "/api/streaming_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(get).toHaveBeenCalledWith("streaming_status", { cacheTtl: 30 });
  });

  it("値がJSONのnullならnullを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue("null");

    const response = await app.request(
      "/api/streaming_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("両サイトともnullならnullを返す", async () => {
    const get = vi
      .fn<KvGet>()
      .mockResolvedValue(JSON.stringify({ niconico: null, youtube: null }));

    const response = await app.request(
      "/api/streaming_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("両サイトとも配信中なら両方のURLを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(
      JSON.stringify({
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
        youtube: "https://www.youtube.com/watch?v=abc123",
      }),
    );

    const response = await app.request(
      "/api/streaming_status",
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
      JSON.stringify({
        niconico: "https://live.nicovideo.jp/watch/lv351748501",
      }),
    );

    const response = await app.request(
      "/api/streaming_status",
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
      "/api/streaming_status",
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
      "/api/streaming_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("旧boolean形式ならconsole.errorしてnullを返す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi
      .fn<KvGet>()
      .mockResolvedValue(JSON.stringify({ niconico: true, youtube: false }));

    const response = await app.request(
      "/api/streaming_status",
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
      "/api/streaming_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(500);
  });
});
