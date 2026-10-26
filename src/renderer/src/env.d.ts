import type { NotesApi } from '@shared/types'

declare global {
  interface Window {
    api: NotesApi
  }
}
