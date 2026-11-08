import type { DiStrategy } from './manifest.js';

export interface WiringParams {
  di: DiStrategy;
  kind: 'service' | 'repository';
  /** Class name, for example `NotificationsService`. */
  className: string;
  /** Decorator or cradle key, for example `notificationsService`. */
  key: string;
  /** File name without directory, for example `notifications.service.js`. */
  importFile: string;
  /** The repository is given the database; a service starts with no dependencies. */
  withDb: boolean;
  /** Awilix only. */
  lifetime: 'SINGLETON' | 'SCOPED';
}

export interface WiringSnippets {
  importLine: string;
  /** Goes inside the `declare module` interface. */
  augmentation: string;
  /** Goes inside `registerDependencies`. */
  registration: string;
}

export function wiringSnippets(p: WiringParams): WiringSnippets {
  const importLine = `import { ${p.className} } from './${p.importFile}';`;
  const augmentation = `    ${p.key}: ${p.className};`;
  const registration =
    p.di === 'awilix'
      ? `    ${p.key}: asClass(${p.className}, { lifetime: Lifetime.${p.lifetime} }),`
      : `  fastify.decorate('${p.key}', new ${p.className}(${p.withDb ? '{ db: fastify.db }' : ''}));`;
  return { importLine, augmentation, registration };
}

const IMPORTS_END = /\n\n(?=declare module )/;
const AUGMENTATION_END =
  /(declare module '(?:fastify|@fastify\/awilix)' \{\n {2}interface (?:FastifyInstance|Cradle) \{\n(?: {4}.*\n)*)( {2}\}\n\})/;
const NATIVE_REGISTRATION_END =
  /(async function registerDependencies\(fastify: FastifyInstance\): Promise<void> \{\n[\s\S]*?\n)(\}\n)/;
const AWILIX_REGISTRATION_END = /(fastify\.diContainer\.register\(\{\n[\s\S]*?\n)( {2}\}\);\n)/;

/**
 * Adds an import, a type entry and a registration to a generated `<module>.module.ts`. Returns
 * undefined, changing nothing, unless all three places are found: the file is yours, and a partial
 * edit would leave it not compiling.
 */
export function wireModule(content: string, params: WiringParams): string | undefined {
  const { importLine, augmentation, registration } = wiringSnippets(params);
  const registrationPattern =
    params.di === 'awilix' ? AWILIX_REGISTRATION_END : NATIVE_REGISTRATION_END;
  if (
    !IMPORTS_END.test(content) ||
    !AUGMENTATION_END.test(content) ||
    !registrationPattern.test(content)
  ) {
    return undefined;
  }
  return content
    .replace(IMPORTS_END, () => `\n${importLine}\n\n`)
    .replace(
      AUGMENTATION_END,
      (_m, head: string, tail: string) => `${head}${augmentation}\n${tail}`,
    )
    .replace(
      registrationPattern,
      (_m, head: string, tail: string) => `${head}${registration}\n${tail}`,
    );
}
