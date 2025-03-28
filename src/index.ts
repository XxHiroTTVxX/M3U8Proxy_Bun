import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { handleProxy } from "./routes/proxy";
import { handleM3U8 } from "./routes/m3u8";

const app = new Hono();

app.use(logger());
app.use(cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'Referer'],
  allowMethods: ['GET', 'OPTIONS'],
  exposeHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400,
  credentials: true
}));

app.get("/", (c) => {
  return c.text("M3U8 Proxy - Use /m3u8?url=YOUR_M3U8_URL or /proxy?url=YOUR_URL to proxy content");
});

app.get("/proxy", handleProxy);
app.get("/m3u8", handleM3U8);
app.options("*", (c) => new Response(null, { status: 204 }));

export default {
  port: process.env.PORT ? parseInt(process.env.PORT) : 3001,
  fetch: app.fetch
};