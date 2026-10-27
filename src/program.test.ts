import { describe, expect, it, vi } from 'vitest';
import { createProgram } from './program.js';

function setup() {
  const generateModule = vi.fn(async () => {});
  const generateResource = vi.fn(async () => {});
  const generateLibrary = vi.fn(async () => {});
  const program = createProgram({ generateModule, generateResource, generateLibrary });
  // Throw instead of exiting, and keep usage errors out of the test output.
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  for (const command of program.commands) {
    command.exitOverride();
    command.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    for (const sub of command.commands) {
      sub.exitOverride();
      sub.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    }
  }
  const parse = (...args: string[]) => program.parseAsync(['node', 'fastify-ep', ...args]);
  return { generateModule, generateResource, generateLibrary, parse, program };
}

describe('generate alias', () => {
  it('"g" is shorthand for "generate"', () => {
    const { program } = setup();
    const generate = program.commands.find((command) => command.name() === 'generate');

    expect(generate?.aliases()).toEqual(['g']);
  });

  it('"g module" runs the module generator', async () => {
    const { generateModule, parse } = setup();

    await parse('g', 'module', 'orders');

    expect(generateModule).toHaveBeenCalledWith('orders', process.cwd(), {
      withTests: true,
      scope: 'singleton',
    });
  });

  it('"g resource" runs the resource generator', async () => {
    const { generateResource, parse } = setup();

    await parse('g', 'resource', 'users');

    expect(generateResource).toHaveBeenCalledTimes(1);
  });

  it('"generate" still works', async () => {
    const { generateModule, parse } = setup();

    await parse('generate', 'module', 'orders');

    expect(generateModule).toHaveBeenCalledTimes(1);
  });
});

describe('generate resource', () => {
  it('defaults to no CRUD, tests on and singleton scope', async () => {
    const { generateResource, parse } = setup();

    await parse('generate', 'resource', 'users');

    expect(generateResource).toHaveBeenCalledWith('users', process.cwd(), {
      crud: undefined,
      withTests: true,
      scope: 'singleton',
      singular: undefined,
    });
  });

  it('passes --crud, --no-test, --scope and --singular through', async () => {
    const { generateResource, parse } = setup();

    await parse(
      'g',
      'resource',
      'people',
      '--crud',
      '--no-test',
      '--scope',
      'request',
      '--singular',
      'person',
    );

    expect(generateResource).toHaveBeenCalledWith('people', process.cwd(), {
      crud: true,
      withTests: false,
      scope: 'request',
      singular: 'person',
    });
  });

  it.each([
    ['module', ['g', 'module', 'orders', '--scope', 'bogus']],
    ['resource', ['g', 'resource', 'users', '--scope', 'bogus']],
  ])('rejects an unknown --scope for %s without generating', async (_kind, args) => {
    const { generateModule, generateResource, parse } = setup();

    await expect(parse(...args)).rejects.toThrow(/must be one of: singleton, request/);

    expect(generateModule).not.toHaveBeenCalled();
    expect(generateResource).not.toHaveBeenCalled();
  });

  it('requires a name', async () => {
    const { generateResource, parse } = setup();

    await expect(parse('g', 'resource')).rejects.toThrow(/missing required argument/);

    expect(generateResource).not.toHaveBeenCalled();
  });
});

describe('--project', () => {
  it.each(['--project', '-C'])('%s reaches generate module', async (flag) => {
    const { generateModule, parse } = setup();

    await parse('generate', 'module', 'orders', flag, 'apps/users-api');

    expect(generateModule).toHaveBeenCalledWith(
      'orders',
      process.cwd(),
      expect.objectContaining({ project: 'apps/users-api' }),
    );
  });

  it('reaches generate resource', async () => {
    const { generateResource, parse } = setup();

    await parse('g', 'resource', 'users', '--crud', '-C', 'apps/billing-api');

    expect(generateResource).toHaveBeenCalledWith(
      'users',
      process.cwd(),
      expect.objectContaining({ crud: true, project: 'apps/billing-api' }),
    );
  });

  it('is optional', async () => {
    const { generateModule, parse } = setup();

    await parse('generate', 'module', 'orders');

    expect(generateModule).toHaveBeenCalledWith(
      'orders',
      process.cwd(),
      expect.objectContaining({ project: undefined }),
    );
  });

  it('doctor accepts it', () => {
    const { program } = setup();
    const doctor = program.commands.find((command) => command.name() === 'doctor');
    expect(doctor?.options.map((option) => option.long)).toContain('--project');
  });
});

describe('generate library', () => {
  it('passes the name, --name and --dir through with the CLI version', async () => {
    const { generateLibrary, parse } = setup();

    await parse(
      'generate',
      'library',
      'contracts',
      '--name',
      '@acme/contracts',
      '--dir',
      'libs/contracts',
    );

    expect(generateLibrary).toHaveBeenCalledWith('contracts', process.cwd(), {
      name: '@acme/contracts',
      dir: 'libs/contracts',
      cliVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
  });

  it('"g library" works and the options are optional', async () => {
    const { generateLibrary, parse } = setup();

    await parse('g', 'library', 'contracts');

    expect(generateLibrary).toHaveBeenCalledWith(
      'contracts',
      process.cwd(),
      expect.objectContaining({ name: undefined, dir: undefined }),
    );
  });
});
