import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

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

export async function createStore({ rootDir, seedData, normalize }) {
  const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
  const dataFile = path.join(dataDir, "app-data.json");
  const connectionString = postgresUrl();
  const writeMirror = async state => {
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
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(dataFile, `${JSON.stringify(state, null, 2)}\n`);
    }
    return {
      type: "json",
      state,
      async save(nextState) {
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(dataFile, `${JSON.stringify(nextState, null, 2)}\n`);
      },
      async close() {}
    };
  }

  const pool = new Pool({ connectionString });
  await waitForPostgres(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS application_state (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const result = await pool.query("SELECT data FROM application_state WHERE id = 'primary'");
  let state;
  if (result.rowCount) {
    state = normalize(result.rows[0].data);
  } else {
    try {
      state = normalize(JSON.parse(await fs.readFile(dataFile, "utf8")));
    } catch {
      state = normalize(structuredClone(seedData));
    }
    await pool.query(
      "INSERT INTO application_state (id, data) VALUES ('primary', $1::jsonb)",
      [JSON.stringify(state)]
    );
  }
  await writeMirror(state);

  return {
    type: "postgresql",
    state,
    async save(nextState) {
      await pool.query(
        `INSERT INTO application_state (id, data, updated_at)
         VALUES ('primary', $1::jsonb, now())
         ON CONFLICT (id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [JSON.stringify(nextState)]
      );
      await writeMirror(nextState);
    },
    async close() {
      await pool.end();
    }
  };
}
