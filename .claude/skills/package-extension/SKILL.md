---
name: package-extension
description: Build and zip the Twitch extension for upload to the Twitch developer console. SCAFFOLD — refined once extension/ has real content.
---

# package-extension

Packages the Twitch extension (extension/) into an uploadable zip.

## Status: SCAFFOLD
extension/ currently has no built pages. When content exists, this skill will:

1. Verify required pages exist (panel.html, overlay.html, config.html, live_config.html) and their css/js.
2. Verify all asset references are relative (Twitch hosts the zip contents).
3. Produce the zip:
   ```powershell
   Compress-Archive -Path "E:\repos\twitch\total-party-krawl\extension\*" -DestinationPath "E:\repos\twitch\total-party-krawl\extension.zip" -Force
   ```
4. Remind: upload via the Twitch developer console; extension.zip is gitignored.
