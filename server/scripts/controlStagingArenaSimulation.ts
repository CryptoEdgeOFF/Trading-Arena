import 'dotenv/config';

const STAGING_API_URL = (
  process.env.STAGING_API_URL
  || 'https://btf-mobile-staging-production.up.railway.app'
).replace(/\/+$/, '');

type Command = 'status' | 'start' | 'stop' | 'remove';

function readCommand(): Command {
  const value = String(process.argv[2] || 'status').toLowerCase();
  if (value === 'status' || value === 'start' || value === 'stop' || value === 'remove') return value;
  throw new Error('Commande attendue : status, start, stop ou remove');
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Réponse staging invalide (${response.status}) : ${text.slice(0, 200)}`);
  }
}

async function getAdminToken(): Promise<string> {
  const existing = String(process.env.STAGING_ADMIN_TOKEN || '').trim();
  if (existing) return existing;

  const code = String(process.env.STAGING_ADMIN_CODE || '').trim();
  if (!code) {
    throw new Error('Renseigne STAGING_ADMIN_CODE ou STAGING_ADMIN_TOKEN avant de contrôler la simulation.');
  }
  const response = await fetch(`${STAGING_API_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const payload = await parseResponse(response);
  if (!response.ok || typeof payload.token !== 'string') {
    throw new Error(String(payload.error || `Connexion admin refusée (${response.status})`));
  }
  return payload.token;
}

async function main() {
  const command = readCommand();
  const token = await getAdminToken();
  const isStatus = command === 'status';
  const endpoint = isStatus
    ? '/api/admin/staging-simulation'
    : `/api/admin/staging-simulation/${command === 'remove' ? 'stop' : command}`;
  const response = await fetch(`${STAGING_API_URL}${endpoint}`, {
    method: isStatus ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isStatus ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isStatus ? undefined : JSON.stringify({ removeArena: command === 'remove' }),
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(String(payload.error || `Commande refusée (${response.status})`));

  console.log(JSON.stringify({
    staging: STAGING_API_URL,
    command,
    leaderboardUrl: payload.competitionId
      ? `http://localhost:5173/compete/leaderboard/${payload.competitionId}`
      : null,
    ...payload,
  }, null, 2));
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
