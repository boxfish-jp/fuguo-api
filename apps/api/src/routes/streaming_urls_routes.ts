import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import {
  StreamingUrlsSchema,
  type StreamingUrlsValue,
  StreamingUrlsValueSchema,
} from "../schemas/streaming_urls_schema";

const STREAMING_URLS_KEY = "streaming_urls";

const parseStreamingUrls = (
  value: string | null,
): StreamingUrlsValue | null => {
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
  const result = StreamingUrlsValueSchema.safeParse(parsed);
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
  path: "/api/streaming_urls",
  tags: ["StreamingUrls"],
  summary: "配信中のサイト別URLを返す",
  description:
    "KVに記録されたサイト別の配信URLを読み、配信していればそのURLを返す。配信していなければnull。cacheTtlにより最大30秒ほど遅れる。",
  responses: {
    200: {
      description: "配信中のサイト別URL。配信していなければnull",
      content: { "application/json": { schema: StreamingUrlsSchema } },
    },
    500: {
      description: "KVの読み取りに失敗した",
    },
  },
});

export const streamingUrlsRoutes = new OpenAPIHono<AppEnv>();

streamingUrlsRoutes.openapi(route, async (c) => {
  const value = await c.env.HOME_REPORTER_KV.get(STREAMING_URLS_KEY, {
    cacheTtl: 30,
  });
  return c.json(parseStreamingUrls(value), 200);
});
