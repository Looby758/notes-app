import { app, ipcMain } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { promisify } from 'util'
import { IS_MAC } from '@shared/platform'
import { clampVolume, groupSessions, MAC_APPS, macState, type MixerState, type RawList, type RawMacList } from '@shared/mixer'
import { logError } from './log'

/**
 * The volume mixer: a slider for each app making sound (a game, Discord, Spotify...), from Orbit or
 * the phone. On Windows nothing is installed: a PowerShell helper talks to Windows' own per-app
 * volume (the same one as Windows' Volume mixer) and stays running while Orbit is open. On a Mac,
 * macOS has no per-app volume, so it's the Mac's volume plus the apps that let Orbit set theirs.
 */

/**
 * Why the helper runs on an MTA thread: Windows' per-app sound sessions (IAudioSessionControl2,
 * ISimpleAudioVolume, IAudioMeterInformation) only answer properly in a multi-threaded COM
 * apartment. powershell.exe runs scripts single-threaded (STA) by default, and there the session
 * objects come back as cross-apartment proxies that won't hand over their volume ("No such
 * interface supported"). Every session then failed inside a silent catch, so only the master slider
 * (IAudioEndpointVolume, which is fine in an STA) ever showed.
 *
 * The C# is passed in an environment variable rather than the command line, which Windows caps at
 * 32,767 characters (the old encoded script was already over 31,000).
 */
