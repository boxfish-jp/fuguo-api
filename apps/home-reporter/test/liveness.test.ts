import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_STATUS_KEY } from "../src/kv_keys";
import {
  type LivenessConfig,
  readLivenessConfig,
  startLivenessRecording,
} from "../src/liveness";

const config: LivenessConfig = {
  kv: {
    accountId: "account",
    namespaceId: "namespace",
    token: "token",
  },
  intervalMs: 60_000,
  ttlSeconds: 600,
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

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("startLivenessRecording", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("起動直後にserver_statusへISO時刻をTTL付きで書く", async () => {
    const request = okRequest();

    const stop = startLivenessRecording(config, request);
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname.endsWith(`/values/${SERVER_STATUS_KEY}`)).toBe(true);
    expect(url.searchParams.get("expiration_ttl")).toBe("600");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(initialTime.toISOString());

    stop();
  });

  it("intervalごとに書き、時刻が進む", async () => {
    const request = okRequest();

    const stop = startLivenessRecording(config, request);
    await flush();

    await vi.advanceTimersByTimeAsync(config.intervalMs);
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]?.body).toBe(
      new Date(initialTime.getTime() + config.intervalMs).toISOString(),
    );

    stop();
  });

  it("書き込みに失敗したらconsole.errorを出し次のintervalで再試行する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );

    const stop = startLivenessRecording(config, request);
    await flush();
    expect(error).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(config.intervalMs);
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    stop();
  });

  it("停止するとタイマーを解除し、以降書かない", async () => {
    const request = okRequest();

    const stop = startLivenessRecording(config, request);
    await flush();

    stop();
    stop();

    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(config.intervalMs * 2);
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("書き込み中に停止しても再スケジュールしない", async () => {
    let resolvePut: (() => void) | undefined;
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolvePut = () => resolve(new Response(null, { status: 200 }));
        }),
    );

    const stop = startLivenessRecording(config, request);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    stop();
    resolvePut?.();
    await flush();

    expect(vi.getTimerCount()).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("readLivenessConfig", () => {
  it("KVの資格情報と既定値を返す", () => {
    expect(readLivenessConfig(env)).toEqual({
      kv: {
        accountId: "account",
        namespaceId: "namespace",
        token: "token",
      },
      intervalMs: 300_000,
      ttlSeconds: 600,
    });
  });

  it("環境変数でintervalとttlを上書きする", () => {
    expect(
      readLivenessConfig({
        ...env,
        LIVENESS_INTERVAL_MS: "60000",
        LIVENESS_TTL_SECONDS: "120",
      }),
    ).toMatchObject({
      intervalMs: 60_000,
      ttlSeconds: 120,
    });
  });

  it("整数でないintervalなら変数名を含むエラーを投げる", () => {
    expect(() =>
      readLivenessConfig({ ...env, LIVENESS_INTERVAL_MS: "1.5" }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });

  it("intervalが0ならエラーを投げる", () => {
    expect(() =>
      readLivenessConfig({ ...env, LIVENESS_INTERVAL_MS: "0" }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });

  it("ttlSecondsが60未満ならエラーを投げる", () => {
    expect(() =>
      readLivenessConfig({ ...env, LIVENESS_TTL_SECONDS: "59" }),
    ).toThrow("LIVENESS_TTL_SECONDS");
  });

  it("intervalMsがttlSeconds以上ならエラーを投げる", () => {
    expect(() =>
      readLivenessConfig({
        ...env,
        LIVENESS_INTERVAL_MS: "600000",
        LIVENESS_TTL_SECONDS: "600",
      }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });
});
