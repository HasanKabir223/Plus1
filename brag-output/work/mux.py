"""Mux render.frame_at frames + music.wav into brag.mp4 via on-machine ffmpeg.

Poster (strongest settled frame: outro with URL + CTA) replaces frame 0 so
every platform thumbnail shows it; duration and audio sync unchanged.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np

import render

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = r"C:\Program Files\Softdeluxe\Free Download Manager\ffmpeg.exe"
OUT = os.path.join(HERE, "brag.mp4")

# poster: settled outro frame (URL + CTA visible, blink dot on)
POSTER_I = int(19.0 * render.FPS)

cmd = [FFMPEG, "-y",
       "-f", "rawvideo", "-pix_fmt", "rgb24",
       "-s", f"{render.W}-{render.H}", "-r", str(render.FPS),
       "-i", "pipe:0",
       "-i", os.path.join(HERE, "music.wav"),
       "-c:v", "mpeg4", "-q:v", "2",
       "-c:a", "aac", "-b:a", "160k",
       "-shortest", "-movflags", "+faststart",
       OUT]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.STDOUT)
poster = render.frame_at(POSTER_I).convert("RGB")
proc.stdin.write(np.asarray(poster).tobytes())
for i in range(1, render.N_FRAMES):
    proc.stdin.write(np.asarray(render.frame_at(i).convert("RGB")).tobytes())
    if i % 120 == 0:
        print(f"fed {i}/{render.N_FRAMES}", flush=True)
proc.stdin.close()
print("rc =", proc.wait())
