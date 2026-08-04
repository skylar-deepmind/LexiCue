export const ERR_CANCELLED = 'ERR_CANCELLED';

export function isCancelledError(message: string): boolean {
  return message.includes(ERR_CANCELLED) || message.includes('已取消');
}
