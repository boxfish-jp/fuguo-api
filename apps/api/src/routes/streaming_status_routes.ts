import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import {
  StreamingStatusSchema,
  type StreamingStatusValue,
  StreamingStatusValueSchema,
} from "../schemas/streaming_status_schema";

const STREAMING_STATUS_KEY = "streaming_status";

const parseStreamingStatus = (
  value: string | null,
): StreamingStatusValue | null => {
  if (value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    console.error(error);
    return null;
  }
  if (parsed === null) {
    return null;
  }
  const result = StreamingStatusValueSchema.safeParse(parsed);
  if (!result.success) {
    console.error(result.error);
    return null;
  }
  if (result.data.niconico === null && result.data.youtube === null) {
    return null;
  }
  return result.data;
};

const route = createRoute({
  method: "get",
  path: "/api/streaming_status",
  tags: ["StreamingStatus"],
  summary: "配信中のサイト別URLを返す",
  description:
    "KVの配信状態を読み、配信中のサイトの視聴URLを返す。配信していなければnull。cacheTtlにより最大30秒ほど遅れる。",
  responses: {
    200: {
      description: "配信中のサイト別URL。配信していなければnull",
      content: { "application/json": { schema: StreamingStatusSchema } },
    },
    500: {
      description: "KVの読み取りに失敗した",
    },
  },
});

export const streamingStatusRoutes = new OpenAPIHono<AppEnv>();

streamingStatusRoutes.openapi(route, async (c) => {
  const value = await c.env.HOME_REPORTER_KV.get(STREAMING_STATUS_KEY, {
    cacheTtl: 30,
  });
  return c.json(parseStreamingStatus(value), 200);
});