const WIN_HELPER_CS = String.raw`
using System; using System.Text; using System.Threading; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class OrbitMMDeviceEnumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IOrbitDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IOrbitDevice device);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitDeviceCollection {
  [PreserveSig] int GetCount(out int n);
  [PreserveSig] int Item(int i, out IOrbitDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitDevice {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  [PreserveSig] int OpenPropertyStore(int access, out IOrbitPropertyStore store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[StructLayout(LayoutKind.Sequential)] struct OrbitPropKey { public Guid fmt; public int pid; }
[StructLayout(LayoutKind.Sequential)] struct OrbitPropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitPropertyStore {
  [PreserveSig] int GetCount(out int n);
  [PreserveSig] int GetAt(int i, out OrbitPropKey key);
  [PreserveSig] int GetValue(ref OrbitPropKey key, out OrbitPropVariant value);
}
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitSessionManager2 {
  [PreserveSig] int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr control);
  [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr volume);
  [PreserveSig] int GetSessionEnumerator(out IOrbitSessionEnumerator sessions);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitSessionEnumerator {
  [PreserveSig] int GetCount(out int n);
  [PreserveSig] int GetSession(int i, out IOrbitSessionControl2 session);
}
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitSessionControl2 {
  [PreserveSig] int GetState(out int state);
  [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
  [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
  [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
  [PreserveSig] int GetGroupingParam(out Guid g);
  [PreserveSig] int SetGroupingParam(ref Guid g, ref Guid ctx);
  [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
  [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
  [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetProcessId(out uint pid);
  [PreserveSig] int IsSystemSoundsSession();
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6F24A2B8C2F4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitSimpleVolume {
  [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
  [PreserveSig] int GetMasterVolume(out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitMeter {
  [PreserveSig] int GetPeakValue(out float peak);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IOrbitEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr n);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr n);
  [PreserveSig] int GetChannelCount(out uint n);
  [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  [PreserveSig] int GetMasterVolumeLevel(out float db);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint ch, float db, ref Guid ctx);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
  [PreserveSig] int GetChannelVolumeLevel(uint ch, out float db);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
public static class OrbitMixer {
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref OrbitPropVariant v);
  static Guid IID_Manager = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
  static Guid IID_Endpoint = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
  static Guid IID_Meter = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
  static Guid Ctx = Guid.Empty;
  class Info { public string exe = ""; public string proc = ""; public string desc = ""; public string title = ""; }
  static Dictionary<uint, Info> infos = new Dictionary<uint, Info>();
  /** The first thing that went wrong in the last look, so Orbit's log says why an app is missing. */
  static string problem = "";
  static void Note(string where, Exception ex) { if (problem == "") problem = where + ": " + ex.GetType().Name + " " + ex.Message; }
  /** Runs the COM work on an MTA thread (see the note in mixer.ts), whatever thread PowerShell is on. */
  static string OnMta(Func<string> work) {
    if (Thread.CurrentThread.GetApartmentState() == ApartmentState.MTA) return work();
    string result = null; Exception error = null;
    var t = new Thread(() => { try { result = work(); } catch (Exception ex) { error = ex; } });
    t.SetApartmentState(ApartmentState.MTA);
    t.IsBackground = true;
    t.Start(); t.Join();
    if (error != null) throw error;
    return result;
  }
  static string Esc(string s) { var b = new StringBuilder(); foreach (char c in s ?? "") { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < ' ') b.Append(' '); else b.Append(c); } return b.ToString(); }
  static string Num(float f) { return (float.IsNaN(f) ? 0 : f).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture); }
  static IOrbitDeviceEnumerator Enumerator() { return (IOrbitDeviceEnumerator)new OrbitMMDeviceEnumerator(); }
  static T Activate<T>(IOrbitDevice d, Guid iid) where T : class { object o; return d.Activate(ref iid, 23, IntPtr.Zero, out o) == 0 ? o as T : null; }
  static List<IOrbitDevice> Outputs() {
    var list = new List<IOrbitDevice>();
    IOrbitDeviceCollection all; int n;
    if (Enumerator().EnumAudioEndpoints(0, 1, out all) != 0 || all.GetCount(out n) != 0) return list;
    for (int i = 0; i < n; i++) { IOrbitDevice d; if (all.Item(i, out d) == 0) list.Add(d); }
    return list;
  }
  static string Name(IOrbitDevice d) {
    IOrbitPropertyStore store;
    if (d.OpenPropertyStore(0, out store) != 0) return "";
    var key = new OrbitPropKey { fmt = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    OrbitPropVariant v;
    if (store.GetValue(ref key, out v) != 0) return "";
    string name = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    PropVariantClear(ref v);
    return name ?? "";
  }
  static Info About(uint pid) {
    Info info;
    if (infos.TryGetValue(pid, out info)) return info;
    if (infos.Count > 400) infos.Clear();
    info = new Info();
    try {
      var p = Process.GetProcessById((int)pid);
      info.proc = p.ProcessName;
      try { info.title = p.MainWindowTitle; } catch { }
      try { info.exe = p.MainModule.FileName; info.desc = FileVersionInfo.GetVersionInfo(info.exe).FileDescription ?? ""; } catch { }
    } catch { }
    infos[pid] = info;
    return info;
  }
  static List<IOrbitSessionControl2> Sessions(IOrbitDevice d) {
    var list = new List<IOrbitSessionControl2>();
    try {
      var m = Activate<IOrbitSessionManager2>(d, IID_Manager);
      IOrbitSessionEnumerator e; int n;
      if (m == null) { if (problem == "") problem = "no session manager for " + Name(d); return list; }
      int hr = m.GetSessionEnumerator(out e);
      if (hr != 0 || e == null) { if (problem == "") problem = "GetSessionEnumerator 0x" + hr.ToString("X8"); return list; }
      if (e.GetCount(out n) != 0) return list;
      for (int i = 0; i < n; i++) {
        try {
          IOrbitSessionControl2 s; int state;
          if (e.GetSession(i, out s) != 0 || s == null) continue;
          if (s.GetState(out state) == 0 && state == 2) continue;
          list.Add(s);
        } catch (Exception ex) { Note("session " + i, ex); }
      }
    } catch (Exception ex) { Note("sessions", ex); }
    return list;
  }
  static IOrbitDevice Default() { IOrbitDevice d; return Enumerator().GetDefaultAudioEndpoint(0, 1, out d) == 0 ? d : null; }
  public static string List() { return OnMta(ListNow); }
  static string ListNow() {
    problem = "";
    var b = new StringBuilder("{\"ok\":true,\"master\":");
    var def = Default();
    var ev = def == null ? null : Activate<IOrbitEndpointVolume>(def, IID_Endpoint);
    if (ev != null) {
      float vol; bool mute; float peak = 0;
      ev.GetMasterVolumeLevelScalar(out vol); ev.GetMute(out mute);
      var meter = Activate<IOrbitMeter>(def, IID_Meter);
      if (meter != null) meter.GetPeakValue(out peak);
      b.Append("{\"name\":\"" + Esc(Name(def)) + "\",\"vol\":" + Num(vol) + ",\"mute\":" + (mute ? "true" : "false") + ",\"peak\":" + Num(peak) + "}");
    } else b.Append("null");
    b.Append(",\"sessions\":[");
    bool first = true;
    foreach (var d in Outputs()) {
      foreach (var s in Sessions(d)) {
        try {
          uint pid; s.GetProcessId(out pid);
          bool sys = s.IsSystemSoundsSession() == 0;
          var v = s as IOrbitSimpleVolume;
          if (v == null) { if (problem == "") problem = "a session has no ISimpleAudioVolume"; continue; }
          float vol, peak = 0; bool mute;
          v.GetMasterVolume(out vol); v.GetMute(out mute);
          var meter = s as IOrbitMeter;
          if (meter != null) meter.GetPeakValue(out peak);
          string display; s.GetDisplayName(out display);
          var info = sys ? new Info() : About(pid);
          if (!sys && pid == 0) continue;
          if (!first) b.Append(",");
          first = false;
          b.Append("{\"pid\":" + pid + ",\"exe\":\"" + Esc(info.exe) + "\",\"proc\":\"" + Esc(info.proc) + "\",\"desc\":\"" + Esc(info.desc) + "\",\"display\":\"" + Esc(display) + "\",\"title\":\"" + Esc(info.title) + "\",\"vol\":" + Num(vol) + ",\"mute\":" + (mute ? "true" : "false") + ",\"peak\":" + Num(peak) + ",\"sys\":" + (sys ? "true" : "false") + "}");
        } catch (Exception ex) { Note("reading a session", ex); }
      }
    }
    return b.Append("],\"err\":\"" + Esc(problem) + "\"}").ToString();
  }
  /** targets: 'master', 'sys' or process ids, comma separated. vol is 0..1, or -1 to leave it; mute is 0, 1, or -1 to leave it. */
  public static string Set(string targets, float vol, int mute) { return OnMta(() => SetNow(targets, vol, mute)); }
  static string SetNow(string targets, float vol, int mute) {
    var want = new HashSet<string>(targets.Split(','));
    bool ok = false;
    if (want.Contains("master")) {
      var def = Default();
      var ev = def == null ? null : Activate<IOrbitEndpointVolume>(def, IID_Endpoint);
      if (ev != null) {
        if (vol >= 0) ok |= ev.SetMasterVolumeLevelScalar(Math.Min(1f, vol), ref Ctx) == 0;
        if (mute >= 0) ok |= ev.SetMute(mute == 1, ref Ctx) == 0;
      }
    }
    foreach (var d in Outputs()) {
      foreach (var s in Sessions(d)) {
        try {
          uint pid; s.GetProcessId(out pid);
          bool sys = s.IsSystemSoundsSession() == 0;
          if (!want.Contains(sys ? "sys" : pid.ToString())) continue;
          var v = s as IOrbitSimpleVolume;
          if (v == null) continue;
          if (vol >= 0) ok |= v.SetMasterVolume(Math.Min(1f, vol), ref Ctx) == 0;
          if (mute >= 0) ok |= v.SetMute(mute == 1, ref Ctx) == 0;
        } catch { }
      }
    }
    return "{\"ok\":" + (ok ? "true" : "false") + "}";
  }
}
`

