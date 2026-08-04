import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';

import * as schema from './schema';

function createClient() {
  return postgres(env.DATABASE_URL, {
    // Supabase's transaction pooler on 6543 hands a different backend to every
    // transaction, so a prepared statement is never where the next one looks.
    // This is not a tuning choice, it is required.
    prepare: false,

    // Fluid Compute serves several concurrent invocations from one instance, so
    // the classic serverless max: 1 would head of line block a second live tool
    // call behind the first inside the 3s budget. Three sockets per instance
    // stays well under the free tier Supavisor pool of 15.
    max: 3,

    // Below any pooler or platform side idle reaper, so we close first and never
    // hand a dead socket to a live call.
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,

    ssl: 'require',

    // Skips the type introspection round trip on every new connection. The
    // schema is uuid, text, jsonb, integer and timestamptz, all statically known
    // OIDs, with no arrays and no custom types. Worth one round trip off a cold
    // start inside a 3s budget.
    fetch_types: false,

    onnotice: () => {},
  });
}

type Client = ReturnType<typeof createClient>;
type Database = ReturnType<typeof drizzle<typeof schema, Client>>;

// Module scope already survives Fluid instance reuse. The global additionally
// survives Next instantiating the same module graph twice across its server
// bundles, and dev HMR, either of which would otherwise open a second pool.
// Cached in every environment rather than only development, because the failure
// it prevents is a production failure.
const cache = globalThis as unknown as { __voxdeskClient?: Client; __voxdeskDb?: Database };

const client: Client = cache.__voxdeskClient ?? createClient();
export const db: Database = cache.__voxdeskDb ?? drizzle(client, { schema });

cache.__voxdeskClient = client;
cache.__voxdeskDb = db;
