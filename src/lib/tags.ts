export function tagErrorMessage(error: unknown, fallback: string): string {
  const message = String(error);
  if (message.includes('tag name already exists')) return 'tags.duplicateName';
  if (message.includes('tag name cannot be empty')) return 'tags.emptyName';
  return fallback;
}
