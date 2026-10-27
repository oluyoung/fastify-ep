function toWords(name: string): string[] {
  return name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
}

export function toCamelCase(name: string): string {
  const [first, ...rest] = toWords(name);
  if (!first) return '';
  return (
    first.toLowerCase() +
    rest.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join('')
  );
}

export function toPascalCase(name: string): string {
  const camel = toCamelCase(name);
  return camel ? camel[0].toUpperCase() + camel.slice(1) : '';
}

/**
 * Naive English singular of a plural resource name, for entity names (`users` -> `user`).
 * Irregular plurals are not handled; `generate resource --singular` overrides this.
 */
export function singularize(name: string): string {
  let singular = name;
  if (/ies$/.test(name)) singular = `${name.slice(0, -3)}y`;
  else if (/(sses|xes|ches|shes)$/.test(name)) singular = name.slice(0, -2);
  else if (/s$/.test(name) && !/ss$/.test(name)) singular = name.slice(0, -1);
  return singular || name;
}
