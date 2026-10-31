import { create } from 'zustand'
import type { CamStatus, PhoneEvent } from '@shared/types'
import { notify } from './notify'
import { insertIntoActiveNote, liveTypeIntoActiveNote } from '../lib/editorController'
import { parseReceipt } from '../lib/receipt'
import { formatPounds, guessCategory } from '../lib/money'
import { addEntry, loadMoney, useMoney } from './money'
import { runDeck, startPhoneSync } from '../lib/phoneDeck'

/**
 * The phone dialog: sending a vault file (note or attachment) or a web link, pairing a phone, or
 * the Wi-Fi code for guests, or the phone webcam.
 */
export type PhoneTarget = { kind: 'file'; path: string } | { kind: 'link'; url: string; title?: string } | { kind: 'pair' } | { kind: 'wifi' } | { kind: 'webcam' }

export const usePhone = create<{ target: PhoneTarget | null; connected: number; cam: CamStatus | null }>(() => ({ target: null, connected: 0, cam: null }))
export const sendToPhone = (target: PhoneTarget | null): void => usePhone.setState({ target })

const fileName = (path: string): string => path.split('/').pop() ?? path

/** A receipt scanned on the phone goes into Money as spending, sorted like the shop's other spending. */
async function addReceipt(path: string, text: string): Promise<void> {
  const receipt = parseReceipt(text)
  if (receipt.total === null) {
    notify(`Couldn’t read the total on that receipt. The scan is saved as “${fileName(path)}”.`, 'info')
    return
  }
  if (!useMoney.getState().loaded) await loadMoney()
  const { rules, categories } = useMoney.getState()
  const category = guessCategory({ date: receipt.date, amount: -receipt.total, description: receipt.shop }, rules, categories)
  addEntry({ date: receipt.date, amount: receipt.total, income: false, category, note: receipt.shop })
  notify(`Added ${formatPounds(receipt.total)} at ${receipt.shop} to Money. Change it there if it’s not quite right.`, 'info')
}

const warned = new Set<string>()

function handle(event: PhoneEvent): void {
  switch (event.type) {
    case 'connected': {
      const before = usePhone.getState().connected
      usePhone.setState({ connected: event.count })
      if (before === 0 && event.count > 0) notify('Your phone is connected.', 'info')
      return
    }
    case 'file':
      if (event.into === 'note' && insertIntoActiveNote(event.path)) return
      notify(`“${fileName(event.path)}” came from your phone. It’s in the attachments folder.`, 'info')
      return
    case 'receipt':
      void addReceipt(event.path, event.text).catch(notify)
      return
    case 'deck':
      runDeck(event.id)
      return
    case 'dictate':
      if (!liveTypeIntoActiveNote(event.id, event.text, event.done) && !warned.has(event.id)) {
        warned.add(event.id)
        notify('Open a note on your computer to talk into it.', 'info')
      }
  }
}

/** Listens to the paired phone while the notes window is open. */
export function startPhone(): () => void {
  const off = window.api.onPhoneEvent(handle)
  const offSync = startPhoneSync()
  const offCam = window.api.onCamStatus((cam) => usePhone.setState({ cam }))
  window.api.camStatus().then((cam) => usePhone.setState({ cam }), () => {})
  return () => {
    off()
    offSync()
    offCam()
  }
}
