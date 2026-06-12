import { expect, test, type Locator, type Page } from '@playwright/test'

const MOCK_ENABLED_KEY = 'atproto-sticky-canvas:mock-enabled'
const MOCK_STATE_KEY = 'atproto-sticky-canvas:mock-state'
const QUOTE_COLLECTION_NSID = 'com.kzoeps.stickyquotes.canvas.quote'
const MOCK_DID = 'did:plc:stickyquotee2euser'
const ALICE_DID = MOCK_DID
const BOB_DID = 'did:plc:bobstickyquotes'
const MOCK_PDS_ENDPOINT = 'https://mock.pds.local'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ enabledKey, stateKey }) => {
      if (!sessionStorage.getItem('atproto-sticky-canvas:mock-initialized')) {
        localStorage.removeItem(stateKey)
        sessionStorage.setItem('atproto-sticky-canvas:mock-initialized', 'true')
      }
      localStorage.setItem(enabledKey, 'true')
      ;(window as unknown as { __ATPROTO_STICKY_CANVAS_E2E_MOCK__?: boolean }).__ATPROTO_STICKY_CANVAS_E2E_MOCK__ = true
    },
    { enabledKey: MOCK_ENABLED_KEY, stateKey: MOCK_STATE_KEY },
  )
})

test('signed-out home is a landing page and public handle pages are read-only', async ({ page }) => {
  await seedMockProfile(page, {
    activeDid: null,
    handle: 'alice.test',
    did: ALICE_DID,
    quotes: [{ rkey: 'public-note', text: 'A public note for everyone.' }],
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sticky Quote Canvas' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue with Bluesky' })).toBeVisible()

  await page.goto('/alice.test')
  await expect(noteByText(page, 'A public note for everyone.')).toBeVisible()
  await expect(page.getByLabel('Public notes identity and account controls')).toContainText('@alice.test')
  await expect(page.getByLabel('Public notes identity and account controls')).not.toContainText(ALICE_DID)
  await expect(page.getByRole('button', { name: 'Add note' })).toHaveCount(0)
  await expect(noteByText(page, 'A public note for everyone.').getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(noteByText(page, 'A public note for everyone.').getByRole('button', { name: 'Delete' })).toHaveCount(0)
})

test('non-canonical handle URLs redirect to the current handle', async ({ page }) => {
  await seedMockProfile(page, {
    activeDid: null,
    handle: 'old-alice.test',
    currentHandle: 'alice.test',
    did: ALICE_DID,
    quotes: [{ rkey: 'canonical-note', text: 'Canonicalized public note.' }],
  })

  await page.goto('/old-alice.test')
  await expect(page).toHaveURL(/\/alice\.test$/)
  await expect(noteByText(page, 'Canonicalized public note.')).toBeVisible()
})

test('mocked OAuth lands on the canonical handle page and can copy the share link', async ({ page }) => {
  await signInWithMockOAuth(page)
  await expect(page).toHaveURL(/\/alice\.test$/)

  const toolbar = page.getByLabel('Public notes identity and account controls')
  await expect(toolbar).toContainText('@alice.test')
  await expect(toolbar).not.toContainText(MOCK_DID)
  await toolbar.getByRole('button', { name: 'Share @alice.test page' }).click()
  await expect(toolbar.getByRole('button', { name: 'Copied' })).toBeVisible()
})

