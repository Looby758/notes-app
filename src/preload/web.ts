import { contextBridge } from 'electron'
import { quietPasskeys } from '@shared/passkeys'

/**
 * Runs in every web page (web tabs, the messages hub, the YouTube mini window) before the site's
 * own code. It gives the page nothing; it only stops passkey prompts popping up as pages load
 * (see quietPasskeys).
 */
contextBridge.executeInMainWorld({ func: quietPasskeys })
