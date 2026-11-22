// Notices the controller showed. Test files mock the notify module with
// `vi.mock('@/core/notify', () => import('../../../support/toasts'))`.

import type { NotifyOptions } from '@/core/notify';

export interface ToastCall { text: string; action?: string; error?: boolean }

export const toasts: ToastCall[] = [];

export function notify(text: string, opts: NotifyOptions = {}): void {
  toasts.push({ text, action: opts.action?.label, ...(opts.error ? { error: true } : {}) });
}
