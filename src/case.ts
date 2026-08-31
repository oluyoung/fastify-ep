/** Splits a module name on non-alphanumeric boundaries (`-`, `_`, spaces) into words. */
function toWords(name: string): string[] {
  return name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
}

/** `user-profiles` -> `userProfiles`. Used for JS identifiers (decorate keys, params). */
export function toCamelCase(name: string): string {
  const [first, ...rest] = toWords(name);
  if (!first) return '';
  return (
    first.toLowerCase() +
    rest.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join('')
  );
}

/** `user-profiles` -> `UserProfiles`. Used for class/type names. */
export function toPascalCase(name: string): string {
  const camel = toCamelCase(name);
  return camel ? camel[0].toUpperCase() + camel.slice(1) : '';
}
