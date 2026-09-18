# Ghost Obfuscator (Delta-safe)

Free standalone UI + engine. **No Lovable credits needed.**

## Use now (no Pages wait)

1. Clone or download this repo
2. Open `index.html` in Chrome/Firefox
3. Obfuscate → copy → paste into Delta

## GitHub Pages

Repo **Settings → Pages → Deploy from branch → `bunny` / root ( / ) → Save**

Then: `https://cr1msonlol77-arch.github.io/ghost-obfuscator/`

## Engine

`src/lib/obfuscator.js` — no getfenv, bit32 + pure Lua XOR fallback, Delta-safe.

Test input:

```lua
print("ghost ok")
```
