import { contextBridge } from 'electron'
import { quietPasskeys } from '@shared/passkeys'
import { firefoxOnGoogleSignIn, firefoxUserAgent } from '@shared/web'

/**
 * Runs in every web page (web tabs, the messages hub, the YouTube mini window) before the site's
 * own code. It gives the page nothing; it only stops passkey prompts popping up as pages load
 * (see quietPasskeys).
 */
contextBridge.executeInMainWorld({ func: quietPasskeys })
// Google's sign-in pages see the same Firefox the request said (see firefoxOnGoogleSignIn).
contextBridge.executeInMainWorld({ func: firefoxOnGoogleSignIn, args: [firefoxUserAgent(process.platform)] })