/** Builds the C# helper above (from ORBIT_MIXER_CS) and answers Orbit's requests, one per line. */
const WIN_HELPER = String.raw`
Add-Type -TypeDefinition $env:ORBIT_MIXER_CS
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  $out = '{"ok":false}'
  try {
    switch ($p[1]) {
      'list' { $out = [OrbitMixer]::List() }
      'set' { $out = [OrbitMixer]::Set($p[2], [float]::Parse($p[3], [Globalization.CultureInfo]::InvariantCulture), [int]$p[4]) }
    }
  } catch { }
  [Console]::Out.WriteLine($p[0] + ' ' + $out)
  [Console]::Out.Flush()
}
`

// ---------------------------------------------------------------------------------------------
// Windows

let helper: ChildProcessWithoutNullStreams | null = null
let nextRequest = 1
const waiting = new Map<number, (text: string) => void>()

function startHelper(): ChildProcessWithoutNullStreams {
  const child = spawn('powershell.exe', ['-Mta', '-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_HELPER, 'utf16le').toString('base64')], {
    windowsHide: true,
    env: { ...process.env, ORBIT_MIXER_CS: WIN_HELPER_CS }
  })
  let buffer = ''
  child.stdout.on('data', (d: Buffer) => {
    buffer += d.toString('utf8')
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      const space = line.indexOf(' ')
      const id = Number(line.slice(0, space))
      const done = waiting.get(id)
      if (done) {
        waiting.delete(id)
        done(line.slice(space + 1))
      }
    }
  })
  child.stderr.on('data', (d: Buffer) => logError('volume mixer', new Error(d.toString().trim())))
  child.on('error', (err) => logError('volume mixer', err))
  child.on('exit', () => {
    if (helper === child) helper = null
    for (const done of waiting.values()) done('{"ok":false}')
    waiting.clear()
  })
  return child
}

