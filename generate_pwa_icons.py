import os
from PIL import Image, ImageDraw, ImageFont

public_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frontend', 'public')
os.makedirs(public_dir, exist_ok=True)

def create_pwa_icon(size, is_maskable=False):
    # Fondo con gradiente oscuro estilizado
    img = Image.new('RGBA', (size, size), (2, 6, 23, 255)) # slate-950
    draw = ImageDraw.Draw(img)
    
    # Margen para maskable o standard
    padding = int(size * 0.12) if is_maskable else int(size * 0.05)
    inner_box = (padding, padding, size - padding, size - padding)
    
    # Círculo base con borde dorado
    bg_circle = (padding + 2, padding + 2, size - padding - 2, size - padding - 2)
    draw.ellipse(bg_circle, fill=(15, 23, 42, 255), outline=(245, 158, 11, 255), width=max(2, int(size * 0.03)))
    
    # Anillo decorativo interior sutil
    inner_ring = (padding + int(size * 0.08), padding + int(size * 0.08), size - padding - int(size * 0.08), size - padding - int(size * 0.08))
    draw.ellipse(inner_ring, outline=(217, 119, 6, 120), width=max(1, int(size * 0.015)))
    
    # Dibujar Rayo / Gráfico de Velas de Alta Frecuencia (Símbolo WTN Trading)
    cx = size // 2
    cy = size // 2
    s = size * 0.45
    
    # Rayo angular moderno
    bolt_points = [
        (cx + int(s * 0.10), cy - int(s * 0.65)),
        (cx - int(s * 0.35), cy - int(s * 0.05)),
        (cx - int(s * 0.02), cy - int(s * 0.05)),
        (cx - int(s * 0.15), cy + int(s * 0.65)),
        (cx + int(s * 0.40), cy + int(s * 0.02)),
        (cx + int(s * 0.05), cy + int(s * 0.02)),
    ]
    # Sombra del rayo
    shadow_points = [(p[0] + max(1, int(size * 0.015)), p[1] + max(1, int(size * 0.015))) for p in bolt_points]
    draw.polygon(shadow_points, fill=(180, 83, 9, 180))
    # Rayo dorado
    draw.polygon(bolt_points, fill=(251, 191, 36, 255))
    
    # Candlestick alcista decorativa a la izquierda
    bar_x = cx - int(s * 0.48)
    wick_w = max(1, int(size * 0.012))
    draw.line([(bar_x, cy - int(s * 0.45)), (bar_x, cy + int(s * 0.35))], fill=(16, 185, 129, 220), width=wick_w)
    draw.rectangle([bar_x - int(size * 0.025), cy - int(s * 0.25), bar_x + int(size * 0.025), cy + int(s * 0.15)], fill=(16, 185, 129, 255))
    
    # Candlestick alcista decorativa a la derecha
    bar_x2 = cx + int(s * 0.48)
    draw.line([(bar_x2, cy - int(s * 0.35)), (bar_x2, cy + int(s * 0.45))], fill=(16, 185, 129, 220), width=wick_w)
    draw.rectangle([bar_x2 - int(size * 0.025), cy - int(s * 0.15), bar_x2 + int(size * 0.025), cy + int(s * 0.25)], fill=(16, 185, 129, 255))

    return img

# Generar 192x192, 512x512, maskable y apple-touch-icon
icon_192 = create_pwa_icon(192, is_maskable=False)
icon_192.save(os.path.join(public_dir, 'icon-192.png'), 'PNG')

icon_512 = create_pwa_icon(512, is_maskable=False)
icon_512.save(os.path.join(public_dir, 'icon-512.png'), 'PNG')

icon_maskable = create_pwa_icon(512, is_maskable=True)
icon_maskable.save(os.path.join(public_dir, 'icon-512-maskable.png'), 'PNG')

apple_icon = create_pwa_icon(180, is_maskable=False)
apple_icon.save(os.path.join(public_dir, 'apple-touch-icon.png'), 'PNG')

favicon = create_pwa_icon(64, is_maskable=False)
favicon.save(os.path.join(public_dir, 'favicon.ico'), 'ICO')

print("Iconos PWA generados exitosamente en frontend/public")
