# Generates the two PWA icons (192 and 512 px) with Pillow.
from PIL import Image, ImageDraw

TEAL = (15, 118, 110, 255)
WHITE = (255, 255, 255, 255)


def make_icon(size):
    img = Image.new("RGBA", (size, size), TEAL)
    d = ImageDraw.Draw(img)
    s = size / 512.0  # scale factor from the 512 design

    def pt(x, y):
        return (x * s, y * s)

    # rounded-square background already there; draw a simple standing figure
    # with a bent knee (the "pose" glyph)
    lw = int(26 * s)
    # head
    d.ellipse([pt(226, 60), pt(286, 120)], fill=WHITE)
    # torso
    d.line([pt(256, 120), pt(256, 270)], fill=WHITE, width=lw)
    # arms
    d.line([pt(256, 150), pt(180, 225)], fill=WHITE, width=lw)
    d.line([pt(256, 150), pt(332, 225)], fill=WHITE, width=lw)
    # left leg straight
    d.line([pt(256, 270), pt(212, 460)], fill=WHITE, width=lw)
    # right leg with bent knee
    d.line([pt(256, 270), pt(300, 350)], fill=WHITE, width=lw)
    d.line([pt(300, 350), pt(262, 460)], fill=WHITE, width=lw)
    # angle arc at the right knee (theme: joint angle)
    d.arc([pt(272, 322), pt(352, 402)], start=20, end=160, fill=WHITE, width=int(lw * 0.5))
    return img


make_icon(192).save("icons/icon-192.png")
make_icon(512).save("icons/icon-512.png")
print("icons written")
