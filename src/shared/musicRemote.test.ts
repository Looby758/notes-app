import { describe, expect, it } from 'vitest'
import { artPathFrom, cleanRemoteCommand, isRemoteFileName, parseRemoteFile, remoteArt, remoteFileName, remoteState } from './musicRemote'

describe('music remote', () => {
  it('gives the phone covers it can load', () => {
    expect(remoteArt('vault://musicart/Albums/A%20B.mp3?v=3', '/s/x')).toBe('/s/x/art/Albums/A%20B.mp3?v=3')
    expect(remoteArt('https://i.scdn.co/a.jpg', '/s/x')).toBe('https://i.scdn.co/a.jpg')
    expect(remoteArt('file:///c.jpg', '/s/x')).toBe('')
    expect(artPathFrom('Albums/A%20B.mp3?v=3')).toBe('Albums/A B.mp3')
    expect(artPathFrom('%E0%A4%A')).toBeNull()
  })
  it('moves the position on to when it is sent', () => {
    const mini = { at: 1000, state: { source: 'local' as const, playing: true, positionMs: 5000, track: { name: 'S', artist: 'A', album: '', uri: 'local:s', durationMs: 7000 }, volume: 40 }, upNext: [{ title: 'N', artist: 'B' }] }
    const s = remoteState(mini, '/b', 3500)
    expect(s.positionMs).toBe(7000)
    expect(s.volume).toBe(40)
    expect(s.upNext).toEqual([{ title: 'N', artist: 'B', art: '' }])
    expect(remoteState({ ...mini, state: { ...mini.state, playing: false } }, '/b', 3500).positionMs).toBe(5000)
    expect(remoteState(null, '/b').title).toBe('')
  })
  it('only takes button presses it knows', () => {
    expect(cleanRemoteCommand({ action: 'next' })).toEqual({ action: 'next' })
    expect(cleanRemoteCommand({ action: 'rm -rf' })).toBeNull()
    expect(cleanRemoteCommand({ seek: 1234.6 })).toEqual({ seek: 1235 })
    expect(cleanRemoteCommand({ seek: -5 })).toBeNull()
    expect(cleanRemoteCommand({ jump: 2 })).toEqual({ jump: 2 })
    expect(cleanRemoteCommand({ jump: 1.5 })).toBeNull()
    expect(cleanRemoteCommand({ volume: 140 })).toEqual({ volume: 100 })
    expect(cleanRemoteCommand('next')).toBeNull()
  })
  it('names one file per computer', () => {
    expect(remoteFileName('Looby’s MacBook Pro')).toBe('orbit-remote-Looby-s-MacBook-Pro.json')
    expect(remoteFileName('***')).toBe('orbit-remote-computer.json')
    expect(isRemoteFileName('orbit-remote-PC.json')).toBe(true)
    expect(isRemoteFileName('orbit-music.json')).toBe(false)
  })
  it('only trusts a local Wi-Fi address in the file', () => {
    const url = 'http://192.168.1.20:51234/s/abcdefghijklmnopqrstuv'
    expect(parseRemoteFile({ name: 'PC', url, updated: 5 })).toEqual({ name: 'PC', url, updated: 5 })
    expect(parseRemoteFile({ name: 'PC', url: 'https://evil.example/s/abcdefghijklmnopqrstuv', updated: 5 })).toBeNull()
    expect(parseRemoteFile(null)).toBeNull()
  })
})
