import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { ServerStatusSchema } from "../schemas/server_status_schema";

const SERVER_STATUS_KEY = "server_status";

const route = createRoute({
  method: "get",
  path: "/api/server_status",
  tags: ["ServerStatus"],
  summary: "宅内サーバーが稼働しているかを返す",
  description:
    "KVの生存記録キーの有無で宅内サーバーの稼働を判定する。有無のみで判定するため、cacheTtlにより最大30秒ほど遅れる。",
  responses: {
    200: {
      description: "宅内サーバーの稼働状態",
      content: { "application/json": { schema: ServerStatusSchema } },
    },
    500: {
      description: "KVの読み取りに失敗した",
    },
  },
});

export const serverStatusRoutes = new OpenAPIHono<AppEnv>();

serverStatusRoutes.openapi(route, async (c) => {
  const value = await c.env.HOME_REPORTER_KV.get(SERVER_STATUS_KEY, {
    cacheTtl: 30,
  });
  return c.json({ alive: value !== null }, 200);
});
