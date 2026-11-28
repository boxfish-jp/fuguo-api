import type { StreamingSite } from "./streaming_kit_hub";

export const SERVER_STATUS_KEY = "server_status";
export const STREAMING_URL_KEYS = {
  niconico: "streaming_url_niconico",
  youtube: "streaming_url_youtube",
} as const satisfies Record<StreamingSite, string>;
