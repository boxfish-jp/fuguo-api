import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudflareKvConfig } from "../src/cloudflare_kv";
import { startKvWriting } from "../src/kv_writer";

const kv: CloudflareKvConfig = {
  accountId: "account",
  namespaceId: "namespace",
  token: "token",
};

const key = "test_key";
const intervalMs = 60_000;
const ttlSeconds = 600;

const okRequest = () =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );

const flush = () => vi.advanceTimersByTimeAsync(0);

const bodyOf = (request: ReturnType<typeof okRequest>, index: number): string =>
  String(request.mock.calls[index][1]?.body);

const createSource = (initial: string) => {
  let current = initial;
  return {
    source: {
      read: (): string => current,
      equals: (left: string, right: string): boolean => left === right,
      serialize: (value: string): string => `value:${value}`,
    },
    set: (value: string): void => {
      current = value;
    },
  };
};

const createSubscription = () => {
  const unsubscribe = vi.fn<() => void>();
  let onChange: (() => void) | undefined;
  const subscribe = vi.fn<(callback: () => void) => () => void>((callback) => {
    onChange = callback;
    return unsubscribe;
  });
  return {
    subscribe,
    unsubscribe,
    notify: (): void => onChange?.(),
  };
};

describe("startKvWriting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("起動直後にsourceの値をkeyへserializeして書く", async () => {
    const request = okRequest();
    const { source } = createSource("initial");

    const stop = startKvWriting(
      { kv, key, intervalMs, ttlSeconds, source },
      request,
    );
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname.endsWith(`/values/${key}`)).toBe(true);
    expect(url.searchParams.get("expiration_ttl")).toBe(String(ttlSeconds));
    expect(init?.method).toBe("PUT");
    expect(bodyOf(request, 0)).toBe("value:initial");

    stop();
  });

  it("subscribeのonChangeで値が変わったら即時に書く", async () => {
    const request = okRequest();
    const subscription = createSubscription();
    const { source, set } = createSource("initial");

    const stop = startKvWriting(
      {
        kv,
        key,
        intervalMs,
        ttlSeconds,
        source,
        subscribe: subscription.subscribe,
      },
      request,
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    set("next");
    subscription.notify();
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(bodyOf(request, 1)).toBe("value:next");

    stop();
  });

  it("equalsが真ならonChangeでは書かない", async () => {
    const request = okRequest();
    const subscription = createSubscription();
    const { source } = createSource("initial");

    const stop = startKvWriting(
      {
        kv,
        key,
        intervalMs,
        ttlSeconds,
        source,
        subscribe: subscription.subscribe,
      },
      request,
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    subscription.notify();
    await flush();

    expect(request).toHaveBeenCalledTimes(1);

    stop();
  });

  it("値が変わらなくてもintervalごとに書く", async () => {
    const request = okRequest();
    const { source } = createSource("initial");

    const stop = startKvWriting(
      { kv, key, intervalMs, ttlSeconds, source },
      request,
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(intervalMs);
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(bodyOf(request, 1)).toBe("value:initial");

    stop();
  });

  it("停止すると購読とタイマーを解除し、以降は書かない", async () => {
    const request = okRequest();
    const subscription = createSubscription();
    const { source, set } = createSource("initial");

    const stop = startKvWriting(
      {
        kv,
        key,
        intervalMs,
        ttlSeconds,
        source,
        subscribe: subscription.subscribe,
      },
      request,
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    stop();
    stop();

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    set("next");
    subscription.notify();
    await flush();
    await vi.advanceTimersByTimeAsync(intervalMs);
    await flush();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("subscribeが例外を投げたらstartKvWritingも同じ例外を投げて書かない", () => {
    const request = okRequest();
    const error = new Error("subscribe failed");
    const { source } = createSource("initial");

    expect(() =>
      startKvWriting(
        {
          kv,
          key,
          intervalMs,
          ttlSeconds,
          source,
          subscribe: () => {
            throw error;
          },
        },
        request,
      ),
    ).toThrow(error);

    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("書き込みに失敗したらconsole.errorを出し、同じ値のonChangeでは即時再試行せず次のintervalで再試行する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
    const subscription = createSubscription();
    const { source, set } = createSource("initial");

    const stop = startKvWriting(
      {
        kv,
        key,
        intervalMs,
        ttlSeconds,
        source,
        subscribe: subscription.subscribe,
      },
      request,
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    set("next");
    subscription.notify();
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);

    subscription.notify();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(intervalMs);
    await flush();

    expect(request).toHaveBeenCalledTimes(3);
    expect(bodyOf(request, 2)).toBe("value:next");

    stop();
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
    const subscription = createSubscription();
    const { source, set } = createSource("initial");

    const stop = startKvWriting(
      {
        kv,
        key,
        intervalMs,
        ttlSeconds,
        source,
        subscribe: subscription.subscribe,
      },
      request,
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    set("next");
    subscription.notify();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    stop();
    expect(vi.getTimerCount()).toBe(0);

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
    const subscription = createSubscription();
    const { source, set } = createSource("initial");

    const stop = startKvWriting(
      {
        kv,
        key,
        intervalMs,
        ttlSeconds,
        source,
        subscribe: subscription.subscribe,
      },
      request,
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    set("next");
    subscription.notify();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(bodyOf(request, 1)).toBe("value:next");

    stop();
  });
});
