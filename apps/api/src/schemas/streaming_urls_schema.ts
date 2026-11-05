import { z } from "@hono/zod-openapi";

export const StreamingUrlsValueSchema = z.object({
  niconico: z.string().nullable().openapi({
    example: "https://live.nicovideo.jp/watch/lv351748501",
    description: "ニコニコの配信URL。配信していなければnull",
  }),
  youtube: z.string().nullable().openapi({
    example: "https://www.youtube.com/watch?v=abc123",
    description: "YouTubeの配信URL。配信していなければnull",
  }),
});

export const StreamingUrlsSchema = StreamingUrlsValueSchema.nullable().openapi(
  "StreamingUrls",
  {
    description: "配信中のサイト別URL。配信していなければnull",
  },
);

export type StreamingUrlsValue = z.infer<typeof StreamingUrlsValueSchema>;
