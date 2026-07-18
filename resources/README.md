# resources/

Icons and packaging assets consumed by `electron-builder`. Drop real artwork
in place of the placeholders before shipping a release.

## Required icons

`electron-builder.yml` points at these paths — add the real files here:

| File                  | Used by            | Notes                                                       |
|-----------------------|--------------------|-------------------------------------------------------------|
| `icon.png` (512×512)  | Linux              | Source asset for AppImage/deb/rpm. Transparent background.  |
| `icon.ico`            | Windows            | Multi-resolution (.ico) with 16/32/48/64/128/256 frames.    |
| `icon.icns`           | macOS              | Generated from `icon.png` via `png2icns` or `iconutil`.     |

If a platform-specific file is missing, `electron-builder` falls back to its
default Electron icon. Builds still succeed, but the launcher will show the
generic Electron logo.

## Linux packaging hooks

`scripts/after-install.sh` and `scripts/before-remove.sh` are referenced by
the deb target. They refresh desktop / MIME / icon caches so the launcher
shows up immediately after install.

## macOS signing

`macos/entitlements.plist` is the hardened-runtime entitlement set used for
unsigned / local builds. Real signing / notarization is still TODO; see
`docs/DESIGN.md` §10.

## Quick icon regeneration

```bash
# from a single 1024×1024 source PNG (resources/source-icon.png)
# Linux
cp resources/source-icon.png resources/icon.png

# Windows
npx --yes @img/sharp-cli@^4 -i resources/source-icon.png -o resources/icon.ico resize 256 256

# macOS
npx --yes png2icns resources/icon.icns resources/source-icon.png
```

## Linux host requirements

`electron-builder` bundles its own `fpm` (a Ruby tool) into
`~/.cache/electron-builder/fpm/` to build `.deb` and `.rpm` packages. The
bundled Ruby still links against `libcrypt.so.1`, which is **not** shipped
by default on recent Arch-based distros.

Symptoms on a missing `libcrypt.so.1`:

```text
cannot execute  cause=exit status 127
  errorOut=.../fpm/.../ruby: error while loading shared libraries:
  libcrypt.so.1: cannot open shared object file: No such file or directory
```

Fixes (pick one):

| Distro | Command | Notes |
|--------|---------|-------|
| Arch / CachyOS / Manjaro | `paru -S libxcrypt-compat` (AUR) or `yay -S libxcrypt-compat` | Restores `libcrypt.so.1` system-wide. Affects nothing else. |
| Debian / Ubuntu | already ships `libcrypt.so.1` via `libcrypt1` | no action needed |
| Any distro | `gem install fpm` | electron-builder prefers a system `fpm` on `PATH` over its bundled one, so this also works around the issue |

Without `libcrypt.so.1`, the AppImage target still works (it does not need fpm).
The NSIS / dmg / zip targets are unaffected — those only run on Windows / macOS.