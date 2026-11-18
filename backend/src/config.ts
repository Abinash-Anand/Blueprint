export interface Config {
  port: number;
  databaseUrl: string;
  appToday?: string;
}

export function loadConfig(env = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl,
    appToday: env.APP_TODAY || undefined,
  };
}
