import postgres from '@prisma/orm-postgres/runtime';
import contractJson from './contract.json' with { type: 'json' };
import ENV from '../../utils/env.js';

export const db = postgres({
  contractJson,
  url: ENV.DB_URL,
});

export default db;