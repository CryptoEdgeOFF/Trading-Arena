import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  loginTestAccount,
  requestAuthCode,
  verifyAuthCode,
  verifyPhoneCode,
  type SessionUser,
} from '../lib/api'
import { useI18n } from '../i18n'

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
  const { t } = useI18n()
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
      setHint(result.devCode ? `Dev code: ${result.devCode}` : t('auth.codeSent'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('auth.loginFailed'))
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
        setHint(result.devSmsCode ? `Dev code: ${result.devSmsCode}` : t('auth.smsSent', { phone: result.phoneMasked || t('auth.smsFallback') }))
        return
      }
      if (!result.token || !result.user) throw new Error(t('auth.incomplete'))
      await onAuthenticated(result.token, result.user)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('auth.badCode'))
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
      setError(nextError instanceof Error ? nextError.message : t('auth.badSms'))
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
      setError(nextError instanceof Error ? nextError.message : t('auth.testUnavailable'))
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
        <button className="auth-sheet__close" type="button" onClick={onClose} aria-label={t('auth.close')}>×</button>
        <span className="auth-sheet__kicker">{t('auth.kicker')}</span>
        <h2 id="auth-title">{step === 'identity' ? (intent === 'login' ? t('auth.login') : t('auth.signup')) : t('auth.verify')}</h2>
        <p className="auth-sheet__intro">
          {step === 'identity' ? t('auth.intro') : hint}
        </p>

        {step === 'identity' && (
          <>
            <div className="auth-tabs">
              <button type="button" className={intent === 'login' ? 'is-active' : ''} onClick={() => changeIntent('login')}>{t('auth.login')}</button>
              <button type="button" className={intent === 'signup' ? 'is-active' : ''} onClick={() => changeIntent('signup')}>{t('auth.createAccount')}</button>
            </div>
            <form className="auth-form" onSubmit={submitIdentity}>
              {intent === 'signup' && (
                <>
                  <label>{t('auth.name')}<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
                  <label>{t('auth.phone')}<input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" required /></label>
                </>
              )}
              <label>{t('auth.email')}<input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required /></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" type="submit" disabled={busy}>{busy ? t('auth.sending') : t('auth.sendCode')}</button>
            </form>
            {import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true' && (
              <button className="auth-test" type="button" disabled={busy} onClick={() => void testLogin()}>{t('auth.useTest')}</button>
            )}
          </>
        )}

        {step !== 'identity' && (
          <form className="auth-form" onSubmit={step === 'email-code' ? submitEmailCode : submitPhoneCode}>
            <label>{t('auth.code')}<input className="auth-code" value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required autoFocus /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={busy || code.length !== 6}>{busy ? t('auth.verifying') : t('auth.continue')}</button>
            <button className="auth-back" type="button" onClick={() => { setStep('identity'); setCode(''); setError('') }}>{t('auth.changeEmail')}</button>
          </form>
        )}
      </motion.section>
    </div>
  )
}
