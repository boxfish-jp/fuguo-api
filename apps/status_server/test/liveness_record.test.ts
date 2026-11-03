import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type LivenessRecordConfig,
  readLivenessRecordConfig,
  recordLiveness,
  startLivenessRecording,
} from "../src/liveness_record";

const config: LivenessRecordConfig = {
  kv: {
    accountId: "account",
    namespaceId: "namespace",
    token: "token",
  },
  intervalMs: 300_000,
  ttlSeconds: 600,
};

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_KV_NAMESPACE_ID: "namespace",
  CLOUDFLARE_API_TOKEN: "token",
};

const okRequest = () =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );

describe("recordLiveness", () => {
  it("server_statusキーへISOタイムスタンプをTTL付きで書く", async () => {
    const request = okRequest();

    await recordLiveness(config, request);

    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname.endsWith("/values/server_status")).toBe(true);
    expect(url.searchParams.get("expiration_ttl")).toBe("600");
    const body = String(init?.body);
    expect(new Date(body).toISOString()).toBe(body);
  });
});

describe("startLivenessRecording", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("起動直後とintervalごとに書き込む", async () => {
    vi.useFakeTimers();
    const request = okRequest();

    const stop = startLivenessRecording(config, request);

    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(config.intervalMs);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(config.intervalMs);
    expect(request).toHaveBeenCalledTimes(3);
    stop();
  });

  it("停止後は書き込まない", async () => {
    vi.useFakeTimers();
    const request = okRequest();

    const stop = startLivenessRecording(config, request);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(config.intervalMs * 3);

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("書き込みに失敗しても次のintervalで再試行する", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );

    const stop = startLivenessRecording(config, request);

    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(config.intervalMs);
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it("書き込みが終わるまで次の書き込みを重ねない", async () => {
    vi.useFakeTimers();
    let resolveWrite: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const request = vi.fn<typeof fetch>(() =>
      pending.then(() => new Response(null, { status: 200 })),
    );

    const stop = startLivenessRecording(config, request);

    await vi.advanceTimersByTimeAsync(config.intervalMs * 2);
    expect(request).toHaveBeenCalledTimes(1);
    resolveWrite?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(config.intervalMs);
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it("書き込み中に停止しても再スケジュールしない", async () => {
    vi.useFakeTimers();
    let resolveWrite: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const request = vi.fn<typeof fetch>(() =>
      pending.then(() => new Response(null, { status: 200 })),
    );

    const stop = startLivenessRecording(config, request);

    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    stop();
    resolveWrite?.();
    await vi.advanceTimersByTimeAsync(config.intervalMs * 2);

    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("readLivenessRecordConfig", () => {
  it("KVの資格情報と既定値を返す", () => {
    expect(readLivenessRecordConfig(env)).toEqual({
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
      readLivenessRecordConfig({
        ...env,
        LIVENESS_INTERVAL_MS: "60000",
        LIVENESS_TTL_SECONDS: "120",
      }),
    ).toMatchObject({ intervalMs: 60_000, ttlSeconds: 120 });
  });

  it("整数でない値なら変数名を含むエラーを投げる", () => {
    expect(() =>
      readLivenessRecordConfig({ ...env, LIVENESS_INTERVAL_MS: "1.5" }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });

  it("LIVENESS_INTERVAL_MSが0ならエラーを投げる", () => {
    expect(() =>
      readLivenessRecordConfig({ ...env, LIVENESS_INTERVAL_MS: "0" }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });

  it("ttlSecondsが60未満ならエラーを投げる", () => {
    expect(() =>
      readLivenessRecordConfig({ ...env, LIVENESS_TTL_SECONDS: "59" }),
    ).toThrow("LIVENESS_TTL_SECONDS");
  });

  it("intervalMsがttlSeconds以上ならエラーを投げる", () => {
    expect(() =>
      readLivenessRecordConfig({
        ...env,
        LIVENESS_INTERVAL_MS: "600000",
        LIVENESS_TTL_SECONDS: "600",
      }),
    ).toThrow("LIVENESS_INTERVAL_MS");
  });
});
