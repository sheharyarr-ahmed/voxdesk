/**
 * Agent configuration as code, SPEC.md section 6.8.
 *
 *   pnpm agent:push --dry   read live state, print a field level diff, write nothing
 *   pnpm agent:push         apply the local configuration
 *   pnpm agent:test         run the committed agent tests against the live agent
 *
 * Every entity is resolved by name rather than by id, so re-running is idempotent
 * and a fresh workspace bootstraps from the same command. Resolved ids are
 * written to agent/ids.json and committed.
 *
 * Run by node directly. Node 24 strips the types, so there is no build step and
 * no runner dependency. Credentials come from --env-file, never from a flag.
 *
 * TOOL_SHARED_SECRET is read from the environment and sent once to create the
 * workspace secret. It is never printed, never logged, and never written to
 * agent/ids.json, which stores only the returned secret_id.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';

const API = 'https://api.elevenlabs.io';
const HERE = new URL('./', import.meta.url);
const DRY = argv.includes('--dry');
const RUN_TESTS = argv.includes('--run-tests');

/**
 * --only=a,b restricts a test run to named tests.
 *
 * Not a convenience. Agent testing draws on the same monthly credit pool as live
 * conversation on the free plan, measured at roughly 750 credits per simulated
 * conversation, so re-running the whole suite after every prompt edit would spend
 * the budget the gate call needs. Iterate on what failed.
 */
const ONLY = (argv.find((flag) => flag.startsWith('--only=')) ?? '')
  .replace('--only=', '')
  .split(',')
  .filter((name) => name !== '');

type JsonObject = Record<string, unknown>;

// ---------------------------------------------------------------- environment

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    console.error(`push: ${name} is not set. Run through pnpm so --env-file=.env.local applies.`);
    exit(1);
  }
  return value;
}

const API_KEY = required('ELEVENLABS_API_KEY');
const AGENT_ID = required('ELEVENLABS_AGENT_ID');

