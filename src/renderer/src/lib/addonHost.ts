import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as pet from './pet'
import * as gameSound from './gameSound'
import * as motion from './motion'
import * as miniGames from '../store/miniGames'
import HOST from '@shared/addonHostModules.json'
import { ADDON_SCHEME, addonGlobal, isDownloadable } from '@shared/addonPackages'

/**
 * What Orbit lends the add-ons it downloads (see shared/addonHostModules.json): they use Orbit's own
 * React, pet and stores instead of bringing copies. Every key in that file must be here
 * (addonHost.test.ts checks).
 */
export const HOST_MODULES: Record<string, unknown> = {
  react: React,
  react_jsx_runtime: jsxRuntime,
  lib_pet: pet,
  lib_gameSound: gameSound,
  lib_motion: motion,
  store_miniGames: miniGames
}

export const HOST_KEYS = Object.keys(HOST.modules)

type AddonModule = Record<string, unknown>
const loading = new Map<string, Promise<AddonModule>>()

function addTag(el: HTMLScriptElement | HTMLLinkElement): Promise<void> {
  return new Promise((resolve, reject) => {
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('couldn’t load its files'))
    document.head.appendChild(el)
  })
}

/**
 * Runs a downloaded add-on's code (once) and gives back what it exports. Its files come from
 * orbit-addon://<id>/, which only serves an add-on that's added and downloaded.
 */
export function loadAddon(id: string): Promise<AddonModule> {
  if (!isDownloadable(id)) return Promise.reject(new Error('it isn’t a download'))
  const done = loading.get(id)
  if (done) return done
  const job = (async () => {
    ;(window as unknown as { __orbitHost: unknown }).__orbitHost = HOST_MODULES
    const base = `${ADDON_SCHEME}://${id}/`
    const manifest = (await (await fetch(base + 'manifest.json')).json()) as { entry: string; style?: string }
    if (manifest.style) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = base + manifest.style
      link.dataset.addon = id
      await addTag(link)
    }
    const script = document.createElement('script')
    script.src = base + manifest.entry
    script.dataset.addon = id
    await addTag(script)
    const mod = (window as unknown as Record<string, AddonModule | undefined>)[addonGlobal(id)]
    if (!mod) throw new Error('it didn’t start')
    return mod
  })()
  loading.set(id, job)
  // A failed try can be tried again.
  job.catch(() => {
    loading.delete(id)
    document.querySelectorAll(`[data-addon="${id}"]`).forEach((el) => el.remove())
  })
  return job
}
