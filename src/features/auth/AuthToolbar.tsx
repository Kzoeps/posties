import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { publicHandlePath } from '../../lib/config'
import { useLogoutActiveAuthSessionMutation } from './authQueries'

/** Props for the public page toolbar shown on every shareable handle page. */
export type AuthToolbarProps = {
  /** Canonical handle for the page owner whose public notes are being viewed. */
  ownerHandle: string
  /** Stable DID for the page owner whose repo is being read. */
  ownerDid: string
  /** Active signed-in DID for the current browser viewer, if one is restored. */
  activeDid?: string | null
  /** True when the current viewer owns the page and therefore sees write controls elsewhere. */
  isOwner: boolean
  /** Optional auth restore error to explain why ownership controls may not appear. */
  authErrorMessage?: string
}

/**
 * Public identity and auth toolbar for shareable notes pages.
 * It displays the owner handle/DID, copies the canonical handle URL, and keeps logout separate from public reads.
 */
export function AuthToolbar({ ownerHandle, ownerDid, activeDid, isOwner, authErrorMessage }: AuthToolbarProps) {
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
      <div className="auth-toolbar__identity">
        <div>
          <strong>Viewing public notes</strong>
          <span className="auth-toolbar__handle">@{ownerHandle}</span>
          <span className="auth-toolbar__did">{ownerDid}</span>
        </div>
        <button className="quote-button quote-button--ghost auth-toolbar__copy-button" type="button" onClick={() => void handleCopyShareLink()}>
          {copyState === 'copied' ? 'Copied' : 'Copy link'}
        </button>
      </div>

      {copyState === 'error' ? (
        <p className="quote-composer__error auth-toolbar__error" role="alert">
          Could not copy the share link automatically. What to do: copy {shareLabel} from the address bar.
        </p>
      ) : null}

      <p className="auth-toolbar__warning">
        {isOwner ? 'You own this page. Notes are still public PDS records.' : 'Read-only public page. Only the owner can add, edit, move, or delete notes.'}
      </p>

      {activeDid ? (
        <div className="auth-toolbar__account">
          <span>{isOwner ? 'Signed in as owner' : 'Signed in as viewer'}</span>
          <code>{activeDid}</code>
        </div>
      ) : (
        <Link className="quote-button quote-button--primary" to="/login">
          Sign in to create your page
        </Link>
      )}

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

      {activeDid ? (
        <button className="quote-button quote-button--ghost" type="button" disabled={logoutMutation.isPending} onClick={() => void handleLogout()}>
          {logoutMutation.isPending ? 'Logging out…' : 'Log out'}
        </button>
      ) : null}
    </aside>
  )
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall through to the selection-based copy path for browsers that expose
      // Clipboard but deny writeText on non-HTTPS or ungranted contexts.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) throw new Error('document.execCommand("copy") returned false.')
  } finally {
    textarea.remove()
  }
}
