import { io } from "socket.io-client";
import customParser from "socket.io-msgpack-parser";

const DEFAULT_STREAMING_KIT_HUB_URL = "http://localhost:8888";

export type StreamingSite = "niconico" | "youtube";

export type StreamingInfoMessage = {
  type: "streaming_info";
  site: StreamingSite;
  isStreaming: boolean;
  wasStreaming: boolean;
  streamId?: string;
};

export type SubscribeToStreamingInfo = (
  hubUrl: string,
  onStreamingInfo: (message: StreamingInfoMessage) => void,
) => () => void;

export const isStreamingInfoMessage = (
  value: unknown,
): value is StreamingInfoMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    message.type === "streaming_info" &&
    (message.site === "niconico" || message.site === "youtube") &&
    typeof message.isStreaming === "boolean" &&
    typeof message.wasStreaming === "boolean" &&
    (message.streamId === undefined || typeof message.streamId === "string")
  );
};

export const subscribeToStreamingInfo: SubscribeToStreamingInfo = (
  hubUrl,
  onStreamingInfo,
) => {
  const socket = io(hubUrl, {
    path: "/ws",
    parser: customParser,
    transports: ["websocket"],
  });

  const handleMessage = (message: unknown): void => {
    if (isStreamingInfoMessage(message)) {
      onStreamingInfo(message);
    }
  };
  const handleConnectError = (error: Error): void => {
    console.error(error.message);
  };

  socket.on("message", handleMessage);
  socket.on("connect_error", handleConnectError);

  return () => {
    socket.off("message", handleMessage);
    socket.off("connect_error", handleConnectError);
    socket.disconnect();
  };
};

export const readStreamingKitHubUrl = (env: NodeJS.ProcessEnv): string => {
  const value = env.STREAMING_KIT_HUB_URL;
  if (value === undefined || value === "") {
    return DEFAULT_STREAMING_KIT_HUB_URL;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("STREAMING_KIT_HUB_URL must be an http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("STREAMING_KIT_HUB_URL must be an http or https URL");
  }
  return value;
};
