import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Json, MockState } from './state.ts'

/*
 * The sign-in side of the mock: the REST endpoints of tsb-service the login page calls (`/api/v1/auth/*`) and a fake
 * Zitadel (`/zitadel/*`, the dashboard's ZITADEL_AUTHORITY). Most specs skip all of it with a faked session seeded in
 * localStorage (support/session.ts); the login spec drives the real round trip:
 *
 *   login page -> POST /auth/authorize-proxy {authorizeUrl}        -> {authRequestId}
 *              -> POST /auth/session/otp/request {loginName}       -> {sessionId, sessionToken}
 *              -> POST /auth/session/otp/verify {code}             -> {sessionId, sessionToken}
 *              -> POST /auth/finalize {authRequestId, session...}  -> {callbackUrl}   (the app's /auth/callback?code=&state=)
 *              -> POST /zitadel/oauth/v2/token (authorization_code) -> access + id token + refresh token
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...CORS,
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

const readForm = (req: IncomingMessage): Promise<URLSearchParams> =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString()
    })
    req.on('end', () => {
      resolve(new URLSearchParams(data))
    })
  })

/** An unsigned JWT with the claims oidc-client-ts validates (it reads them and never checks the signature). */
function idToken(authority: string, clientId: string, nonce: string | null): string {
  const now = Math.floor(Date.now() / 1000)
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    iss: authority,
    aud: clientId,
    sub: 'user-admin',
    iat: now,
    exp: now + 3600,
    ...(nonce === null ? {} : { nonce }),
    email: 'staff@example.test',
    given_name: 'Eva',
    family_name: 'Staff',
  })}.mock`
}

/** Handles `/api/v1/auth/*`; false when the path is not one of them. */
export async function handleRest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: () => Promise<Json | null>,
  state: MockState,
): Promise<boolean> {
  const prefix = '/api/v1/auth/'
  if (!url.pathname.startsWith(prefix)) return false
  const path = url.pathname.slice('/api/v1'.length)
  const input = (req.method === 'GET' ? {} : await body()) ?? {}
  state.restCalls.push({ method: req.method ?? 'GET', path, body: input })
  const { auth } = state

  const sessionOf = () => {
    const session = auth.sessions.get(text(input.sessionId))
    return session && session.token === text(input.sessionToken) ? session : null
  }

  switch (path) {
    case '/auth/authorize-proxy': {
      try {
        const authorize = new URL(text(input.authorizeUrl))
        sendJson(res, 200, { authRequestId: auth.startRequest(authorize.searchParams) })
      } catch {
        sendJson(res, 400, { error: 'bad authorize url' })
      }
      return true
    }
    case '/auth/session/otp/request': {
      const loginName = text(input.loginName).trim()
      if (!loginName.includes('@')) {
        sendJson(res, 422, { error: 'invalid_email' })
        return true
      }
      const id = auth.next('session')
      const token = auth.next('token')
      auth.sessions.set(id, { id, token, loginName, verified: false })
      sendJson(res, 200, { sessionId: id, sessionToken: token })
      return true
    }
    case '/auth/session/otp/verify': {
      const session = sessionOf()
      if (!session) {
        sendJson(res, 401, { error: 'invalid_session' })
        return true
      }
      if (text(input.code) !== state.scenario.otpCode) {
        sendJson(res, 400, { error: 'invalid_code' })
        return true
      }
      session.verified = true
      session.token = auth.next('token')
      sendJson(res, 200, { sessionId: session.id, sessionToken: session.token })
      return true
    }
    case '/auth/finalize': {
      const session = sessionOf()
      const request = auth.requests.get(text(input.authRequestId))
      if (!session?.verified || !request) {
        sendJson(res, 400, { error: 'cannot finalize' })
        return true
      }
      const code = auth.next('code')
      auth.codes.set(code, request)
      const callback = new URL(request.redirectUri)
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', request.state)
      sendJson(res, 200, { callbackUrl: callback.toString() })
      return true
    }
    default:
      sendJson(res, 404, { error: `mock: no route ${req.method ?? 'GET'} ${path}` })
      return true
  }
}

/** Handles `/zitadel/*`; false when the path is not one of them. */
export async function handleZitadel(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authority: string,
  state: MockState,
): Promise<boolean> {
  if (!url.pathname.startsWith('/zitadel/')) return false
  const path = url.pathname.slice('/zitadel'.length)
  const { auth } = state

  if (path === '/.well-known/openid-configuration') {
    sendJson(res, 200, {
      issuer: authority,
      authorization_endpoint: `${authority}/oauth/v2/authorize`,
      token_endpoint: `${authority}/oauth/v2/token`,
      end_session_endpoint: `${authority}/oidc/v1/end_session`,
      userinfo_endpoint: `${authority}/oidc/v1/userinfo`,
      jwks_uri: `${authority}/oauth/v2/keys`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    })
    return true
  }
  if (path === '/oauth/v2/keys') {
    sendJson(res, 200, { keys: [] })
    return true
  }
  if (path === '/oauth/v2/token' && req.method === 'POST') {
    const form = await readForm(req)
    const clientId = form.get('client_id') ?? ''
    const issue = (nonce: string | null) => {
      const refresh = auth.next('refresh')
      auth.refreshTokens.add(refresh)
      sendJson(res, 200, {
        access_token: auth.next('access'),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email offline_access',
        refresh_token: refresh,
        id_token: idToken(authority, clientId, nonce),
      })
    }
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? ''
      const request = auth.codes.get(code)
      // One shot, like the real code.
      auth.codes.delete(code)
      if (!request || request.redirectUri !== form.get('redirect_uri')) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'invalid or used code' })
        return true
      }
      issue(request.nonce)
      return true
    }
    if (form.get('grant_type') === 'refresh_token') {
      const refresh = form.get('refresh_token') ?? ''
      // The faked session holds a refresh token the mock never issued: it is honoured.
      const known = auth.refreshTokens.delete(refresh) || refresh === 'e2e-refresh-token'
      if (!known) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'refresh token revoked' })
        return true
      }
      issue(null)
      return true
    }
    sendJson(res, 400, { error: 'unsupported_grant_type' })
    return true
  }
  if (path === '/oidc/v1/end_session') {
    res.writeHead(302, { Location: url.searchParams.get('post_logout_redirect_uri') ?? '/' })
    res.end()
    return true
  }
  sendJson(res, 404, { error: 'mock zitadel: not implemented' })
  return true
}
