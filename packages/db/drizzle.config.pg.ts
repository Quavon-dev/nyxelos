import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/pg/index.ts",
  out: "./drizzle/pg",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://nyxel:nyxel@localhost:5432/nyxel",
  },
});
