import { z } from "@hono/zod-openapi";

export const ServerStatusSchema = z
  .object({
    alive: z.boolean().openapi({
      example: true,
      description: "宅内サーバーが稼働しているかどうか",
    }),
  })
  .openapi("ServerStatus");
