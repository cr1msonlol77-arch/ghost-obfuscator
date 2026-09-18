# Ghost Obfuscator (Delta-safe)

Luau obfuscator engine fixed for **Delta** and other Roblox executors.

## The bug

Old anti-tamper emitted:

```lua
local X = getfenv and getfenv() or _ENV
if type(X) ~= "table" then return end
```

`getfenv` / `_ENV` do not exist in Luau → script **returns immediately** with no error.

## Fix

- Anti-tamper is executor-safe (never aborts)
- VM wrapper uses `assert(loadstring or load)` so failures are visible
- Hardened preset: control-flow flatten off by default
- ASCII-only mangled names

## Use in Lovable

1. Open your Ghost Obfuscator Lovable project
2. Replace the engine with `src/lib/obfuscator.js` from this repo
3. Wire UI to `obfuscate(source, { ...PRESETS.hardened, preset: "hardened" })`

Live site: https://ghost-obfuscator.lovable.app  
(still needs this engine swapped in via Lovable editor — GitHub alone does not auto-deploy that app)

## Test

```lua
print("ghost ok")
```

Obfuscate → run in Delta → should print `ghost ok`.
