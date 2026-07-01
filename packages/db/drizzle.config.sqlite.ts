import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/sqlite/index.ts",
  out: "./drizzle/sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./nyxel.sqlite",
  },
});
