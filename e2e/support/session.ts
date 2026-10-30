/*
 * A signed-in session without Zitadel. oidc-client-ts (composables/useOidc.ts) keeps the user in localStorage under
 * `oidc.user:<authority>:<client_id>`; an unexpired entry there is all `isAuthenticated()` needs. The mock API accepts
 * any bearer token, so the token values are placeholders. The build under test must use the same authority and client id
 * (see playwright.config.ts).
 */
export function fakeOidcEntry(authority: string, clientId: string): [string, string] {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 86_400
  const profile = {
    sub: 'user-admin',
    iss: authority,
    aud: clientId,
    exp: expiresAt,
    iat: now,
    email: 'staff@example.test',
    given_name: 'Eva',
    family_name: 'Staff',
  }
  // A decodable (unsigned) JWT: a token refresh compares the new id_token's claims with the stored one's.
  const jwt = (claims: unknown) => Buffer.from(JSON.stringify(claims)).toString('base64url')
  const user = {
    id_token: `${jwt({ alg: 'none', typ: 'JWT' })}.${jwt(profile)}.mock`,
    session_state: null,
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    token_type: 'Bearer',
    scope: 'openid profile email offline_access',
    profile,
    expires_at: expiresAt,
  }
  return [`oidc.user:${authority}:${clientId}`, JSON.stringify(user)]
}
