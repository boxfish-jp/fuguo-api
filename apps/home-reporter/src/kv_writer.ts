import { type CloudflareKvConfig, putKvValue } from "./cloudflare_kv";

export type KvWritingSource<T> = {
  read: () => T;
  equals: (left: T, right: T) => boolean;
  serialize: (value: T) => string;
};

export type KvWritingConfig<T> = {
  kv: CloudflareKvConfig;
  key: string;
  intervalMs: number;
  ttlSeconds: number;
  source: KvWritingSource<T>;
  subscribe?: (onChange: () => void) => () => void;
};

export const startKvWriting = <T>(
  config: KvWritingConfig<T>,
  request: typeof fetch = fetch,
): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writeChain: Promise<void> = Promise.resolve();
  let lastQueuedValue: T | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleNextWrite = (): void => {
    if (stopped) {
      return;
    }
    clearTimer();
    timer = setTimeout(writePeriodically, config.intervalMs);
  };

  const writeValue = (value: T): void => {
    clearTimer();
    lastQueuedValue = value;
    const body = config.source.serialize(value);
    writeChain = writeChain.then(async () => {
      if (stopped) {
        return;
      }
      try {
        await putKvValue(
          config.kv,
          config.key,
          body,
          config.ttlSeconds,
          request,
        );
      } catch (error) {
        console.error(error);
      }
      scheduleNextWrite();
    });
  };

  const writePeriodically = (): void => {
    if (stopped) {
      return;
    }
    writeValue(config.source.read());
  };

  const writeIfChanged = (): void => {
    if (stopped || lastQueuedValue === undefined) {
      return;
    }
    const next = config.source.read();
    if (config.source.equals(lastQueuedValue, next)) {
      return;
    }
    writeValue(next);
  };

  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = config.subscribe?.(writeIfChanged);
  } catch (error) {
    stopped = true;
    throw error;
  }
  writeValue(config.source.read());

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearTimer();
    unsubscribe?.();
  };
};
