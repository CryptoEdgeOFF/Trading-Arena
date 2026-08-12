import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  loginTestAccount,
  requestAuthCode,
  verifyAuthCode,
  verifyPhoneCode,
  type SessionUser,
} from '../lib/api'

type Intent = 'login' | 'signup'
type Step = 'identity' | 'email-code' | 'phone-code'

export function AuthSheet({
  onClose,
  onAuthenticated,
}: {
  onClose: () => void
  onAuthenticated: (token: string, user: SessionUser) => Promise<void>
}) {
  const [intent, setIntent] = useState<Intent>('login')
  const [step, setStep] = useState<Step>('identity')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')

  function changeIntent(next: Intent) {
    setIntent(next)
    setStep('identity')
    setCode('')
    setError('')
    setHint('')
  }

  async function submitIdentity(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await requestAuthCode({
        email: email.trim(),
        intent,
        name: intent === 'signup' ? name.trim() : undefined,
        phone: intent === 'signup' ? phone.trim() : undefined,
        consent: intent === 'signup',
      })
      setEmail(result.email)
      setStep('email-code')
      setHint(result.devCode ? `Code de développement : ${result.devCode}` : 'Code envoyé par e-mail')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Connexion impossible')
    } finally {
      setBusy(false)
    }
  }

  async function submitEmailCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await verifyAuthCode(email, code)
      if (result.needsPhone) {
        setStep('phone-code')
        setCode('')
        setHint(result.devSmsCode ? `Code de développement : ${result.devSmsCode}` : `Code SMS envoyé au ${result.phoneMasked || 'numéro renseigné'}`)
        return
      }
      if (!result.token || !result.user) throw new Error('Réponse de connexion incomplète')
      await onAuthenticated(result.token, result.user)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Code incorrect')
    } finally {
      setBusy(false)
    }
  }

  async function submitPhoneCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await verifyPhoneCode(email, code)
      await onAuthenticated(result.token, result.user)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Code SMS incorrect')
    } finally {
      setBusy(false)
    }
  }

  async function testLogin() {
    setBusy(true)
    setError('')
    try {
      const result = await loginTestAccount()
      await onAuthenticated(result.token, result.user)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Compte test indisponible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <motion.section className="auth-sheet" role="dialog" aria-modal="true" aria-labelledby="auth-title"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}>
        <div className="auth-sheet__handle" />
        <button className="auth-sheet__close" type="button" onClick={onClose} aria-label="Fermer">×</button>
        <span className="auth-sheet__kicker">COMPTE BTF UNIQUE</span>
        <h2 id="auth-title">{step === 'identity' ? (intent === 'login' ? 'Connexion' : 'Inscription') : 'Vérification'}</h2>
        <p className="auth-sheet__intro">
          {step === 'identity'
            ? 'Le même compte fonctionne sur ordinateur et mobile.'
            : hint}
        </p>

        {step === 'identity' && (
          <>
            <div className="auth-tabs">
              <button type="button" className={intent === 'login' ? 'is-active' : ''} onClick={() => changeIntent('login')}>Connexion</button>
              <button type="button" className={intent === 'signup' ? 'is-active' : ''} onClick={() => changeIntent('signup')}>Créer un compte</button>
            </div>
            <form className="auth-form" onSubmit={submitIdentity}>
              {intent === 'signup' && (
                <>
                  <label>Nom ou pseudo<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
                  <label>Téléphone<input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required /></label>
                </>
              )}
              <label>Adresse e-mail<input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required /></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Envoi…' : 'Recevoir mon code'}</button>
            </form>
            {import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true' && (
              <button className="auth-test" type="button" disabled={busy} onClick={() => void testLogin()}>Utiliser ARTEMTEST987</button>
            )}
          </>
        )}

        {step !== 'identity' && (
          <form className="auth-form" onSubmit={step === 'email-code' ? submitEmailCode : submitPhoneCode}>
            <label>Code à 6 chiffres<input className="auth-code" value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required autoFocus /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Vérification…' : 'Continuer'}</button>
            <button className="auth-back" type="button" onClick={() => { setStep('identity'); setCode(''); setError('') }}>Changer d’adresse</button>
          </form>
        )}
      </motion.section>
    </div>
  )
}
