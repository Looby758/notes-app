import ChatSitePage, { ChatSiteFloat, openSiteTab, toggleSiteFloat } from '../ChatSite/ChatSite'

/** Grok inside Orbit (grok.com as a tab or a floating panel): see ChatSite. */

export const openGrokTab = (): void => openSiteTab('grok')
export const toggleGrokFloat = (): void => toggleSiteFloat('grok')

export default function GrokPage({ hidden, autoFocus }: { hidden: boolean; autoFocus: boolean }) {
  return <ChatSitePage site="grok" hidden={hidden} autoFocus={autoFocus} />
}

export function GrokFloat() {
  return <ChatSiteFloat site="grok" />
}
