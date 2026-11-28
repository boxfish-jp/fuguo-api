import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { SERVER_STATUS_KEY, STREAMING_URL_KEYS } from "../kv_keys";
import { StreamingUrlsSchema } from "../schemas/streaming_urls_schema";

const parseStreamingUrl = (value: string | null): string | null => {
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
  if (parsed === null || typeof parsed === "string") {
    return parsed;
  }
  console.error(new Error(`unexpected streaming url: ${value}`));
  return null;
};

const route = createRoute({
  method: "get",
  path: "/api/streaming_urls",
  tags: ["StreamingUrls"],
  summary: "配信中のサイト別URLを返す",
  description:
    "KVに記録されたサイト別の配信URLを読み、配信していればそのURLを返す。配信していなければnull。宅内サーバーが生存していない場合もnull。cacheTtlにより最大30秒ほど遅れる。",
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
  const [serverStatusValue, niconico, youtube] = await Promise.all([
    c.env.HOME_REPORTER_KV.get(SERVER_STATUS_KEY, { cacheTtl: 30 }),
    c.env.HOME_REPORTER_KV.get(STREAMING_URL_KEYS.niconico, {
      cacheTtl: 30,
    }),
    c.env.HOME_REPORTER_KV.get(STREAMING_URL_KEYS.youtube, {
      cacheTtl: 30,
    }),
  ]);
  if (serverStatusValue === null) {
    return c.json(null, 200);
  }
  const urls = {
    niconico: parseStreamingUrl(niconico),
    youtube: parseStreamingUrl(youtube),
  };
  if (urls.niconico === null && urls.youtube === null) {
    return c.json(null, 200);
  }
  return c.json(urls, 200);
});