function ask<T>(command: string, timeout = 8000): Promise<T | null> {
  helper ??= startHelper()
  const id = nextRequest++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve(null)
    }, timeout)
    waiting.set(id, (text) => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(text) as T)
      } catch {
        resolve(null)
      }
    })
    helper!.stdin.write(`${id} ${command}\n`)
  })
}

/** Each app's sessions from the last look, so a slider knows which ones to change. */
let targets: Record<string, string[]> = {}
const icons = new Map<string, string | null>()
/** The helper's last complaint, so the log gets each one once rather than twice a second. */
let lastHelperProblem = ''

async function iconFor(exe: string): Promise<string | undefined> {
  if (!icons.has(exe)) {
    const img = await app.getFileIcon(exe, { size: 'normal' }).catch(() => null)
    icons.set(exe, img && !img.isEmpty() ? img.toDataURL() : null)
  }
  return icons.get(exe) ?? undefined
}

async function windowsState(): Promise<MixerState> {
  // The first look starts PowerShell and builds the helper, which takes a few seconds.
  const raw = await ask<RawList>('list', helper ? 5000 : 30000)
  if (!raw?.ok) return { apps: [], problem: 'Windows didn’t answer about its sound. Press Look again.' }
  if (raw.err && raw.err !== lastHelperProblem) logError('volume mixer', new Error(raw.err))
  lastHelperProblem = raw.err ?? ''
  const grouped = groupSessions(raw)
  targets = grouped.targets
  await Promise.all(
    grouped.apps.map(async (a) => {
      const exe = grouped.exes[a.id]
      if (exe) a.icon = await iconFor(exe)
    })
  )
  return {
    apps: grouped.apps,
    device: raw.master?.name || undefined,
    note: grouped.apps.length <= 1 ? 'Apps show here once they’ve played a sound. Start a song, a call or a game.' : undefined
  }
}

async function windowsSet(id: string, volume: number | null, muted: boolean | null): Promise<boolean> {
  const list = targets[id]
  if (!list?.length) return false
  const vol = volume === null ? -1 : clampVolume(volume) / 100
  const mute = muted === null ? -1 : muted ? 1 : 0
  return (await ask<{ ok: boolean }>(`set ${list.join(',')} ${vol} ${mute}`))?.ok === true
}

// ---------------------------------------------------------------------------------------------
// Mac

const run = promisify(execFile)

/** JavaScript for Automation: reads or sets the Mac's volume and the apps that allow it. */
const MAC_SCRIPT = `
function run(argv) {
  var apps = ${JSON.stringify(MAC_APPS.map((a) => ({ id: a.id, app: a.app })))};
  var se = Application.currentApplication(); se.includeStandardAdditions = true;
  var what = argv[0], id = argv[1], value = argv[2];
  if (what === 'set') {
    if (id === 'master') {
      if (value === 'mute') se.setVolume(null, { outputMuted: true });
      else if (value === 'unmute') se.setVolume(null, { outputMuted: false });
      else se.setVolume(null, { outputVolume: Number(value) });
      return 'ok';
    }
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) { var a = Application(apps[i].app); if (!a.running()) return 'no'; a.soundVolume = Number(value); return 'ok' }
    return 'no';
  }
  var out = { master: null, apps: [] };
  try { var v = se.getVolumeSettings(); out.master = { vol: typeof v.outputVolume === 'number' ? v.outputVolume : null, mute: v.outputMuted === true } } catch (e) {}
  apps.forEach(function (x) { try { var a = Application(x.app); if (a.running()) out.apps.push({ id: x.id, vol: a.soundVolume() }) } catch (e) {} });
  return JSON.stringify(out);
}`

