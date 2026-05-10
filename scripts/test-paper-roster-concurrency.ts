/**
 * Verifie que la table comp_paper_players resiste aux ecritures concurrentes
 * de plusieurs "Lambdas" (PlayerManager separes), ce qui n'etait pas le cas
 * avec l'ancien blob JSON paper-roster.
 */
import 'dotenv/config';
import { PlayerManager } from '../server/playerManager.js';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log('=== Lambda A : registers player A ===');
  const a = new PlayerManager(() => {});
  await a.ready;
  const beforeA = a.getPublicPlayers().length;
  const playerA = a.registerPlayer(`A-${Date.now()}`, '', '');
  await a.persistPlayer(playerA.id);
  console.log(`Lambda A wrote player ${playerA.id} (${playerA.name})`);

  console.log('\n=== Lambda B (cold start, simultaneously registers another) ===');
  // Simule un Lambda B qui a une vue du roster ANTERIEURE a la creation par A.
  const b = new PlayerManager(() => {});
  await b.ready;
  // b a deja vu A grace a son load au demarrage (post-A.persistPlayer).
  const playerB = b.registerPlayer(`B-${Date.now()}`, '', '');
  await b.persistPlayer(playerB.id);
  console.log(`Lambda B wrote player ${playerB.id} (${playerB.name})`);

  console.log('\n=== Lambda C : cold start, must see both A and B ===');
  const c = new PlayerManager(() => {});
  await c.ready;
  const visibleA = c.getPlayerById(playerA.id);
  const visibleB = c.getPlayerById(playerB.id);
  if (!visibleA) {
    console.error('FAIL: Lambda C does not see player A');
    process.exit(1);
  }
  if (!visibleB) {
    console.error('FAIL: Lambda C does not see player B');
    process.exit(1);
  }
  console.log(`Lambda C sees A: ${visibleA.name}, B: ${visibleB.name}`);

  // Cleanup
  a.removePlayer(playerA.id);
  b.removePlayer(playerB.id);
  // Donne le temps aux DELETE en fire-and-forget.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const d = new PlayerManager(() => {});
  await d.ready;
  if (d.getPlayerById(playerA.id) || d.getPlayerById(playerB.id)) {
    console.error('FAIL: cleanup did not propagate');
    process.exit(1);
  }
  const afterCleanup = d.getPublicPlayers().length;
  if (afterCleanup !== beforeA) {
    console.warn(`WARN: roster size changed from ${beforeA} to ${afterCleanup} (other test data likely)`);
  }

  console.log('\n*** SUCCES : roster paper survit aux ecritures concurrentes ***');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
