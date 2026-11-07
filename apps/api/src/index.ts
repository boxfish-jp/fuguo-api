import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { AppEnv } from "./env";
import { girlfriendRoutes } from "./routes/girlfriend_routes";
import { serverStatusRoutes } from "./routes/server_status_routes";
import { streamingUrlsRoutes } from "./routes/streaming_urls_routes";

const app = new OpenAPIHono<AppEnv>();

app.route("/", girlfriendRoutes);
app.route("/", serverStatusRoutes);
app.route("/", streamingUrlsRoutes);

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "fuguo-api",
    version: "v1",
    description: "ニコ生に生息しているふぐおの色んな情報が取れるAPI",
  },
});

app.get(
  "/docs",
  Scalar({
    url: "/openapi.json",
    pageTitle: "fuguo-api API Reference",
  }),
);

export default app;
