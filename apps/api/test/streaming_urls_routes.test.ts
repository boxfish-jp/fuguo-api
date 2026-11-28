import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/env";
import app from "../src/index";
import { SERVER_STATUS_KEY, STREAMING_URL_KEYS } from "../src/kv_keys";

type KvGet = (
  key: string,
  options?: { cacheTtl?: number },
) => Promise<string | null>;

const createEnv = (values: Record<string, string | null>) => {
  const get = vi
    .fn<KvGet>()
    .mockImplementation((key) => Promise.resolve(values[key] ?? null));
  return { get, env: { HOME_REPORTER_KV: { get } } as unknown as Bindings };
};

const niconicoUrl = "https://live.nicovideo.jp/watch/lv351748501";
const youtubeUrl = "https://www.youtube.com/watch?v=abc123";

describe("GET /api/streaming_urls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("livenessキーが無ければnullを返す", async () => {
    const { get, env } = createEnv({
      [STREAMING_URL_KEYS.niconico]: JSON.stringify(niconicoUrl),
      [STREAMING_URL_KEYS.youtube]: JSON.stringify(youtubeUrl),
    });

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(get).toHaveBeenCalledWith(SERVER_STATUS_KEY, { cacheTtl: 30 });
    expect(get).toHaveBeenCalledWith(STREAMING_URL_KEYS.niconico, {
      cacheTtl: 30,
    });
    expect(get).toHaveBeenCalledWith(STREAMING_URL_KEYS.youtube, {
      cacheTtl: 30,
    });
  });

  it("両方のURLを返す", async () => {
    const { env } = createEnv({
      [SERVER_STATUS_KEY]: "2026-11-27T12:34:56.789Z",
      [STREAMING_URL_KEYS.niconico]: JSON.stringify(niconicoUrl),
      [STREAMING_URL_KEYS.youtube]: JSON.stringify(youtubeUrl),
    });

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: niconicoUrl,
      youtube: youtubeUrl,
    });
  });

  it("片方のURLだけならもう片方をnullで返す", async () => {
    const { env } = createEnv({
      [SERVER_STATUS_KEY]: "2026-11-27T12:34:56.789Z",
      [STREAMING_URL_KEYS.niconico]: JSON.stringify(niconicoUrl),
      [STREAMING_URL_KEYS.youtube]: "null",
    });

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: niconicoUrl,
      youtube: null,
    });
  });

  it("両方nullならnullを返す", async () => {
    const { env } = createEnv({
      [SERVER_STATUS_KEY]: "2026-11-27T12:34:56.789Z",
      [STREAMING_URL_KEYS.niconico]: "null",
      [STREAMING_URL_KEYS.youtube]: "null",
    });

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("片方のキーが欠損していてももう片方を返す", async () => {
    const { env } = createEnv({
      [SERVER_STATUS_KEY]: "2026-11-27T12:34:56.789Z",
      [STREAMING_URL_KEYS.niconico]: JSON.stringify(niconicoUrl),
    });

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: niconicoUrl,
      youtube: null,
    });
  });

  it("壊れたJSONはそのサイトをnullにしconsole.errorを出す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = createEnv({
      [SERVER_STATUS_KEY]: "2026-11-27T12:34:56.789Z",
      [STREAMING_URL_KEYS.niconico]: "{broken",
      [STREAMING_URL_KEYS.youtube]: JSON.stringify(youtubeUrl),
    });

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: null,
      youtube: youtubeUrl,
    });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("文字列以外のJSONはそのサイトをnullにしconsole.errorを出す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = createEnv({
      [SERVER_STATUS_KEY]: "2026-11-27T12:34:56.789Z",
      [STREAMING_URL_KEYS.niconico]: "true",
      [STREAMING_URL_KEYS.youtube]: JSON.stringify(youtubeUrl),
    });

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      niconico: null,
      youtube: youtubeUrl,
    });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("KVの読み取りに失敗したら500を返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn<KvGet>().mockRejectedValue(new Error("kv unavailable"));
    const env = { HOME_REPORTER_KV: { get } } as unknown as Bindings;

    const response = await app.request("/api/streaming_urls", undefined, env);

    expect(response.status).toBe(500);
  });
});
