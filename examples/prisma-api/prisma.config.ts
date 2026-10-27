import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // `prisma generate` (run by postinstall) needs no database, so don't require the variable there.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
