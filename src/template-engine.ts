/** Replaces every `{{key}}` token in `content` with `vars[key]`. */
export function renderTemplate(content: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    content,
  );
}
