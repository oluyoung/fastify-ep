import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const {{camelModuleName}}Table = pgTable('{{tableName}}', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
});