test('mocked OAuth can create, reload, move, reload, edit, and delete a sticky quote on the owner page', async ({ page }) => {
  await signInWithMockOAuth(page)

  await createQuote(page, 'Do the thing, then make it durable.', 'Grace Hopper')
  const note = noteByText(page, 'Do the thing, then make it durable.')
  await expect(note).toBeVisible()

  const initialRotation = await note.getAttribute('data-rotation-deg-x100')
  const initialX = await noteWrapperByText(page, 'Do the thing, then make it durable.').getAttribute('data-world-x')
  const initialY = await noteWrapperByText(page, 'Do the thing, then make it durable.').getAttribute('data-world-y')
  expect(initialRotation).toBeTruthy()
  expect(initialX).toBeTruthy()
  expect(initialY).toBeTruthy()

  await page.reload()
  await expect(noteByText(page, 'Do the thing, then make it durable.')).toBeVisible()
  const reloadedWrapper = noteWrapperByText(page, 'Do the thing, then make it durable.')
  await expect(reloadedWrapper).toHaveAttribute('data-world-x', initialX ?? '')
  await expect(reloadedWrapper).toHaveAttribute('data-world-y', initialY ?? '')
  await expect(noteByText(page, 'Do the thing, then make it durable.')).toHaveAttribute('data-rotation-deg-x100', initialRotation ?? '')

  await dragNote(page, reloadedWrapper, 96, 64)
  const movedX = await reloadedWrapper.getAttribute('data-world-x')
  const movedY = await reloadedWrapper.getAttribute('data-world-y')
  expect(movedX).not.toBe(initialX)
  expect(movedY).not.toBe(initialY)

  await page.reload()
  const movedAfterReload = noteWrapperByText(page, 'Do the thing, then make it durable.')
  await expect(movedAfterReload).toHaveAttribute('data-world-x', movedX ?? '')
  await expect(movedAfterReload).toHaveAttribute('data-world-y', movedY ?? '')
  await expect(noteByText(page, 'Do the thing, then make it durable.')).toHaveAttribute('data-rotation-deg-x100', initialRotation ?? '')

  await noteByText(page, 'Do the thing, then make it durable.').getByRole('button', { name: 'Edit' }).click()
  const editForm = page.getByRole('form', { name: 'Edit note' })
  await editForm.getByLabel('Note').fill('Do the thing, then write the test.')
  await editForm.getByRole('button', { name: 'Save' }).click()
  await expect(editForm).toHaveCount(0)
  await expect(noteByText(page, 'Do the thing, then write the test.')).toBeVisible()

  await page.reload()
  await expect(noteByText(page, 'Do the thing, then write the test.')).toBeVisible()

  const editedNote = noteByText(page, 'Do the thing, then write the test.')
  await editedNote.getByRole('button', { name: 'Delete' }).click()
  await editedNote.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('Do the thing, then write the test.')).toHaveCount(0)

  await page.reload()
  await expect(page.getByText('Do the thing, then write the test.')).toHaveCount(0)
})

test('signed-in Alice viewing Bob stays read-only', async ({ page }) => {
  await signInWithMockOAuth(page)
  await addMockProfile(page, {
    handle: 'bob.test',
    did: BOB_DID,
    quotes: [{ rkey: 'bob-note', text: 'Bob owns this note.' }],
  })

  await page.goto('/bob.test')
  await expect(noteByText(page, 'Bob owns this note.')).toBeVisible()
  await expect(page.getByLabel('Public notes identity and account controls')).toContainText('@bob.test')
  await expect(page.getByLabel('Public notes identity and account controls')).not.toContainText('Signed in as viewer')
  await expect(page.getByRole('button', { name: 'Add note' })).toHaveCount(0)
  await expect(noteByText(page, 'Bob owns this note.').getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(noteByText(page, 'Bob owns this note.').getByRole('button', { name: 'Delete' })).toHaveCount(0)
})

test('mocked create failure leaves the composer recoverable', async ({ page }) => {
  await signInWithMockOAuth(page)
  await failNextMockOperation(page, 'createRecord', 'network')

  await page.getByRole('button', { name: 'Add note' }).click()
  const composer = page.getByRole('form', { name: 'Add a new note' })
  await composer.getByLabel('Quote').fill('This create should fail once.')
  await composer.getByRole('button', { name: 'Place on canvas' }).click()

  await expect(composer.getByRole('alert')).toContainText('Could not create quote')
  await expect(composer.getByLabel('Quote')).toHaveValue('This create should fail once.')

  await composer.getByRole('button', { name: 'Place on canvas' }).click()
  await expect(noteByText(page, 'This create should fail once.')).toBeVisible()
})

async function signInWithMockOAuth(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Handle' }).fill('alice.test')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/alice\.test$/)
  await expect(page.getByLabel('Public notes identity and account controls')).toContainText('@alice.test')
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
}

async function createQuote(page: Page, text: string, author: string): Promise<void> {
  await page.getByRole('button', { name: 'Add note' }).click()
  const composer = page.getByRole('form', { name: 'Add a new note' })
  await composer.getByLabel('Quote').fill(text)
  await composer.getByLabel('Author').fill(author)
  await composer.getByRole('button', { name: 'Place on canvas' }).click()
}

function noteByText(page: Page, text: string): Locator {
  return page.getByRole('article', { name: 'Sticky note' }).filter({ hasText: text })
}

function noteWrapperByText(page: Page, text: string): Locator {
  return page.locator('[data-canvas-sticky-note="true"]').filter({ hasText: text })
}

async function dragNote(page: Page, noteWrapper: Locator, deltaX: number, deltaY: number): Promise<void> {
  const box = await noteWrapper.boundingBox()
  if (!box) throw new Error('Could not drag the note because it has no browser bounding box.')

  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 6 })
  await page.mouse.up()
}

