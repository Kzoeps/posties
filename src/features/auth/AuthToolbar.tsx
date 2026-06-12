import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { publicHandlePath } from '../../lib/config'
import { useLogoutActiveAuthSessionMutation } from './authQueries'

/** Props for the public page toolbar shown on every shareable handle page. */
export type AuthToolbarProps = {
  /** Canonical handle for the page owner whose public notes are being viewed. */
  ownerHandle: string
  /** Public display name for the page owner, fetched without OAuth when available. */
  ownerDisplayName?: string
  /** Public avatar URL for the page owner, fetched without OAuth when available. */
  ownerAvatarUrl?: string
  /** Active signed-in DID for the current browser viewer, if one is restored. */
  activeDid?: string | null
  /** Optional auth restore error to explain why ownership controls may not appear. */
  authErrorMessage?: string
}

/**
 * Public identity and auth toolbar for shareable notes pages.
 * It displays the owner profile, copies the canonical handle URL, and keeps logout separate from public reads.
 */
export function AuthToolbar({ ownerHandle, ownerDisplayName, ownerAvatarUrl, activeDid, authErrorMessage }: AuthToolbarProps) {
  const logoutMutation = useLogoutActiveAuthSessionMutation()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const sharePath = publicHandlePath(ownerHandle)
  const shareLabel = typeof window === 'undefined' ? sharePath : new URL(sharePath, window.location.origin).toString()

  async function handleCopyShareLink() {
    try {
      await copyText(shareLabel)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('error')
    }
  }

  async function handleLogout() {
    await logoutMutation.mutateAsync()
  }

  return (
    <aside className="auth-toolbar" aria-label="Public notes identity and account controls">
      <div className="auth-toolbar__pill" role="group" aria-label={`@${ownerHandle} board controls`}>
        <div className="auth-toolbar__avatar" aria-hidden="true">
          <span className="auth-toolbar__avatar-fallback">{profileInitial(ownerDisplayName ?? ownerHandle)}</span>
          {ownerAvatarUrl ? <img src={ownerAvatarUrl} alt="" onError={(event) => { event.currentTarget.hidden = true }} /> : null}
        </div>

        <div className="auth-toolbar__identity">
          <span className="auth-toolbar__display-name">{ownerDisplayName?.trim() || ownerHandle}</span>
          <span className="auth-toolbar__handle">@{ownerHandle}</span>
        </div>

        <button
          className="quote-button quote-button--ghost auth-toolbar__share-button"
          type="button"
          aria-label={copyState === 'copied' ? 'Copied' : `Share @${ownerHandle} page`}
          title={shareLabel}
          onClick={() => void handleCopyShareLink()}
        >
          {copyState === 'copied' ? <CopiedIcon /> : <ShareIcon />}
        </button>

        {activeDid ? (
          <button className="quote-button quote-button--ghost auth-toolbar__logout" type="button" disabled={logoutMutation.isPending} onClick={() => void handleLogout()}>
            {logoutMutation.isPending ? 'Logging out…' : 'Log out'}
          </button>
        ) : (
          <Link className="quote-button quote-button--primary auth-toolbar__signin" to="/login">
            Sign in
          </Link>
        )}
      </div>

      {copyState === 'error' ? (
        <p className="quote-composer__error auth-toolbar__error" role="alert">
          Could not copy the share link automatically. What to do: copy {shareLabel} from the address bar.
        </p>
      ) : null}

      {authErrorMessage ? (
        <p className="quote-composer__error auth-toolbar__error" role="alert">
          {authErrorMessage}
        </p>
      ) : null}

      {logoutMutation.isError ? (
        <p className="quote-composer__error auth-toolbar__error" role="alert">
          {logoutMutation.error.message}
        </p>
      ) : null}
    </aside>
  )
}

function profileInitial(value: string): string {
  const trimmed = value.trim().replace(/^@/, '')
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '•'
}

function ShareIcon() {
  return (
    <svg className="auth-toolbar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8.6 12.9 15.4 16.8" />
      <path d="M15.4 7.2 8.6 11.1" />
      <circle cx="6.5" cy="12" r="2.35" />
      <circle cx="17.5" cy="6" r="2.35" />
      <circle cx="17.5" cy="18" r="2.35" />
    </svg>
  )
}

function CopiedIcon() {
  return (
    <svg className="auth-toolbar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m5.5 12.4 4.1 4.1 8.9-9" />
    </svg>
  )
}

async function copyText(value: string): Promise<void> {
  if (copyTextWithSelection(value)) return

  if (navigator.clipboard?.writeText) {
    await withTimeout(navigator.clipboard.writeText(value), 1200)
    return
  }

  throw new Error('No browser clipboard copy method succeeded.')
}

function copyTextWithSelection(value: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

async function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timeoutId: number | undefined

  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('Clipboard write timed out.')), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}
