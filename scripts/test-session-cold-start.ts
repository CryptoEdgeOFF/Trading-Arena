/**
 * Reproduit la trajectoire d'un user en serverless avec des "cold starts" :
 * - Instance A : requestOtp + verifyOtp (login) -> emet un session token
 * - Instance B (toute neuve) : recoit le token et doit pouvoir resoudre l'user
 *
 * On verifie que les sessions/OTPs/trader-sessions vivent bien dans leurs
 * propres tables Postgres et survivent a une nouvelle instance.
 */
import 'dotenv/config';
import { CompetitionManager } from '../server/competitionManager.js';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log('=== Instance A : login flow ===');
  const a = new CompetitionManager();
  await a.ready;

  // On utilise un email unique pour ne pas polluer la prod.
  const email = `coldstart-${Date.now()}@btf-test.local`;

  // Le user doit exister pour le login. Cree le directement via signup flow.
  // Pour aller au plus court on insere un user "fake" via verifyPhoneOtp en
  // bypassant la mecanique normale. Dans la realite, c'est l'inscription qui
  // cree l'user. Ici on triche en utilisant directement une simulation.

  // En vrai flow : signup -> verify -> verify-phone. Pour le test on simule
  // juste un user qui existe deja => on peut faire un signup complet rapide.

  // 1) requestOtp signup
  await a.requestOtp({ email, name: 'ColdTester', phone: '+33600000099', intent: 'signup' });
  console.log('Instance A: signup OTP requested');

  // 2) Recupere directement le code via la DB (en mode test)
  const otpRow = await a['pool']!.query('select data from comp_pending_otps where email = $1', [email]);
  const code = otpRow.rows[0].data.code as string;
  console.log('Instance A: signup email code =', code);

  // 3) verifyOtp -> bascule en step phone
  const v1 = await a.verifyOtp({ email, code });
  if (!('needsPhone' in v1)) {
    throw new Error('Expected needsPhone');
  }
  console.log('Instance A: email verified, awaiting phone');

  // 4) Recupere le code SMS local
  const otpRow2 = await a['pool']!.query('select data from comp_pending_otps where email = $1', [email]);
  const smsCode = otpRow2.rows[0].data.code as string;

  const v2 = await a.verifyPhoneOtp({ email, code: smsCode, smsApprovedExternally: false });
  if (!('token' in v2)) throw new Error('Expected token after phone verification');
  console.log('Instance A: signup complete, token=', v2.token.slice(0, 12), '... user=', v2.user.email);

  const sessionToken = v2.token;

  // === Instance B : nouveau process simule ===
  console.log('\n=== Instance B : cold start ===');
  const b = new CompetitionManager();
  await b.ready;

  // CRITIQUE : on resout le token sur l'instance B fraichement creee.
  const userOnB = await b.getUserFromToken(sessionToken);
  if (!userOnB) {
    console.error('ECHEC : Instance B ne retrouve pas le user a partir du token');
    process.exit(1);
  }
  console.log('Instance B: token resolu ->', userOnB.email);

  // Verifie aussi un trader session
  await b.setTraderSession('trader-token-test', 'fake-player', null);
  console.log('Instance B: trader session ecrit');

  const c = new CompetitionManager();
  await c.ready;
  const ts = await c.getTraderSession('trader-token-test');
  if (!ts) {
    console.error('ECHEC : Instance C ne retrouve pas la trader session');
    process.exit(1);
  }
  console.log('Instance C: trader session retrouvee ->', ts);

  await c.deleteTraderSession('trader-token-test');
  console.log('Instance C: cleanup OK');

  // Cleanup : supprime le user de test pour ne pas polluer
  if (a['pool']) {
    await a['pool'].query('delete from comp_user_sessions where token = $1', [sessionToken]);
    console.log('Cleanup: session de test supprimee');
  }

  console.log('\n*** SUCCES : sessions, OTPs et trader-sessions survivent aux cold starts ***');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
