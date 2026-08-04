import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs as a plain Node CLI and does not read .env files, and Next
// never loads this module. process.loadEnvFile is built into Node 24, so no
// dotenv dependency is needed.
//
// This must not import src/lib/env.ts, which would drag the runtime schema and
// its Edge constraints into a migration tool.
try {
  process.loadEnvFile('.env.local');
} catch {
  // Absent in CI, where the variables arrive from the environment directly.
}

const url = process.env.DIRECT_URL;
if (!url) {
  throw new Error(
    'DIRECT_URL is required by drizzle-kit. It is the session pooler on port 5432. ' +
      'The transaction pooler on 6543 that DATABASE_URL points at does not support DDL.',
  );
}

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  schemaFilter: ['public'],
  // Defensive. Zero pgRole and zero pgPolicy are declared, so drizzle-kit leaves
  // roles alone anyway, but this pins the Supabase managed roles as off limits
  // if a policy is ever added later.
  entities: { roles: { provider: 'supabase' } },
  strict: true,
  verbose: true,
});
