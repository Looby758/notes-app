import { CAM_FPS, QUEUE_NAME, type QueueLayout } from '@shared/phoneCam'

/**
 * The Windows side of the phone webcam: a small C# program, compiled by PowerShell when it starts
 * (so nothing is installed), that becomes the picture behind "OBS Virtual Camera".
 *
 * Orbit sends it the phone's JPEG frames on stdin. One thread decodes each frame and fits it into
 * the camera's size (with black bars, or cropped to fill), turning it into NV12. Another writes the
 * newest frame into the shared memory 30 times a second, which the driver needs to keep the camera
 * alive, showing a "waiting for your phone" picture when no frames are coming. When stdin closes
 * (Orbit turned it off, or quit) it marks the camera stopped and exits.
 *
 * It prints one line when it starts: READY, IN_USE (something else, usually OBS itself, is already
 * the virtual camera) or ERR and why.
 */
export const CAM_HELPER_CS = String.raw`
using System;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;

public static class OrbitCam {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileMappingW(IntPtr file, IntPtr attributes, uint protect, uint sizeHigh, uint sizeLow, string name);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenFileMappingW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr MapViewOfFile(IntPtr mapping, uint access, uint offsetHigh, uint offsetLow, UIntPtr bytes);
  [DllImport("kernel32.dll")] static extern bool UnmapViewOfFile(IntPtr view);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);

  const uint PAGE_READWRITE = 4, FILE_MAP_READ = 4, FILE_MAP_ALL_ACCESS = 0xF001F;
  const int STATE = 8, READY = 2, STOPPING = 3;

  static readonly object gate = new object();
  static readonly Stopwatch clock = Stopwatch.StartNew();
  static int W, H;
  static volatile bool fill, done;
  static byte[] latest, waiting, pixels;
  static long lastFrameMs = -100000;
  static Bitmap canvas;
  static Graphics g;

  public static void Run(string name, int w, int h, long interval, int size, int o0, int o1, int o2, bool startFill) {
    W = w; H = h; fill = startFill;
    // Something else has the camera. If it's a camera that just stopped (Orbit's own, a moment ago),
    // the apps reading it let go within a frame or two, so wait a few seconds before giving up.
    for (int tries = 0; ; tries++) {
      IntPtr existing = OpenFileMappingW(FILE_MAP_READ, false, name);
      if (existing == IntPtr.Zero) break;
      CloseHandle(existing);
      if (tries >= 40) { Console.WriteLine("IN_USE"); return; }
      Thread.Sleep(100);
    }
    IntPtr mapping = CreateFileMappingW(new IntPtr(-1), IntPtr.Zero, PAGE_READWRITE, 0, (uint)size, name);
    if (mapping == IntPtr.Zero) { Console.WriteLine("ERR Couldn't make the camera's memory (" + Marshal.GetLastWin32Error() + ")."); return; }
    IntPtr view = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, UIntPtr.Zero);
    if (view == IntPtr.Zero) { CloseHandle(mapping); Console.WriteLine("ERR Couldn't open the camera's memory."); return; }

    int[] offsets = new int[] { o0, o1, o2 };
    Marshal.WriteInt32(view, 0, 0);
    Marshal.WriteInt32(view, 4, 0);
    Marshal.WriteInt32(view, STATE, 1);
    for (int i = 0; i < 3; i++) Marshal.WriteInt32(view, 12 + i * 4, offsets[i]);
    Marshal.WriteInt32(view, 24, 0);
    Marshal.WriteInt32(view, 28, w);
    Marshal.WriteInt32(view, 32, h);
    Marshal.WriteInt64(view, 40, interval);

    canvas = new Bitmap(W, H, PixelFormat.Format32bppArgb);
    g = Graphics.FromImage(canvas);
    g.InterpolationMode = InterpolationMode.Bilinear;
    g.PixelOffsetMode = PixelOffsetMode.HighSpeed;
    waiting = Waiting();

    Thread reader = new Thread(ReadInput);
    reader.IsBackground = true;
    reader.Start();
    timeBeginPeriod(1);
    Console.WriteLine("READY");
    Console.Out.Flush();

    int inc = 0;
    long next = clock.Elapsed.Ticks;
    while (!done) {
      byte[] frame;
      lock (gate) frame = clock.ElapsedMilliseconds - lastFrameMs < 2500 && latest != null ? latest : waiting;
      inc++;
      int at = offsets[(int)((uint)inc % 3)];
      Marshal.WriteInt32(view, 0, inc);
      Marshal.WriteInt64(view, at, clock.Elapsed.Ticks * 100);
      Marshal.Copy(frame, 0, IntPtr.Add(view, at + 32), frame.Length);
      Marshal.WriteInt32(view, 4, inc);
      Marshal.WriteInt32(view, STATE, READY);
      next += interval;
      long now = clock.Elapsed.Ticks;
      if (next < now - interval * 3) next = now;
      int wait = (int)((next - now) / 10000);
      if (wait > 0) Thread.Sleep(wait);
    }
    Marshal.WriteInt32(view, STATE, STOPPING);
    UnmapViewOfFile(view);
    CloseHandle(mapping);
  }

  static bool ReadFull(Stream s, byte[] buffer, int count) {
    int got = 0;
    while (got < count) {
      int n = s.Read(buffer, got, count - got);
      if (n <= 0) return false;
      got += n;
    }
    return true;
  }

  static void ReadInput() {
    try {
      Stream input = Console.OpenStandardInput();
      byte[] head = new byte[5];
      while (ReadFull(input, head, 5)) {
        int length = BitConverter.ToInt32(head, 1);
        if (length < 0 || length > 16 * 1024 * 1024) break;
        byte[] data = new byte[length];
        if (!ReadFull(input, data, length)) break;
        if (head[0] == 1) {
          byte[] frame = Decode(data);
          if (frame != null) lock (gate) { latest = frame; lastFrameMs = clock.ElapsedMilliseconds; }
        } else if (head[0] == 2) {
          fill = length > 0 && data[0] == 1;
        }
      }
    } catch (Exception) { }
    done = true;
  }

  static byte[] Decode(byte[] jpeg) {
    try {
      using (MemoryStream ms = new MemoryStream(jpeg))
      using (Image picture = Image.FromStream(ms, false, false)) {
        g.Clear(Color.Black);
        float sx = (float)W / picture.Width, sy = (float)H / picture.Height;
        float s = fill ? Math.Max(sx, sy) : Math.Min(sx, sy);
        float dw = picture.Width * s, dh = picture.Height * s;
        g.DrawImage(picture, (W - dw) / 2, (H - dh) / 2, dw, dh);
        return ToNv12();
      }
    } catch (Exception) { return null; }
  }

  // The picture shown in calls while the phone isn't sending.
  static byte[] Waiting() {
    g.Clear(Color.FromArgb(22, 22, 28));
    g.TextRenderingHint = TextRenderingHint.AntiAlias;
    using (Font big = new Font("Segoe UI", H / 18f, FontStyle.Bold, GraphicsUnit.Pixel))
    using (Font small = new Font("Segoe UI", H / 34f, GraphicsUnit.Pixel))
    using (Brush white = new SolidBrush(Color.FromArgb(232, 232, 238)))
    using (Brush grey = new SolidBrush(Color.FromArgb(154, 154, 168)))
    using (Brush accent = new SolidBrush(Color.FromArgb(124, 108, 240))) {
      StringFormat centre = new StringFormat();
      centre.Alignment = StringAlignment.Center;
      float r = H / 14f;
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.FillEllipse(accent, W / 2f - r, H * 0.36f - r, r * 2, r * 2);
      g.DrawString("Waiting for your phone", big, white, new RectangleF(0, H * 0.48f, W, H * 0.1f), centre);
      g.DrawString("Open the Orbit webcam page on your phone and tap Start", small, grey, new RectangleF(0, H * 0.6f, W, H * 0.08f), centre);
      g.SmoothingMode = SmoothingMode.None;
    }
    return ToNv12();
  }

  // BT.601 (what webcams send), studio range, colour taken from each 2x2 block's average.
  static byte[] ToNv12() {
    BitmapData bits = canvas.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int stride = bits.Stride;
    if (pixels == null || pixels.Length != stride * H) pixels = new byte[stride * H];
    Marshal.Copy(bits.Scan0, pixels, 0, stride * H);
    canvas.UnlockBits(bits);
    byte[] nv = new byte[W * H * 3 / 2];
    byte[] p = pixels;
    for (int y = 0; y < H; y++) {
      int row = y * stride, outRow = y * W;
      for (int x = 0; x < W; x++) {
        int i = row + x * 4;
        nv[outRow + x] = (byte)(((66 * p[i + 2] + 129 * p[i + 1] + 25 * p[i] + 128) >> 8) + 16);
      }
    }
    int uv = W * H;
    for (int y = 0; y < H / 2; y++) {
      int r0 = y * 2 * stride, r1 = r0 + stride;
      for (int x = 0; x < W / 2; x++) {
        int a = r0 + x * 8, b = r1 + x * 8;
        int B = p[a] + p[a + 4] + p[b] + p[b + 4];
        int G = p[a + 1] + p[a + 5] + p[b + 1] + p[b + 5];
        int R = p[a + 2] + p[a + 6] + p[b + 2] + p[b + 6];
        nv[uv++] = (byte)(((-38 * R - 74 * G + 112 * B + 512) >> 10) + 128);
        nv[uv++] = (byte)(((112 * R - 94 * G - 18 * B + 512) >> 10) + 128);
      }
    }
    return nv;
  }
}
`

/** The PowerShell that compiles the helper and starts it with this camera size. */
export function camHelperScript(width: number, height: number, layout: QueueLayout, fill: boolean): string {
  const [o0, o1, o2] = layout.offsets
  return `$src = @'\n${CAM_HELPER_CS}\n'@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing
[OrbitCam]::Run('${QUEUE_NAME}', ${width}, ${height}, ${layout.interval}, ${layout.size}, ${o0}, ${o1}, ${o2}, $${fill ? 'true' : 'false'})
`
}

export { CAM_FPS }
