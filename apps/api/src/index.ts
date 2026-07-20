import { createApp } from "./app";
import { env } from "./env";

const app = createApp();

export default {
  port: env.PORT,
  fetch: app.fetch,
};
