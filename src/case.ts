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
