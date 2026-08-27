import { apiFetch, type SessionUser } from './api'

/** Staging-only helpers. Never imported by the production bundle. */
export function loginTestAccount(): Promise<{ token: string; user: SessionUser }> {
  return apiFetch('/api/competition/auth/test-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ARTEMTEST987' }),
  })
}

export function sendPushTest(token: string): Promise<{ sent: number; configured: boolean; devices: number }> {
  return apiFetch('/api/competition/me/push-test', { method: 'POST' }, token)
}
