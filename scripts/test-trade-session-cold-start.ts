/**
 * Reproduit le bug "Acces requis" : un user clique Trader (Lambda A) puis
 * la page /trade fait paper/me sur un Lambda B/C tout neuf. Le test verifie
 * que le player et la trader-session survivent au cold start.
 */
import 'dotenv/config';
import crypto from 'crypto';
import { CompetitionManager } from '../server/competitionManager.js';
import { PlayerManager } from '../server/playerManager.js';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log('=== Lambda A : trade/session ===');
  const compA = new CompetitionManager();
  const playerA = new PlayerManager(() => {});
  await Promise.all([compA.ready, playerA.ready]);

  // Cree un faux user et une session pour simuler getCompetitionUser
  const email = `tradetest-${Date.now()}@btf-test.local`;
  await compA.requestOtp({ email, name: 'TradeTester', phone: `+3360${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, intent: 'signup' });
  const otp = await compA['pool']!.query('select data from comp_pending_otps where email = $1', [email]);
  const code = otp.rows[0].data.code as string;
  const v1 = await compA.verifyOtp({ email, code });
  if (!('needsPhone' in v1)) throw new Error('expected needsPhone');
  const otp2 = await compA['pool']!.query('select data from comp_pending_otps where email = $1', [email]);
  const v2 = await compA.verifyPhoneOtp({ email, code: otp2.rows[0].data.code as string, smsApprovedExternally: false });
  if (!('token' in v2)) throw new Error('expected token');
  const userToken = v2.token;
  const userId = v2.user.id;
  console.log('User cree :', email, '-> id=', userId);

  // Cree une competition et fait rejoindre l'user
  const compCode = `TEST${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const comp = compA.createCompetition({
    title: 'TestArene',
    startAt: Date.now() - 60_000,
    endAt: Date.now() + 60 * 60 * 1000,
    isPublic: true,
    code: compCode,
    executionMode: 'paper',
    cashPrize: null,
  });
  compA.joinCompetition(userId, comp.code);
  // Persiste explicitement avant le refresh, sinon le refresh efface ces
  // mutations en lisant un blob DB encore non a jour.
  await compA.persist();
  console.log('User a rejoint la compe', comp.id, 'code=', comp.code);

  // Simule le code de l'endpoint trade/session
  await Promise.all([compA.refresh(), playerA.refresh()]);
  const { competition, entry } = compA.getCompetitionForUser(comp.id, userId);
  let player = entry.paperPlayerId ? playerA.getPlayerById(entry.paperPlayerId) : null;
  if (!player) {
    player = playerA.registerPlayer(v2.user.name || 'Trader', '', '');
    compA.linkPaperPlayer(competition.id, userId, player.id);
  }
  const ready = await playerA.setupCompetitionPaperPlayer(player.id);
  if (!ready) throw new Error('setup failed');
  player = ready;

  const traderToken = crypto.randomBytes(24).toString('hex');
  await Promise.all([
    compA.setTraderSession(traderToken, player.id, competition.id),
    playerA.persistPlayer(player.id),
    compA.persist(),
  ]);
  console.log('Lambda A : player =', player.id, ', traderToken =', traderToken.slice(0, 12), '...');

  // === Lambda B : paper/me ===
  console.log('\n=== Lambda B : paper/me (cold start) ===');
  const compB = new CompetitionManager();
  const playerB = new PlayerManager(() => {});
  await Promise.all([compB.ready, playerB.ready]);

  // Reproduit getSessionPlayer
  const traderInfo = await compB.getTraderSession(traderToken);
  if (!traderInfo) {
    console.error('ECHEC : Lambda B ne retrouve pas la trader session');
    process.exit(1);
  }
  console.log('Lambda B : trader session resolved ->', traderInfo.playerId);

  let foundPlayer = playerB.getPlayerById(traderInfo.playerId);
  if (!foundPlayer) {
    await playerB.refresh();
    foundPlayer = playerB.getPlayerById(traderInfo.playerId);
  }
  if (!foundPlayer) {
    console.error('ECHEC : Lambda B ne retrouve pas le player apres refresh');
    process.exit(1);
  }
  console.log('Lambda B : player resolved ->', foundPlayer.name, foundPlayer.id);

  // === Cleanup ===
  console.log('\n=== Cleanup ===');
  await compA['pool']!.query('delete from comp_user_sessions where token = $1', [userToken]);
  await compA['pool']!.query('delete from comp_trader_sessions where token = $1', [traderToken]);
  playerA.removePlayer(player.id);
  await new Promise((r) => setTimeout(r, 500));
  // Suppression de l'user et de la compe
  await compA['pool']!.query(
    `update competition_store set value = jsonb_build_object(
      'users', (value->'users') - $1,
      'competitions', (value->'competitions') - $2
    )
    where key = 'main'`,
    [userId, comp.id],
  );

  console.log('\n*** SUCCES : trade/session -> paper/me survit au cold start ***');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
