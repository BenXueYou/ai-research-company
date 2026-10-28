import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const source = process.env.DATABASE_URL;
if (!source) throw new Error('Missing database connection');
const name = `issue45_${randomBytes(6).toString('hex')}_test`;
const admin = new URL(source); admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try { await client.query(`CREATE DATABASE "${name}"`); } finally { await client.end(); }
const target = new URL(source); target.pathname = `/${name}`;
writeFileSync('.scratch/issue45.env', `TEST_DATABASE_URL=${target.toString()}\n`);
console.log(`Created dedicated database ${name}`);

