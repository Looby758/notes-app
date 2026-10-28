import { create } from 'zustand'

/** What the Send to phone dialog is sending: a vault file (note or attachment) or a web link. */
export type PhoneTarget = { kind: 'file'; path: string } | { kind: 'link'; url: string; title?: string }

export const usePhone = create<{ target: PhoneTarget | null }>(() => ({ target: null }))
export const sendToPhone = (target: PhoneTarget | null): void => usePhone.setState({ target })