async function mac(args: string[]): Promise<string | null> {
  try {
    return (await run('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, ...args], { timeout: 8000 })).stdout.trim()
  } catch (err) {
    logError('volume mixer', err)
    return null
  }
}

/** Spotify and Music have no mute, so muting sets them to 0; this is the volume to go back to. */
const macBefore: Record<string, number> = {}

async function macStateNow(): Promise<MixerState> {
  const text = await mac(['list'])
  let raw: RawMacList | null = null
  try {
    raw = text ? (JSON.parse(text) as RawMacList) : null
  } catch {
    raw = null
  }
  if (!raw) return { apps: [], problem: 'macOS didn’t answer about its sound. Press Look again.' }
  // Someone turned it up somewhere else: it isn't muted any more.
  for (const a of raw.apps) if (a.vol > 0) delete macBefore[a.id]
  return macState(raw, macBefore)
}

async function macSet(id: string, volume: number | null, muted: boolean | null): Promise<boolean> {
  if (id === 'master') {
    if (muted !== null) return (await mac(['set', 'master', muted ? 'mute' : 'unmute'])) === 'ok'
    return volume !== null && (await mac(['set', 'master', String(clampVolume(volume))])) === 'ok'
  }
  if (muted === true) {
    const now = (await macStateNow()).apps.find((a) => a.id === id)
    if (now && !now.muted) macBefore[id] = now.volume
    return (await mac(['set', id, '0'])) === 'ok'
  }
  if (muted === false) {
    const back = macBefore[id] ?? 50
    delete macBefore[id]
    return (await mac(['set', id, String(back)])) === 'ok'
  }
  if (volume === null) return false
  if (macBefore[id] !== undefined) {
    // Moving a muted slider changes what it goes back to, and keeps it quiet.
    macBefore[id] = clampVolume(volume)
    return true
  }
  return (await mac(['set', id, String(clampVolume(volume))])) === 'ok'
}

// ---------------------------------------------------------------------------------------------

let looking: Promise<MixerState> | null = null
let last: { at: number; state: MixerState } | null = null

/** The sliders as they are now (looks are shared when Orbit and the phone ask at once). */
export function mixerState(): Promise<MixerState> {
  if (last && Date.now() - last.at < 250) return Promise.resolve(last.state)
  looking ??= (async () => {
    try {
      const state: MixerState =
        process.platform === 'win32' ? await windowsState() : IS_MAC ? await macStateNow() : { apps: [], problem: 'The volume mixer works on Windows and on a Mac.' }
      last = { at: Date.now(), state }
      return state
    } catch (err) {
      logError('volume mixer', err)
      return { apps: [], problem: 'Couldn’t read the sound settings.' }
    } finally {
      looking = null
    }
  })()
  return looking
}

/** Sets an app's volume (0 to 100) and/or mute; false if it didn't take. */
export async function mixerSet(id: string, volume: number | null, muted: boolean | null): Promise<boolean> {
  last = null
  if (process.platform === 'win32') {
    if (!targets[id]) await mixerState()
    return windowsSet(id, volume, muted)
  }
  if (IS_MAC) return macSet(id, volume, muted)
  return false
}

/** Nudges an app's volume up or down (for the phone's buttons and commands). */
export async function mixerNudge(id: string, by: number): Promise<boolean> {
  const now = (await mixerState()).apps.find((a) => a.id === id)
  if (!now) return false
  return mixerSet(id, now.volume + by, null)
}

/** Slider drags send a lot of values: only the latest one per app is sent once the last has gone. */
const pending = new Map<string, number>()
const busy = new Set<string>()

export async function mixerSlide(id: string, volume: number): Promise<boolean> {
  pending.set(id, volume)
  if (busy.has(id)) return true
  busy.add(id)
  let ok = true
  try {
    while (pending.has(id)) {
      const v = pending.get(id)!
      pending.delete(id)
      ok = await mixerSet(id, v, null)
    }
  } finally {
    busy.delete(id)
  }
  return ok
}

export function setupMixer(): void {
  ipcMain.handle('mixer:get', () => mixerState())
  ipcMain.handle('mixer:volume', (_e, id: string, volume: number) => mixerSlide(String(id), clampVolume(volume)))
  ipcMain.handle('mixer:mute', (_e, id: string, muted: boolean) => mixerSet(String(id), null, muted === true))
}

export function teardownMixer(): void {
  helper?.kill()
  helper = null
}