async function seedMockProfile(page: Page, profile: MockProfileSeed & { activeDid: string | null }): Promise<void> {
  const state = createMockState(profile.activeDid)
  upsertProfile(state, profile)
  await page.goto('/')
  await writeMockState(page, state)
}

async function addMockProfile(page: Page, profile: MockProfileSeed): Promise<void> {
  const state = await readMockState(page)
  upsertProfile(state, profile)
  await writeMockState(page, state)
}

async function failNextMockOperation(page: Page, operation: string, kind: string): Promise<void> {
  await page.evaluate(
    ({ stateKey, operationName, failureKind }) => {
      const raw = localStorage.getItem(stateKey)
      if (!raw) throw new Error('Mock ATProto state was not initialized.')
      const state = JSON.parse(raw) as {
        activeDid: string
        repos: Record<string, { failures: Record<string, string> }>
      }
      state.repos[state.activeDid].failures[operationName] = failureKind
      localStorage.setItem(stateKey, JSON.stringify(state))
    },
    { stateKey: MOCK_STATE_KEY, operationName: operation, failureKind: kind },
  )
}

type MockProfileSeed = {
  handle: string
  currentHandle?: string
  did: string
  quotes: Array<{ rkey: string; text: string }>
}

type BrowserMockState = {
  activeDid: string | null
  handles: Record<string, string>
  didIdentities: Record<string, { did: string; handle: string; pdsEndpoint: string }>
  repos: Record<
    string,
    {
      did: string
      nextRkey: number
      nextCid: number
      quotes: Record<string, { uri: string; cid: string; value: Record<string, unknown> }>
      failures: Record<string, string>
    }
  >
}

async function readMockState(page: Page): Promise<BrowserMockState> {
  return page.evaluate((stateKey) => {
    const raw = localStorage.getItem(stateKey)
    return raw ? JSON.parse(raw) : { activeDid: null, handles: {}, didIdentities: {}, repos: {} }
  }, MOCK_STATE_KEY)
}

async function writeMockState(page: Page, state: BrowserMockState): Promise<void> {
  await page.evaluate(
    ({ stateKey, enabledKey, nextState }) => {
      localStorage.setItem(enabledKey, 'true')
      localStorage.setItem(stateKey, JSON.stringify(nextState))
    },
    { stateKey: MOCK_STATE_KEY, enabledKey: MOCK_ENABLED_KEY, nextState: state },
  )
}

function createMockState(activeDid: string | null): BrowserMockState {
  return { activeDid, handles: {}, didIdentities: {}, repos: {} }
}

function upsertProfile(state: BrowserMockState, profile: MockProfileSeed): void {
  const handle = normalizeHandle(profile.handle)
  const currentHandle = normalizeHandle(profile.currentHandle ?? handle)
  state.handles[handle] = profile.did
  state.handles[currentHandle] = profile.did
  state.didIdentities[profile.did] = { did: profile.did, handle: currentHandle, pdsEndpoint: MOCK_PDS_ENDPOINT }

  const repo = state.repos[profile.did] ?? { did: profile.did, nextRkey: 1, nextCid: 1, quotes: {}, failures: {} }
  for (const quote of profile.quotes) {
    repo.quotes[quote.rkey] = {
      uri: `at://${profile.did}/${QUOTE_COLLECTION_NSID}/${quote.rkey}`,
      cid: `mock-cid-${repo.nextCid}`,
      value: {
        $type: QUOTE_COLLECTION_NSID,
        schemaVersion: 1,
        text: quote.text,
        position: { x: 0, y: 0 },
        rotationDegX100: 125,
        color: 'yellow',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    repo.nextCid += 1
  }
  state.repos[profile.did] = repo
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').replace(/\.$/, '').toLowerCase()
}
