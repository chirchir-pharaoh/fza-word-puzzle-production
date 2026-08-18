#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPoolFromEnv, migrate, ensureDefaultChallenge } = require('../server/db.js');

// Applies the same schema used by the Vercel Function. This is useful when you
// prefer an explicit deployment step instead of RUN_MIGRATIONS_ON_START=true.
async function main(){
  const pool = createPoolFromEnv(process.env);
  try {
    await migrate(pool);
    const challenge = await ensureDefaultChallenge(pool, process.env);
    console.log(`Migration complete for challenge: ${challenge.id}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
