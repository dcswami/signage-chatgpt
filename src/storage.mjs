import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

const COLLECTIONS = [
  "features",
  "centers",
  "campuses",
  "buildings",
  "rooms",
  "themes",
  "roles",
  "users",
  "sessions",
  "passwordResetTokens",
  "oauthStates",
  "featureGrants",
  "calendarAccounts",
  "calendarAssignments",
  "calendarEvents",
  "calendarConflicts",
  "calendarConflictHistory",
  "calendarSyncHistory",
  "themeSchedules",
  "roomGroups",
  "upcomingEvents",
  "broadcasts",
  "broadcastTemplates",
  "emailNotifications",
  "notifications",
  "kioskDevices",
  "kioskPairingCodes",
  "auditLogs",
  "loginAudit"
];

const TABLES = Object.fromEntries(COLLECTIONS.map(name => [
  name,
  `app_${name.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`)}`
]));

function postgresUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!process.env.POSTGRES_HOST) return "";
  const user = encodeURIComponent(process.env.POSTGRES_USER || "signage_app");
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD || "");
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT || "5432";
  const database = encodeURIComponent(process.env.POSTGRES_DB || "signage");
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

async function waitForPostgres(pool) {
  let lastError;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function runMigrations(pool, rootDir) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const migrationsDir = path.join(rootDir, "database", "migrations");
  let files = [];
  try {
    files = (await fs.readdir(migrationsDir)).filter(file => file.endsWith(".sql")).sort();
  } catch {
    return;
  }
  for (const file of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (applied.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await fs.readFile(path.join(migrationsDir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function readNormalizedState(client) {
  const settingsResult = await client.query("SELECT data FROM app_settings WHERE id = 'primary'");
  const state = { settings: settingsResult.rows[0]?.data || {} };
  for (const collection of COLLECTIONS) {
    const result = await client.query(`SELECT data FROM ${TABLES[collection]} ORDER BY position, id`);
    state[collection] = result.rows.map(row => row.data);
  }
  return state;
}

async function replaceNormalizedState(client, state) {
  await client.query(
    `INSERT INTO app_settings (id, data, updated_at)
     VALUES ('primary', $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(state.settings || {})]
  );
  for (const collection of COLLECTIONS) {
    const table = TABLES[collection];
    const values = Array.isArray(state[collection]) ? state[collection] : [];
    const retainedIds = [];
    for (let position = 0; position < values.length; position += 1) {
      const item = values[position];
      const id = String(item?.id ?? `${collection}-${position}`);
      retainedIds.push(id);
      await client.query(
        `INSERT INTO ${table} (id, position, data, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (id) DO UPDATE
         SET position = EXCLUDED.position,
             data = EXCLUDED.data,
             version = ${table}.version + 1,
             updated_at = now()
         WHERE ${table}.data IS DISTINCT FROM EXCLUDED.data
            OR ${table}.position IS DISTINCT FROM EXCLUDED.position`,
        [id, position, JSON.stringify(item)]
      );
    }
    if (retainedIds.length) {
      await client.query(`DELETE FROM ${table} WHERE NOT (id = ANY($1::text[]))`, [retainedIds]);
    } else {
      await client.query(`DELETE FROM ${table}`);
    }
  }
}

export async function createStore({ rootDir, seedData, normalize }) {
  const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
  const dataFile = path.join(dataDir, "app-data.json");
  const connectionString = postgresUrl();
  const writeMirror = async (state, required = false) => {
    if (!required && process.env.WRITE_JSON_MIRROR !== "true") return;
    try {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(dataFile, `${JSON.stringify(state, null, 2)}\n`);
    } catch (error) {
      console.warn(`Could not update JSON compatibility mirror: ${error.message}`);
    }
  };

  if (!connectionString) {
    let state;
    try {
      state = normalize(JSON.parse(await fs.readFile(dataFile, "utf8")));
    } catch {
      state = normalize(structuredClone(seedData));
      await writeMirror(state, true);
    }
    return {
      type: "json",
      state,
      revision: 0,
      async save(nextState) {
        state = normalize(nextState);
        this.state = state;
        this.revision += 1;
        await writeMirror(state, true);
      },
      async transaction(callback) {
        const draft = structuredClone(this.state);
        const result = await callback(draft);
        await this.save(draft);
        return result;
      },
      async refresh() {
        return this.state;
      },
      async close() {}
    };
  }

  const pool = new Pool({ connectionString, max: Number(process.env.POSTGRES_POOL_SIZE || 15) });
  await waitForPostgres(pool);
  await runMigrations(pool, rootDir);

  const client = await pool.connect();
  let state;
  let revision = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('signage-state-migration'))");
    const meta = await client.query("SELECT revision FROM app_state_metadata WHERE id = 'primary' FOR UPDATE");
    const normalizedCount = await client.query("SELECT count(*)::int AS count FROM app_users");
    if (normalizedCount.rows[0].count > 0) {
      state = normalize(await readNormalizedState(client));
      revision = Number(meta.rows[0]?.revision || 0);
    } else {
      const legacy = await client.query("SELECT data FROM application_state WHERE id = 'primary'");
      if (legacy.rowCount) {
        state = normalize(legacy.rows[0].data);
      } else {
        try {
          state = normalize(JSON.parse(await fs.readFile(dataFile, "utf8")));
        } catch {
          state = normalize(structuredClone(seedData));
        }
      }
      await replaceNormalizedState(client, state);
      revision = 1;
      await client.query(
        `INSERT INTO app_state_metadata (id, revision, migrated_at, updated_at)
         VALUES ('primary', $1, now(), now())
         ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, migrated_at = now(), updated_at = now()`,
        [revision]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await writeMirror(state);

  return {
    type: "postgresql-normalized",
    state,
    revision,
    pool,
    async save(nextState) {
      const normalized = normalize(nextState);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('signage-state-write'))");
        const current = await client.query("SELECT revision FROM app_state_metadata WHERE id = 'primary' FOR UPDATE");
        const databaseRevision = Number(current.rows[0]?.revision || 0);
        if (databaseRevision !== this.revision) {
          const error = new Error("Application data changed on another server. Refresh and retry.");
          error.code = "STATE_CONFLICT";
          throw error;
        }
        await replaceNormalizedState(client, normalized);
        this.revision += 1;
        await client.query("UPDATE app_state_metadata SET revision = $1, updated_at = now() WHERE id = 'primary'", [this.revision]);
        await client.query("COMMIT");
        this.state = normalized;
        await writeMirror(normalized);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async transaction(callback) {
      const draft = structuredClone(this.state);
      const result = await callback(draft);
      await this.save(draft);
      return result;
    },
    async refresh() {
      const client = await pool.connect();
      try {
        const next = normalize(await readNormalizedState(client));
        const meta = await client.query("SELECT revision FROM app_state_metadata WHERE id = 'primary'");
        this.state = next;
        this.revision = Number(meta.rows[0]?.revision || 0);
        return next;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
