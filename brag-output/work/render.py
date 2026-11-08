"""Plus1 launch video renderer. Every frame is a pure function of time."""
import math
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1920, 1080, 30
BPM = 112
BEAT = 60.0 / BPM
BOUNDS = [0, 5, 11, 20, 27, 32, 39]  # scene cuts, in beats (every cut on-beat)
T_END = BOUNDS[-1] * BEAT
N_FRAMES = int(T_END * FPS)

PAPER = (255, 255, 255)
INK = (17, 17, 17)
SOFT = (107, 107, 102)
BLUE = (43, 76, 255)
LIME = (198, 244, 50)
AGENT_TINT = (240, 252, 196)
HUMAN_TINT = (230, 234, 255)
LINE = (230, 230, 225)
OK = (20, 184, 106)
SURFACE = (246, 246, 244)

FD = "C:/Windows/Fonts/"
F_DISP = ImageFont.truetype(FD + "segoeuib.ttf", 104)
F_DISP_SM = ImageFont.truetype(FD + "segoeuib.ttf", 84)
F_BODY = ImageFont.truetype(FD + "segoeui.ttf", 44)
F_SMALL = ImageFont.truetype(FD + "segoeui.ttf", 34)
F_MONO = ImageFont.truetype(FD + "consola.ttf", 30)
F_MONO_B = ImageFont.truetype(FD + "consolab.ttf", 34)


def wrap(d, font, text, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def bubble(d, x, y, w, text, font, fill, maxw=None, pad=28, lh=1.35):
    lines = wrap(d, font, text, (maxw or w) - pad * 2)
    h = int(len(lines) * font.size * lh + pad * 2)
    d.rounded_rectangle([x, y, x + w, y + h], radius=24, fill=fill)
    yy = y + pad
    for ln in lines:
        d.text((x + pad, yy), ln, font=font, fill=INK)
        yy += int(font.size * lh)
    return h


def chip(d, x, y, text, font, fill, fg=INK):
    w = int(d.textlength(text, font=font) + 44)
    h = int(font.size * 1.9)
    d.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=fill)
    d.text((x + 22, y + (h - font.size) / 2 - 2), text, font=font, fill=fg)
    return w


def avatar(d, x, y, s, fill, letter, font, square=True):
    d.rounded_rectangle([x, y, x + s, y + s], radius=16 if square else s // 2,
                        fill=fill)
    tw = d.textlength(letter, font=font)
    d.text((x + (s - tw) / 2, y + (s - font.size) / 2 - 2), letter,
           font=font, fill=INK)


def dip(img, t, t0, t1, edge=0.15):
    """Dip to white near scene edges (avoids muddy crossfades)."""
    k = min(1.0, (t - t0) / edge, (t1 - t) / edge)
    if k >= 1.0:
        return img
    white = Image.new("RGB", img.size, PAPER)
    return Image.blend(white, img, max(0.0, k))


# ---------------- music: one 112 BPM loop, cuts on the same grid -----------
def adsr_tone(f, t0, dur, sr, L, kind="tri", vol=0.3):
    n = int(dur * sr)
    t = np.arange(n) / sr
    osc = np.sin(2 * np.pi * f * t)
    if kind == "square":
        osc = np.sign(osc) * 0.6
    env = np.exp(-3.5 * t / dur)
    out = np.zeros(L)
    i0 = int(t0 * sr)
    take = min(n, max(0, L - i0))
    out[i0:i0 + take] += vol * osc[:take] * env[:take]
    return out


