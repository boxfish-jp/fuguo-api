import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/env";
import app from "../src/index";

type KvGet = (
  key: string,
  options?: { cacheTtl?: number },
) => Promise<string | null>;

const createEnv = (get: KvGet) =>
  ({ HOME_REPORTER_KV: { get } }) as unknown as Bindings;

describe("GET /api/server_status", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("KVに値があればalive trueを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue("2026-11-02T00:00:00.000Z");

    const response = await app.request(
      "/api/server_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alive: true });
    expect(get).toHaveBeenCalledWith("server_status", { cacheTtl: 30 });
  });

  it("KVに値が無ければalive falseを返す", async () => {
    const get = vi.fn<KvGet>().mockResolvedValue(null);

    const response = await app.request(
      "/api/server_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alive: false });
    expect(get).toHaveBeenCalledWith("server_status", { cacheTtl: 30 });
  });

  it("KVの読み取りに失敗したら500を返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn<KvGet>().mockRejectedValue(new Error("kv unavailable"));

    const response = await app.request(
      "/api/server_status",
      undefined,
      createEnv(get),
    );

    expect(response.status).toBe(500);
  });
});
