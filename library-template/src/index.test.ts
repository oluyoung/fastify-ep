import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { {{LibraryName}}Schema } from './index.js';

describe('{{LibraryName}}Schema', () => {
  it('accepts a valid value', () => {
    expect(Value.Check({{LibraryName}}Schema, { id: '1', name: 'example' })).toBe(true);
  });

  it('rejects a value without a name', () => {
    expect(Value.Check({{LibraryName}}Schema, { id: '1' })).toBe(false);
  });
});
