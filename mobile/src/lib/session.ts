import { Preferences } from '@capacitor/preferences'

const SESSION_KEY = 'btf-comp-session'
const PAPER_SESSION_KEY = 'btf-paper-session-compete'

export async function readSessionToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: SESSION_KEY })
  return value || null
}

export async function writeSessionToken(token: string): Promise<void> {
  await Preferences.set({ key: SESSION_KEY, value: token })
}

export async function clearSessionToken(): Promise<void> {
  await Preferences.remove({ key: SESSION_KEY })
}

export async function readPaperSessionToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: PAPER_SESSION_KEY })
  return value || null
}

export async function writePaperSessionToken(token: string): Promise<void> {
  await Preferences.set({ key: PAPER_SESSION_KEY, value: token })
}

export async function clearPaperSessionToken(): Promise<void> {
  await Preferences.remove({ key: PAPER_SESSION_KEY })
}
