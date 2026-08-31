import os
import subprocess

def make_shortcut():
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    target_dir = os.path.dirname(os.path.abspath(__file__))
    target_bat = os.path.join(target_dir, "INICIAR_BOT.bat")
    icon_path = os.path.join(target_dir, "binance_icon.ico")
    shortcut_path = os.path.join(desktop, "Binance Trading Bot.lnk")

    vbs_content = f'''
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "{shortcut_path}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "{target_bat}"
oLink.WorkingDirectory = "{target_dir}"
oLink.Description = "Iniciar Bot Binance Futures"
oLink.IconLocation = "{icon_path},0"
oLink.Save
'''
    vbs_file = os.path.join(target_dir, "_temp_shortcut.vbs")
    with open(vbs_file, "w", encoding="utf-8") as f:
        f.write(vbs_content)

    subprocess.run(["cscript", "//nologo", vbs_file], check=True)
    if os.path.exists(vbs_file):
        os.remove(vbs_file)

    print(f"Acceso directo creado con exito en: {shortcut_path}")

if __name__ == "__main__":
    make_shortcut()
