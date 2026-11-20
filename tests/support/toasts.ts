// Toasts the controller showed. Test files mock the toast module with
// `vi.mock('@/features/queue/toast', () => import('../../../support/toasts'))`.

export interface ToastCall { text: string; action?: string }

export const toasts: ToastCall[] = [];

export function toast(text: string, action?: { label: string }): void {
  toasts.push({ text, action: action?.label });
}
