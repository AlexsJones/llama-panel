#!/usr/bin/env python3
"""Generate llama-panel app icons at all required sizes."""

from PIL import Image, ImageDraw
import math
import os

ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")


def draw_icon(size):
    """Draw a llama icon with terminal prompt on purple gradient background."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size  # shorthand

    # Rounded rectangle background with purple gradient
    # We'll simulate gradient by drawing horizontal strips
    corner_radius = int(s * 0.18)
    for y in range(s):
        t = y / s
        # Purple gradient: top (#5B4A9E) -> bottom (#3D2B6B)
        r = int(91 * (1 - t) + 61 * t)
        g = int(74 * (1 - t) + 43 * t)
        b = int(158 * (1 - t) + 107 * t)
        draw.line([(0, y), (s - 1, y)], fill=(r, g, b, 255))

    # Apply rounded corner mask
    mask = Image.new("L", (s, s), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=corner_radius, fill=255)
    img.putalpha(mask)

    # Re-create draw on masked image
    draw = ImageDraw.Draw(img)

    # Draw llama silhouette (white)
    white = (255, 255, 255, 230)

    # Scale helper
    def p(x_frac, y_frac):
        return (int(s * x_frac), int(s * y_frac))

    # Llama silhouette — cleaner, rounder proportions facing left
    # Head + neck + body as one smooth outline
    body = [
        # Left front hoof
        p(0.24, 0.86),
        p(0.24, 0.72),
        # Front leg left edge up to belly
        p(0.22, 0.62),
        # Neck left
        p(0.19, 0.52),
        p(0.17, 0.40),
        p(0.18, 0.32),
        # Head left / snout
        p(0.20, 0.26),
        p(0.24, 0.22),
        p(0.27, 0.21),  # nose tip
        p(0.29, 0.20),
        # Forehead up to left ear
        p(0.28, 0.17),
        p(0.26, 0.14),
        # Left ear
        p(0.24, 0.07),  # ear tip
        p(0.28, 0.13),  # ear inner base
        # Top of head
        p(0.30, 0.12),
        p(0.34, 0.11),
        p(0.37, 0.12),
        # Right ear
        p(0.39, 0.05),  # ear tip
        p(0.40, 0.12),  # ear inner base
        # Back of head
        p(0.41, 0.14),
        p(0.42, 0.17),
        p(0.41, 0.21),
        # Jaw / throat
        p(0.39, 0.24),
        p(0.36, 0.28),
        # Neck right
        p(0.34, 0.34),
        p(0.34, 0.42),
        # Chest curve into belly
        p(0.36, 0.50),
        p(0.40, 0.56),
        # Front right leg gap
        p(0.38, 0.72),
        p(0.38, 0.86),  # right front hoof
        p(0.42, 0.86),
        p(0.42, 0.72),
        # Belly
        p(0.44, 0.60),
        p(0.50, 0.57),
        p(0.56, 0.56),
        p(0.62, 0.57),
        # Rear left leg gap
        p(0.60, 0.72),
        p(0.60, 0.86),  # left rear hoof
        p(0.64, 0.86),
        p(0.64, 0.72),
        # Rump
        p(0.66, 0.60),
        p(0.70, 0.54),
        p(0.72, 0.50),
        # Back line
        p(0.70, 0.46),
        p(0.65, 0.44),
        p(0.58, 0.44),
        p(0.50, 0.46),
        p(0.44, 0.50),
        # Connect back to front left leg area
        p(0.38, 0.54),
        p(0.32, 0.56),
        p(0.28, 0.60),
        p(0.28, 0.72),
        p(0.28, 0.86),
    ]
    draw.polygon(body, fill=white)

    # Fill any gaps in the torso with an ellipse
    torso_cx, torso_cy = p(0.48, 0.54)
    torso_rx, torso_ry = int(s * 0.18), int(s * 0.10)
    draw.ellipse([torso_cx - torso_rx, torso_cy - torso_ry,
                  torso_cx + torso_rx, torso_cy + torso_ry], fill=white)

    # Tail — gentle upward curve
    tail_pts = [p(0.70, 0.48), p(0.74, 0.42), p(0.76, 0.36), p(0.75, 0.32)]
    lw_tail = max(2, int(s * 0.022))
    for i in range(len(tail_pts) - 1):
        draw.line([tail_pts[i], tail_pts[i + 1]], fill=white, width=lw_tail)

    # Eye
    eye_x, eye_y = p(0.33, 0.18)
    eye_r = max(2, int(s * 0.014))
    draw.ellipse([eye_x - eye_r, eye_y - eye_r, eye_x + eye_r, eye_y + eye_r],
                 fill=(61, 43, 107, 255))

    # Terminal prompt ">_" on the body
    prompt_color = (61, 43, 107, 210)
    lw = max(2, int(s * 0.026))

    # ">" chevron
    draw.line([p(0.36, 0.52), p(0.44, 0.58), p(0.36, 0.64)], fill=prompt_color, width=lw)

    # "_" cursor
    draw.line([p(0.47, 0.64), p(0.56, 0.64)], fill=prompt_color, width=lw)

    # Subtle circuit dots on forehead
    circuit_color = (200, 180, 255, 100)
    dot_r = max(1, int(s * 0.006))
    for cx, cy in [(0.29, 0.15), (0.32, 0.13), (0.35, 0.15), (0.31, 0.17)]:
        dx, dy = p(cx, cy)
        draw.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=circuit_color)

    return img


def main():
    os.makedirs(ICON_DIR, exist_ok=True)

    # Generate at 1024x1024 master size
    master = draw_icon(1024)
    master.save(os.path.join(ICON_DIR, "icon.png"))

    # Generate required sizes
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
    }

    for filename, sz in sizes.items():
        resized = master.resize((sz, sz), Image.LANCZOS)
        resized.save(os.path.join(ICON_DIR, filename))

    # Generate .ico (multi-size)
    ico_sizes = [16, 32, 48, 256]
    ico_images = [master.resize((sz, sz), Image.LANCZOS) for sz in ico_sizes]
    ico_images[0].save(
        os.path.join(ICON_DIR, "icon.ico"),
        format="ICO",
        sizes=[(sz, sz) for sz in ico_sizes],
        append_images=ico_images[1:],
    )

    print(f"Icons generated in {ICON_DIR}")
    for f in sorted(os.listdir(ICON_DIR)):
        path = os.path.join(ICON_DIR, f)
        img = Image.open(path)
        print(f"  {f}: {img.size[0]}x{img.size[1]}")


if __name__ == "__main__":
    main()