// ------------------------------------------------------------------- transport

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'xi-api-key': API_KEY,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}\n${text.slice(0, 1500)}`);
  }
  return (text === '' ? {} : JSON.parse(text)) as T;
}

// ------------------------------------------------------------------- utilities

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, HERE), 'utf8')) as T;
}

function readText(relative: string): string {
  return readFileSync(new URL(relative, HERE), 'utf8');
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Objects merge key by key. Arrays and scalars replace, because a partial array is not a merge. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

function render(value: unknown): string {
  if (value === undefined) return '(absent)';
  if (typeof value === 'string' && value.length > 60) return `<${value.length} chars>`;
  const text = JSON.stringify(value);
  return text !== undefined && text.length > 90 ? `${text.slice(0, 87)}...` : String(text);
}

/**
 * Walks only the keys present in `desired`. Live state carries dozens of platform
 * defaults this build does not own, and reporting those as differences would make
 * every run look dirty and hide the changes that are real.
 *
 * Arrays are walked element by element for the same reason. The platform echoes
 * chat history and attached test entries back with extra null fields it filled in
 * itself, so comparing arrays whole would report a difference on every run and the
 * idempotency claim in SPEC.md section 6.8 would be untestable. Length is still
 * compared, so an added or removed element is a real difference.
 */
function diff(live: unknown, desired: unknown, path = ''): string[] {
  if (isObject(desired) && isObject(live)) {
    return Object.keys(desired).flatMap((key) =>
      diff(live[key], desired[key], path === '' ? key : `${path}.${key}`),
    );
  }
  if (Array.isArray(desired) && Array.isArray(live) && desired.length === live.length) {
    return desired.flatMap((item, index) => diff(live[index], item, `${path}[${index}]`));
  }
  if (JSON.stringify(live ?? null) === JSON.stringify(desired ?? null)) return [];
  return [`${path}: ${render(live)} -> ${render(desired)}`];
}

function report(label: string, lines: string[]): boolean {
  if (lines.length === 0) {
    console.log(`  ${label}: no changes`);
    return false;
  }
  console.log(`  ${label}:`);
  for (const line of lines) console.log(`    ${line}`);
  return true;
}

// ---------------------------------------------------------------- local config

type AgentConfig = {
  agent_name: string;
  resolve: {
    secrets: string[];
    knowledge_base: { name: string; file: string; usage_mode: string; rag_index: boolean }[];
    tools: string[];
    tests: string[];
    prompt_file: string;
  };
  conversation_config: JsonObject;
  platform_settings: JsonObject;
};

const config = readJson<AgentConfig>('agent.config.json');

// ------------------------------------------------------------------- 1 secrets

type SecretList = { secrets: { secret_id: string; name: string }[] };

async function syncSecrets(): Promise<Record<string, string>> {
  const live = await api<SecretList>('GET', '/v1/convai/secrets');
  const resolved: Record<string, string> = {};

  for (const name of config.resolve.secrets) {
    const existing = live.secrets.find((secret) => secret.name === name);
    if (existing !== undefined) {
      resolved[name] = existing.secret_id;
      console.log(`  secret ${name}: exists`);
      continue;
    }
    if (DRY) {
      resolved[name] = `<${name} would be created>`;
      console.log(`  secret ${name}: would create`);
      continue;
    }
    const created = await api<{ secret_id: string }>('POST', '/v1/convai/secrets', {
      type: 'new',
      name,
      value: required(name),
    });
    resolved[name] = created.secret_id;
    console.log(`  secret ${name}: created`);
  }

  return resolved;
}

// ----------------------------------------------------------- 2 knowledge base

type KbList = { documents: { id: string; name: string; metadata?: { size_bytes?: number } }[] };

async function syncKnowledgeBase(): Promise<{ entries: JsonObject[]; ids: JsonObject }> {
  const live = await api<KbList>('GET', '/v1/convai/knowledge-base?page_size=100');
  const entries: JsonObject[] = [];
  const ids: JsonObject = {};

  for (const document of config.resolve.knowledge_base) {
    const text = readText(document.file);
    const bytes = Buffer.byteLength(text, 'utf8');
    const existing = live.documents.find((candidate) => candidate.name === document.name);

    let id: string;
    if (existing === undefined) {
      if (DRY) {
        console.log(`  knowledge ${document.name}: would create, ${bytes} bytes`);
        entries.push({ type: 'text', name: document.name, id: '<pending>', usage_mode: document.usage_mode });
        continue;
      }
      const created = await api<{ id: string }>('POST', '/v1/convai/knowledge-base/text', {
        name: document.name,
        text,
      });
      id = created.id;
      console.log(`  knowledge ${document.name}: created ${id}, ${bytes} bytes`);
    } else {
      id = existing.id;
      const liveBytes = existing.metadata?.size_bytes;
      const same = liveBytes === undefined || liveBytes === bytes;
      console.log(
        `  knowledge ${document.name}: exists ${id}` +
          (same ? `, ${bytes} bytes match` : `, SIZE DRIFT live ${liveBytes} vs local ${bytes}`),
      );
    }

    if (document.rag_index) {
      const index = await api<{ indexes: { id: string; status: string }[] }>(
        'GET',
        `/v1/convai/knowledge-base/${id}/rag-index`,
      );
      const done = index.indexes.find((entry) => entry.status === 'succeeded');
      if (done !== undefined) {
        ids[`${document.name}_rag_index_id`] = done.id;
        console.log(`  knowledge ${document.name}: rag index ${done.id} succeeded`);
      } else if (DRY) {
        console.log(`  knowledge ${document.name}: would index for rag`);
      } else {
        const started = await api<{ id: string; status: string }>(
          'POST',
          `/v1/convai/knowledge-base/${id}/rag-index`,
          { model: 'e5_mistral_7b_instruct' },
        );
        ids[`${document.name}_rag_index_id`] = started.id;
        console.log(`  knowledge ${document.name}: rag index ${started.id} ${started.status}`);
      }
    }

    ids[`${document.name}_document_id`] = id;
    entries.push({ type: 'text', name: document.name, id, usage_mode: document.usage_mode });
  }

  return { entries, ids };
}

// --------------------------------------------------------------------- 3 tools

type ToolList = { tools: { id: string; tool_config: JsonObject }[] };

/** Rewrites our own {"secret_name": "X"} marker into the platform's {"secret_id": "..."}. */
function resolveSecretRefs(node: unknown, secrets: Record<string, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => resolveSecretRefs(item, secrets));
  if (!isObject(node)) return node;
  if (typeof node.secret_name === 'string') {
    const id = secrets[node.secret_name];
    if (id === undefined) throw new Error(`push: no resolved secret named ${node.secret_name}`);
    return { secret_id: id };
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, resolveSecretRefs(value, secrets)]),
  );
}

async function syncTools(secrets: Record<string, string>): Promise<Record<string, string>> {
  const live = await api<ToolList>('GET', '/v1/convai/tools');
  const resolved: Record<string, string> = {};

  for (const name of config.resolve.tools) {
    const desired = resolveSecretRefs(readJson<JsonObject>(`tools/${name}.json`), secrets) as JsonObject;
    const existing = live.tools.find((tool) => tool.tool_config.name === name);

    if (existing === undefined) {
      report(`tool ${name}`, [`(absent) -> create`]);
      if (DRY) {
        resolved[name] = `<${name} would be created>`;
        continue;
      }
      const created = await api<{ id: string }>('POST', '/v1/convai/tools', { tool_config: desired });
      resolved[name] = created.id;
      console.log(`    created ${created.id}`);
      continue;
    }

    resolved[name] = existing.id;
    const changes = diff(existing.tool_config, desired);
    const dirty = report(`tool ${name} (${existing.id})`, changes);
    if (dirty && !DRY) {
      await api('PATCH', `/v1/convai/tools/${existing.id}`, { tool_config: desired });
      console.log(`    updated`);
    }
  }

  return resolved;
}

// --------------------------------------------------------------------- 4 tests

type TestList = { tests: { id: string; name: string }[] };

/** Test files reference tools by name. The platform keys mocks by id. */
function resolveToolRefs(node: unknown, tools: Record<string, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => resolveToolRefs(item, tools));
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'mocked_tool_names') {
      out.mocked_tool_ids = (value as string[]).map((name) => tools[name] ?? name);
    } else if (key === 'tool_mock_overrides' && isObject(value)) {
      out.tool_mock_overrides = Object.fromEntries(
        Object.entries(value).map(([toolName, mocks]) => [tools[toolName] ?? toolName, mocks]),
      );
    } else {
      out[key] = resolveToolRefs(value, tools);
    }
  }
  return out;
}

async function syncTests(tools: Record<string, string>): Promise<Record<string, string>> {
  const live = await api<TestList>('GET', '/v1/convai/agent-testing?page_size=100');
  const resolved: Record<string, string> = {};

  for (const name of config.resolve.tests) {
    const desired = resolveToolRefs(readJson<JsonObject>(`tests/${name}.json`), tools) as JsonObject;
    const existing = live.tests.find((test) => test.name === name);

    if (existing === undefined) {
      report(`test ${name}`, ['(absent) -> create']);
      if (DRY) {
        resolved[name] = `<${name} would be created>`;
        continue;
      }
      const created = await api<{ id: string }>('POST', '/v1/convai/agent-testing/create', desired);
      resolved[name] = created.id;
      console.log(`    created ${created.id}`);
      continue;
    }

    resolved[name] = existing.id;
    const current = await api<JsonObject>('GET', `/v1/convai/agent-testing/${existing.id}`);
    const changes = diff(current, desired);
    const dirty = report(`test ${name} (${existing.id})`, changes);
    if (dirty && !DRY) {
      await api('PUT', `/v1/convai/agent-testing/${existing.id}`, desired);
      console.log(`    updated`);
    }
  }

  return resolved;
}

// --------------------------------------------------------------------- 5 agent

async function syncAgent(
  toolIds: string[],
  knowledgeBase: JsonObject[],
  testIds: string[],
): Promise<void> {
  const liveAgent = await api<JsonObject>('GET', `/v1/convai/agents/${AGENT_ID}`);

  const desiredFragment = {
    name: config.agent_name,
    conversation_config: deepMerge(config.conversation_config, {
      agent: {
        prompt: {
          prompt: readText(config.resolve.prompt_file),
          tool_ids: toolIds,
          knowledge_base: knowledgeBase,
        },
      },
    }),
    platform_settings: deepMerge(config.platform_settings, {
      testing: { attached_tests: testIds.map((id) => ({ test_id: id })) },
    }),
  };

  const changes = diff(liveAgent, desiredFragment);
  const dirty = report('agent', changes);
  if (!dirty || DRY) return;

  // Merged onto live rather than sent bare. The platform replaces a nested object
  // it receives, so posting only the fields this build owns would drop the voice,
  // turn taking and widget settings that live beside them.
  const conversationConfig = deepMerge(
    liveAgent.conversation_config,
    desiredFragment.conversation_config,
  ) as JsonObject;

  // prompt.tools is the deprecated inline form of prompt.tool_ids, and the API
  // rejects a body carrying both. It is only ever populated by the platform
  // echoing our own tool_ids back, so dropping it from the patch loses nothing.
  const prompt = (conversationConfig.agent as JsonObject | undefined)?.prompt;
  if (isObject(prompt)) delete prompt.tools;

  await api('PATCH', `/v1/convai/agents/${AGENT_ID}`, {
    name: desiredFragment.name,
    conversation_config: conversationConfig,
    platform_settings: deepMerge(liveAgent.platform_settings, desiredFragment.platform_settings),
  });
  console.log('    updated');
}

// ----------------------------------------------------------------- test runner

async function runTests(testIds: Record<string, string>): Promise<void> {
  const selected = ONLY.length === 0 ? testIds : Object.fromEntries(ONLY.map((n) => [n, testIds[n]]));
  const missing = Object.entries(selected).filter(([, id]) => id === undefined);
  if (missing.length > 0) throw new Error(`push: unknown test ${missing.map(([n]) => n).join(', ')}`);

  const ids = Object.values(selected);
  console.log(`running ${ids.length} tests against ${AGENT_ID}`);

  const invocation = await api<{
    id: string;
    test_runs: { test_id: string; test_name: string; status: string }[];
  }>('POST', `/v1/convai/agents/${AGENT_ID}/run-tests`, {
    tests: ids.map((test_id) => ({ test_id })),
  });

  let runs = invocation.test_runs;
  for (let attempt = 0; attempt < 60 && runs.some((run) => run.status === 'pending'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const polled = await api<{ test_runs: typeof runs }>(
      'GET',
      `/v1/convai/test-invocations/${invocation.id}`,
    );
    runs = polled.test_runs;
  }

  let failed = 0;
  for (const run of runs) {
    const verdict = run.status === 'passed' ? 'PASS' : 'FAIL';
    if (run.status !== 'passed') failed += 1;
    console.log(`  ${verdict}  ${run.test_name ?? run.test_id}  (${run.status})`);
  }
  console.log(`invocation ${invocation.id}`);
  if (failed > 0) exit(1);
}

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  console.log(DRY ? 'agent:push --dry, nothing will be written' : 'agent:push');
  console.log(`agent ${AGENT_ID}`);

  const secrets = await syncSecrets();
  const knowledge = await syncKnowledgeBase();
  const tools = await syncTools(secrets);
  const tests = await syncTests(tools);
  await syncAgent(Object.values(tools), knowledge.entries, Object.values(tests));

  if (RUN_TESTS) {
    await runTests(tests);
    return;
  }

  if (DRY) return;

  writeFileSync(
    new URL('ids.json', HERE),
    `${JSON.stringify(
      {
        agent_id: AGENT_ID,
        secrets,
        knowledge_base: knowledge.ids,
        tools,
        tests,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log('wrote agent/ids.json');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