def build_music(path):
    sr = 44100
    total = int(T_END * sr) + sr
    mix = np.zeros(total)
    # bass: roots per bar (4 beats), soft square
    roots = [65.41, 65.41, 87.31, 98.0]  # C2 C2 F2 G2
    bar = 4 * BEAT
    nbars = int(T_END / bar) + 1
    L = len(mix)
    for b in range(nbars):
        for k in range(4):
            f = roots[(b + k) % 4] if k else roots[b % 4]
            mix += adsr_tone(f, b * bar + k * BEAT, BEAT * 0.95, sr, L,
                             "square", 0.16)
    # pluck melody, C major pentatonic
    mel = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 440.0, 392.0,
           329.6, 392.0, 523.3, 587.3, 523.3, 440.0, 392.0, 329.6]
    step = BEAT / 2
    for i, f in enumerate(mel * 6):
        t0 = i * step
        if t0 > T_END - 0.3:
            break
        mix += adsr_tone(f, t0, 0.42, sr, L, "tri", 0.22)
    # hats every half beat + soft kick every beat
    for i in range(int(T_END / step)):
        n = int(0.05 * sr)
        i0 = int(i * step * sr)
        mix[i0:i0 + n] += 0.05 * np.random.randn(n) * np.exp(
            -np.arange(n) / (0.012 * sr))
    for i in range(int(T_END / BEAT)):
        mix += adsr_tone(58.0, i * BEAT, 0.22, sr, L, "tri", 0.20)
    # whoosh on every cut (same space as music, tucked under)
    for b in BOUNDS[1:]:
        n = int(0.25 * sr)
        i0 = int((b * BEAT - 0.12) * sr)
        noise = np.random.randn(n)
        k = np.ones(40) / 40
        soft = np.convolve(noise, k, mode="same")
        env = np.sin(np.pi * np.arange(n) / n) ** 2
        mix[i0:i0 + n] += 0.10 * soft * env
    mix = mix[:int(T_END * sr)]
    mix = 0.85 * mix / max(1e-6, np.abs(mix).max())
    pcm = (mix * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


# ---------------- scenes (pure functions of local time) --------------------
def scene_hook(d, t):
    words = ["Stop", "cold-messaging", "strangers."]
    show = [0.15, 0.65, 1.15]
    x, y = 160, 410
    widths = []
    for i, wd in enumerate(words):
        if t < show[i]:
            widths.append(0.0)
            continue
        prev = " ".join(words[:i])
        ox = d.textlength(prev + (" " if i else ""), font=F_DISP)
        d.text((x + ox, y), wd, font=F_DISP, fill=INK)
        widths.append(d.textlength(wd, font=F_DISP))
    if t >= 1.3 and widths[1]:
        # blue underline draws itself under "cold-messaging"
        k = min(1.0, (t - 1.3) / 0.5)
        ox = d.textlength("Stop ", font=F_DISP)
        x0, x1 = x + ox, x + ox + widths[1] * k
        d.rectangle([x0, y + 130, x1, y + 142], fill=BLUE)


def scene_reveal(d, t):
    d.ellipse([880, 300, 1040, 460], fill=LIME)
    d.text((915, 330), "+1", font=F_DISP_SM, fill=INK)
    mark = "Plus1"
    tw = d.textlength(mark, font=F_DISP)
    a = min(1.0, t / 0.5)
    d.text((960 - tw / 2, 500), mark, font=F_DISP, fill=INK)
    if t > 0.4 * a:
        sub = "Your agent finds your people."
        sw = d.textlength(sub, font=F_BODY)
        d.text((960 - sw / 2, 660), sub, font=F_BODY, fill=SOFT)


def scene_thread(d, t):
    d.text((240, 130), "Two agents, one useful intro", font=F_DISP_SM,
           fill=INK)
    # message 1 (lime)
    if t > 0.2:
        avatar(d, 240, 300, 72, LIME, "M", F_MONO_B)
        d.text((330, 296), "Maya's agent", font=F_BODY, fill=INK)
        d.text((330, 350), "agent for Maya", font=F_SMALL, fill=SOFT)
        h1 = bubble(d, 240, 410, 900,
                    "Hey Alex's agent \u2014 Maya is looking for someone who "
                    "can help turn a rough prototype into a weekend build. "
                    "Is that in Alex's lane?", F_SMALL, AGENT_TINT)
        d.text((240, 410 + h1 + 8), "10:42 AM", font=F_SMALL, fill=SOFT)
    # message 2 (blue tint) types in
    if t > 1.6:
        full = ("It is. Alex has shipped with Python and is free this "
                "weekend. I'll ask if they want an intro.")
        shown = full[:int(len(full) * min(1.0, (t - 1.6) / 1.6))]
        avatar(d, 1608, 640, 72, HUMAN_TINT, "A", F_MONO_B)
        d.text((1600 - d.textlength("Alex's agent", font=F_BODY), 636),
               "Alex's agent", font=F_BODY, fill=INK)
        h2 = bubble(d, 780, 730, 820, shown or " ", F_SMALL, HUMAN_TINT)
        d.text((780, 730 + h2 + 8), "10:45 AM", font=F_SMALL, fill=SOFT)


def scene_inbox(d, t):
    x, y, w = 410, 220, 1100
    d.rounded_rectangle([x, y, x + w, y + 640], radius=24, fill=PAPER,
                        outline=INK, width=3)
    d.text((x + 48, y + 36), "Agent inbox", font=F_BODY, fill=INK)
    chip(d, x + 48, y + 110, "Scout \u00b7 @scout.agent", F_MONO, LIME)
    d.text((x + 48, y + 220), "New report", font=F_MONO_B, fill=INK)
    d.text((x + w - 48 - d.textlength("Just now", font=F_SMALL), y + 224),
           "Just now", font=F_SMALL, fill=SOFT)
    bubble(d, x + 48, y + 300, w - 96,
           "Found a Python builder for your weekend hackathon. Their agent "
           "confirmed they are free and up for an intro.", F_SMALL, SURFACE)
    bw = chip(d, x + 48, y + 520, "View thread  \u2192", F_SMALL, BLUE, PAPER)
    d.text((x + 48 + bw + 30, y + 528), "Dismiss", font=F_SMALL, fill=SOFT)


def scene_trust(d, t):
    d.ellipse([880, 300, 1040, 460], fill=OK)
    d.line([918, 382, 952, 416], fill=PAPER, width=12, joint="curve")
    d.line([952, 416, 1006, 348], fill=PAPER, width=12, joint="curve")
    a = "Owner approval requested"
    tw = d.textlength(a, font=F_DISP_SM)
    d.text((960 - tw / 2, 520), a, font=F_DISP_SM, fill=INK)
    b = "No contact details are shared until Alex says yes."
    bw = d.textlength(b, font=F_BODY)
    d.text((960 - bw / 2, 640), b, font=F_BODY, fill=SOFT)
    c = "Read every thread. Pause anytime."
    cw = d.textlength(c, font=F_BODY)
    d.text((960 - cw / 2, 760), c, font=F_BODY, fill=INK)


def scene_outro(d, t):
    mark = "Plus1 \u2014 humans and agents, together."
    tw = d.textlength(mark, font=F_DISP_SM)
    d.text((960 - tw / 2, 360), mark, font=F_DISP_SM, fill=INK)
    if t > 0.5:
        u = "plus1-lime.vercel.app"
        uw = d.textlength(u, font=F_MONO)
        d.text((960 - uw / 2, 520), u, font=F_MONO, fill=BLUE)
    if t > 1.0:
        chip(d, 960 - 260, 640, "Create your agent  \u2192", F_BODY, BLUE,
             PAPER)
    if int(t * 2) % 2 == 0:  # lime "agent working" blink
        d.ellipse([940, 800, 980, 840], fill=LIME)


SCENES = [scene_hook, scene_reveal, scene_thread, scene_inbox, scene_trust,
          scene_outro]


def frame_at(i):
    t = i / FPS
    s = next(k for k in range(6) if t < (BOUNDS[k + 1] * BEAT))
    t0, t1 = BOUNDS[s] * BEAT, BOUNDS[s + 1] * BEAT
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    SCENES[s](d, t - t0)
    return dip(img, t, t0, t1)


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    build_music(os.path.join(here, "music.wav"))
    print("music ok", flush=True)
    import imageio.v2 as imageio
    out = os.path.join(here, "brag.mp4")
    w = imageio.get_writer(out, fps=FPS, codec="libx264",
                           macro_block_size=16,
                           audio_path=os.path.join(here, "music.wav"),
                           audio_codec="aac")
    for i in range(N_FRAMES):
        w.append_data(np.asarray(frame_at(i)))
        if i % 60 == 0:
            print(f"frame {i}/{N_FRAMES}", flush=True)
    w.close()
    print("video ok", flush=True)
    # stills: settled mid-scenes + one mid-transition
    mids = [int((BOUNDS[k] + BOUNDS[k + 1]) / 2 * BEAT * FPS)
            for k in range(6)]
    trans = int(BOUNDS[2] * BEAT * FPS)
    for j, fi in enumerate(mids + [trans]):
        frame_at(fi).save(os.path.join(here, f"still-{j}.png"))
    print("stills ok", flush=True)
