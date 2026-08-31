import os
from PIL import Image, ImageDraw

def create_binance_icon(output_path="binance_icon.ico"):
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    images = []

    # Binance official colors
    bg_color = (24, 26, 32, 255) # #181A20 Dark Binance theme
    gold_color = (240, 185, 11, 255) # #F0B90B Binance Gold

    for size in sizes:
        w, h = size
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Draw smooth rounded square background
        padding = max(1, int(w * 0.04))
        radius = int(w * 0.22)
        draw.rounded_rectangle(
            [padding, padding, w - padding - 1, h - padding - 1],
            radius=radius,
            fill=bg_color
        )

        # Draw gold border around the icon
        border_width = max(1, int(w * 0.03))
        draw.rounded_rectangle(
            [padding, padding, w - padding - 1, h - padding - 1],
            radius=radius,
            outline=gold_color,
            width=border_width
        )

        cx, cy = w / 2, h / 2
        s = w * 0.52 # base icon scale

        def draw_diamond(center_x, center_y, d_width, d_height, color):
            hw = d_width / 2
            hh = d_height / 2
            points = [
                (center_x, center_y - hh),
                (center_x + hw, center_y),
                (center_x, center_y + hh),
                (center_x - hw, center_y)
            ]
            draw.polygon(points, fill=color)

        # Center diamond
        c_size = s * 0.36
        draw_diamond(cx, cy, c_size, c_size, gold_color)

        # 4 outer diamonds
        offset = s * 0.40
        outer_size = s * 0.22
        # Top
        draw_diamond(cx, cy - offset, outer_size, outer_size, gold_color)
        # Bottom
        draw_diamond(cx, cy + offset, outer_size, outer_size, gold_color)
        # Left
        draw_diamond(cx - offset, cy, outer_size, outer_size, gold_color)
        # Right
        draw_diamond(cx + offset, cy, outer_size, outer_size, gold_color)

        images.append(img)

    # Save as multi-resolution ICO
    images[0].save(
        output_path,
        format="ICO",
        sizes=[(im.width, im.height) for im in images],
        append_images=images[1:]
    )
    print(f"Icon created successfully: {output_path}")

if __name__ == "__main__":
    create_binance_icon("binance_icon.ico")
