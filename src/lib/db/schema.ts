// SPEC.md section 5. Five tables, RLS enabled on all of them with zero policies.
//
// .enableRLS() is what makes drizzle-kit emit
// `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` as a pair with each CREATE TABLE,
// so RLS ships inside the generated migration and there is no second migration
// system, per SPEC.md section 3.
//
// Why the app can still read and write with RLS on and no policies:
// relforcerowsecurity is false and the connecting role owns the tables, and
// Postgres exempts a table's owner from RLS. So RLS is doing exactly one job
// here, which is making anon and authenticated, the roles PostgREST uses, read
// nothing. That completes SPEC.md section 6.9 deviation 1 and pairs with the
// already emptied Exposed schemas setting.
//
// Do NOT add FORCE ROW LEVEL SECURITY. It revokes the owner exemption and every
// server side query starts returning zero rows, silently, in a way that looks
// like a data bug rather than a permissions change.
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // The natural key. Everything joins on this, and any route that sees it
  // creates the row. See SPEC.md section 5.1.
  elConversationId: text('el_conversation_id').notNull().unique(),
  status: text('status').notNull().default('in_progress'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  transcript: jsonb('transcript'),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const leadCaptures = pgTable('lead_captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .unique()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  name: text('name'),
  email: text('email'),
  company: text('company'),
  projectType: text('project_type'),
  timeline: text('timeline'),
  budgetBand: text('budget_band'),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// The observability table. This is what /calls renders and what a prospect
// inspects to verify the agent did something rather than only talked.
export const toolInvocations = pgTable('tool_invocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  requestPayload: jsonb('request_payload').notNull(),
  responsePayload: jsonb('response_payload').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  statusCode: integer('status_code').notNull(),
  invokedAt: timestamp('invoked_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  calBookingUid: text('cal_booking_uid').notNull().unique(),
  slotStart: timestamp('slot_start', { withTimezone: true }).notNull(),
  attendeeEmail: text('attendee_email').notNull(),
  status: text('status').notNull(),
}).enableRLS();

// SPEC.md section 6.9 deviation 3. The daily session counter lives in Postgres
// because a serverless in memory counter does not survive a cold start.
export const demoSessions = pgTable(
  'demo_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // SHA-256 of the session cookie value. The table holds no credential.
    sessionHash: text('session_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('demo_sessions_created_at_idx').on(table.createdAt)],
).enableRLS();

export type Conversation = typeof conversations.$inferSelect;
export type NewToolInvocation = typeof toolInvocations.$inferInsert;
export type NewBooking = typeof bookings.$inferInsert;
