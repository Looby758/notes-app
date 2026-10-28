/**
 * Stops web pages from asking Windows for a passkey on their own. Sites like Discord and Google
 * quietly ask "does this computer have a passkey for me?" as their sign-in page loads, so they can
 * offer it in the username box. A real browser answers that silently; inside the app, Windows shows
 * its passkey prompt instead, every time the app opens. This runs in each web page before the
 * site's own code: a passkey is only asked for when you click something (a "Sign in with a passkey"
 * button), never as the page loads.
 */
export function quietPasskeys(): void {
  const credentials = navigator.credentials
  if (!credentials || typeof credentials.get !== 'function') return
  const get = credentials.get.bind(credentials)
  const notAllowed = (): Promise<never> => Promise.reject(new DOMException('No passkey was asked for.', 'NotAllowedError'))
  credentials.get = (options?: CredentialRequestOptions): Promise<Credential | null> => {
    if (!options?.publicKey) return get(options)
    // The "passkey in the username box" kind: a browser that can't offer it simply never answers.
    if (options.mediation === 'conditional') {
      return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason)))
    }
    return navigator.userActivation?.isActive ? get(options) : notAllowed()
  }
  const pkc = (window as { PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> } }).PublicKeyCredential
  if (pkc) pkc.isConditionalMediationAvailable = () => Promise.resolve(false)
}
