import customParser from "socket.io-msgpack-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isStreamingInfoMessage,
  readStreamingKitHubUrl,
  subscribeToStreamingInfo,
} from "../src/streaming_kit_hub";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (handlers.get(event) === handler) {
        handlers.delete(event);
      }
    }),
    disconnect: vi.fn(),
  };
  const io = vi.fn(() => socket);
  return { handlers, socket, io };
});

vi.mock("socket.io-client", () => ({
  io: mocks.io,
}));

const validMessage = {
  type: "streaming_info",
  site: "niconico",
  isStreaming: true,
  wasStreaming: false,
  streamId: "lv351748501",
};

describe("readStreamingKitHubUrl", () => {
  it("未設定ならlocalhostを返す", () => {
    expect(readStreamingKitHubUrl({})).toBe("http://localhost:8888");
  });

  it("空文字なら既定値を返す", () => {
    expect(readStreamingKitHubUrl({ STREAMING_KIT_HUB_URL: "" })).toBe(
      "http://localhost:8888",
    );
  });

  it("設定値で上書きする", () => {
    expect(
      readStreamingKitHubUrl({
        STREAMING_KIT_HUB_URL: "https://hub.example:8888",
      }),
    ).toBe("https://hub.example:8888");
  });

  it.each(["ftp://hub.example:8888", "ws://hub.example:8888", "hub.example"])(
    "%sなら変数名を含むエラーを投げる",
    (value) => {
      expect(() =>
        readStreamingKitHubUrl({ STREAMING_KIT_HUB_URL: value }),
      ).toThrow("STREAMING_KIT_HUB_URL");
    },
  );
});

describe("isStreamingInfoMessage", () => {
  it("全フィールドが正しいメッセージを通す", () => {
    expect(isStreamingInfoMessage(validMessage)).toBe(true);
  });

  it("streamIdが無くても通す", () => {
    expect(
      isStreamingInfoMessage({
        type: "streaming_info",
        site: "youtube",
        isStreaming: false,
        wasStreaming: true,
      }),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["配列", []],
    ["typeが違う", { ...validMessage, type: "other" }],
    ["siteが違う", { ...validMessage, site: "twitch" }],
    ["isStreamingが真偽値でない", { ...validMessage, isStreaming: "true" }],
    [
      "wasStreamingが欠落",
      { type: "streaming_info", site: "niconico", isStreaming: true },
    ],
    ["wasStreamingが真偽値でない", { ...validMessage, wasStreaming: "false" }],
    ["streamIdが文字列でない", { ...validMessage, streamId: 1 }],
  ])("%sメッセージを弾く", (_name, value) => {
    expect(isStreamingInfoMessage(value)).toBe(false);
  });
});

describe("subscribeToStreamingInfo", () => {
  beforeEach(() => {
    mocks.io.mockClear();
    mocks.socket.on.mockClear();
    mocks.socket.off.mockClear();
    mocks.socket.disconnect.mockClear();
    mocks.handlers.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ioにhubUrlとpathとparserとtransportsを渡す", () => {
    const unsubscribe = subscribeToStreamingInfo(
      "http://hub.example:8888",
      vi.fn(),
    );

    expect(mocks.io).toHaveBeenCalledWith("http://hub.example:8888", {
      path: "/ws",
      parser: customParser,
      transports: ["websocket"],
    });

    unsubscribe();
  });

  it("正しいstreaming_infoだけコールバックに渡す", () => {
    const onStreamingInfo = vi.fn();
    const unsubscribe = subscribeToStreamingInfo(
      "http://hub.example:8888",
      onStreamingInfo,
    );
    const handleMessage = mocks.handlers.get("message");

    handleMessage?.(validMessage);

    expect(onStreamingInfo).toHaveBeenCalledWith(validMessage);

    unsubscribe();
  });

  it.each([
    [
      "wasStreamingが欠落",
      { type: "streaming_info", site: "niconico", isStreaming: true },
    ],
    ["wasStreamingが真偽値でない", { ...validMessage, wasStreaming: "false" }],
    ["streamIdが文字列でない", { ...validMessage, streamId: 1 }],
  ])("%sメッセージをコールバックに渡さない", (_name, invalidMessage) => {
    const onStreamingInfo = vi.fn();
    const unsubscribe = subscribeToStreamingInfo(
      "http://hub.example:8888",
      onStreamingInfo,
    );
    const handleMessage = mocks.handlers.get("message");

    handleMessage?.(invalidMessage);

    expect(onStreamingInfo).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("connect_errorはerror.messageだけをconsole.errorに出す", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsubscribe = subscribeToStreamingInfo(
      "http://hub.example:8888",
      vi.fn(),
    );
    const handleConnectError = mocks.handlers.get("connect_error");

    handleConnectError?.(new Error("connection refused"));

    expect(error).toHaveBeenCalledWith("connection refused");

    unsubscribe();
  });

  it("解除関数がmessageとconnect_errorのoffとdisconnectを呼ぶ", () => {
    const unsubscribe = subscribeToStreamingInfo(
      "http://hub.example:8888",
      vi.fn(),
    );
    const handleMessage = mocks.handlers.get("message");
    const handleConnectError = mocks.handlers.get("connect_error");

    unsubscribe();

    expect(mocks.socket.off).toHaveBeenCalledWith("message", handleMessage);
    expect(mocks.socket.off).toHaveBeenCalledWith(
      "connect_error",
      handleConnectError,
    );
    expect(mocks.socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
