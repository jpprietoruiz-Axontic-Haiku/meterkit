import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_METERED_PRICE_ID: z.string().optional(),
  APP_BASE_URL: z.string().default("http://localhost:5173"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
