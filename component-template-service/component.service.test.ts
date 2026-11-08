import { describe, expect, it } from 'vitest';
import { {{Name}}Service } from './{{name}}.service.js';

describe('{{Name}}Service', () => {
  it('reports its status', () => {
    expect(new {{Name}}Service().getStatus()).toEqual({ name: '{{name}}' });
  });
});
