/**
 * Ghost Obfuscator — Delta / executor-safe core (v1.1)
 *
 * Fixes vs original live site:
 *  1. anti-tamper never uses getfenv/_ENV (silent return)
 *  2. XOR via bit32.bxor with pure-Lua fallback
 *  3. identifiers never start with a digit
 *  4. strings extracted BEFORE comment strip
 *  5. field access (.Name / :Method) not renamed
 *  6. long-comment strip regex corrected
 *  7. loadstring path asserts so errors are visible
 *  8. CF flatten off by default (breaks module returns)
 *  9. junk never injected on blank / end / else lines
 */

const KEYWORDS = new Set(
  "and.break.do.else.elseif.end.false.for.function.goto.if.in.local.nil.not.or.repeat.return.then.true.until.while.self.continue.export.type.typeof".split(
    "."
  )
);

const RESERVED = new Set(
  "print.tostring.tonumber.pairs.ipairs.next.select.type.error.pcall.xpcall.assert.setmetatable.getmetatable.rawget.rawset.rawequal.rawlen.unpack.table.string.math.os.io.coroutine.bit32.bit.require.script.game.workspace.wait.spawn.delay.tick.warn.typeof.Instance.Vector3.Vector2.CFrame.Color3.UDim.UDim2.Enum.task.shared._G._ENV.Ray.BrickColor.NumberSequence.ColorSequence.TweenInfo.Random.Rect.Region3.Faces.Axes.PhysicalProperties.Players.LocalPlayer.HttpGet.loadstring.load.getgenv.getrenv.getrawmetatable.setclipboard.isfolder.makefolder.writefile.readfile.isfile.listfiles".split(
    "."
  )
);

function randInt(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function nameGen(style) {
  const used = new Set();
  const body = ["I", "l", "1", "i", "L"];
  const first = ["I", "l", "i", "L"];
  return function next() {
    let name = "";
    let tries = 0;
    do {
      if (style === "hex") {
        name = "_0x" + randInt(0x10000, 0xffffff).toString(16);
      } else {
        const len = randInt(8, 14);
        name = first[randInt(0, first.length - 1)];
        for (let i = 1; i < len; i++) name += body[randInt(0, body.length - 1)];
      }
      tries++;
    } while (used.has(name) && tries < 40);
    used.add(name);
    return name;
  };
}

function stripComments(src) {
  return src
    .replace(/--[[\[\][\s\S]*?\]\]/g, "")
    .replace(/(^|[^\\\n])--[^\n]*/g, "$1");
}

function unescapeLuaString(s) {
  return s.replace(/\\(n|t|r|"|'|\\|0|a|b|f|v)/g, (_, t) => {
    const map = {
      n: "\n",
      t: "\t",
      r: "\r",
      '"': '"',
      "'": "'",
      "\\": "\\",
      "0": "\0",
      a: "\x07",
      b: "\b",
      f: "\f",
      v: "\v",
    };
    return map[t] ?? t;
  });
}

function extractStrings(src) {
  const strings = [];
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "[") {
      const m = src.slice(i).match(/^\[(=*)\[/);
      if (m) {
        const close = "]" + m[1] + "]";
        const end = src.indexOf(close, i + m[0].length);
        if (end !== -1) {
          strings.push(src.slice(i + m[0].length, end));
          out += `__GHOST_STR_${strings.length - 1}__`;
          i = end + close.length;
          continue;
        }
      }
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let body = "";
      while (j < src.length) {
        if (src[j] === "\\" && j + 1 < src.length) {
          body += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === q || src[j] === "\n") break;
        body += src[j];
        j++;
      }
      if (src[j] === q) {
        strings.push(unescapeLuaString(body));
        out += `__GHOST_STR_${strings.length - 1}__`;
        i = j + 1;
        continue;
      }
    }
    if (c === "-" && src[i + 1] === "-") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return { code: out, strings };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mangleLocals(src, nextName) {
  const map = new Map();
  const re1 = /\blocal\s+(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re1.exec(src)) !== null) {
    const id = m[1];
    if (!id || KEYWORDS.has(id) || RESERVED.has(id) || map.has(id)) continue;
    map.set(id, nextName());
  }
  const re2 =
    /\blocal\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)+)\s*=/g;
  while ((m = re2.exec(src)) !== null) {
    for (const part of m[1].split(",").map((x) => x.trim())) {
      if (!part || KEYWORDS.has(part) || RESERVED.has(part) || map.has(part))
        continue;
      map.set(part, nextName());
    }
  }
  if (map.size === 0) return src;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(
    "(?<![.:])\\b(" + keys.map(escapeRe).join("|") + ")\\b",
    "g"
  );
  return src.replace(re, (id) => map.get(id) ?? id);
}

function mutateNumbers(src) {
  return src.replace(/(?<![\w.])(-?\d+)(?!\.\d)(?![\w])/g, (raw) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || Math.abs(n) > 1e6) return raw;
    if (n === 0 || n === 1) return raw;
    const k = randInt(1, 999);
    return `(${n + k}-${k})`;
  });
}

function encryptStrings(code, strings, decoderName, key) {
  const tables = strings.map((s) => {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      bytes.push((s.charCodeAt(i) ^ (key + (i % 7))) & 255);
    }
    return "{" + bytes.join(",") + "}";
  });
  const withCalls = code.replace(/__GHOST_STR_(\d+)__/g, (_, idx) => {
    return `${decoderName}(${tables[Number(idx)]})`;
  });
  const decoder =
    `local function ${decoderName}(t)\n` +
    `  local s = ""\n` +
    `  local _bx\n` +
    `  do\n` +
    `    local ok, b = pcall(function() return bit32 or bit end)\n` +
    `    if ok and b and b.bxor then\n` +
    `      _bx = function(a, c) return b.bxor(a, c) % 256 end\n` +
    `    else\n` +
    `      _bx = function(a, c)\n` +
    `        local r, bit = 0, 1\n` +
    `        a, c = a % 256, c % 256\n` +
    `        for _ = 1, 8 do\n` +
    `          local ab, cb = a % 2, c % 2\n` +
    `          if ab ~= cb then r = r + bit end\n` +
    `          a, c, bit = (a - ab) / 2, (c - cb) / 2, bit * 2\n` +
    `        end\n` +
    `        return r\n` +
    `      end\n` +
    `    end\n` +
    `  end\n` +
    `  for i = 1, #t do\n` +
    `    s = s .. string.char(_bx(t[i], (${key} + ((i - 1) % 7))))\n` +
    `  end\n` +
    `  return s\n` +
    `end\n`;
  return decoder + withCalls;
}

function restorePlainStrings(code, strings) {
  return code.replace(/__GHOST_STR_(\d+)__/g, (_, idx) => {
    const s = strings[Number(idx)] ?? "";
    return (
      '"' +
      s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r") +
      '"'
    );
  });
}

function injectJunk(src, nextName) {
  const makers = [
    () => `local ${nextName()} = function() return ${randInt(1000, 99999)} end`,
    () =>
      `if (${randInt(2, 9)} * ${randInt(2, 9)}) > 0 then local ${nextName()} = ${randInt(1, 99)} end`,
    () => `do local ${nextName()} = ${randInt(1, 9)} end`,
    () =>
      `local ${nextName()} = {${randInt(1, 9)},${randInt(1, 9)},${randInt(1, 9)}}`,
  ];
  const skip = /^(end|else|elseif|until|\)|,|\])/i;
  const lines = src.split("\n");
  const out = [];
  for (const line of lines) {
    out.push(line);
    const t = line.trim();
    if (!t || skip.test(t) || t.startsWith("--")) continue;
    if (Math.random() < 0.12) {
      out.push(makers[randInt(0, makers.length - 1)]());
    }
  }
  return out.join("\n");
}

function flattenCF(src, nextName) {
  const st = nextName();
  const tbl = nextName();
  return (
    `local ${st} = 1\n` +
    `local ${tbl} = {\n` +
    `  [1] = function()\n` +
    src +
    `\n    ${st} = 0\n` +
    `  end,\n` +
    `}\n` +
    `while ${st} ~= 0 do\n` +
    `  local __s = ${st}\n` +
    `  ${st} = 0\n` +
    `  local __f = ${tbl}[__s]\n` +
    `  if __f then __f() end\n` +
    `end\n`
  );
}

function antiTamperStub(nextName) {
  const a = nextName();
  const b = nextName();
  return (
    `-- integrity (executor-safe)\n` +
    `local ${a} = true\n` +
    `local ${b} = type(${a})\n` +
    `if ${b} == nil then end\n` +
    `pcall(function() end)\n`
  );
}

function wrapVM(src, nextName) {
  const key = randInt(23, 200);
  const bytes = [];
  for (let i = 0; i < src.length; i++) {
    bytes.push((src.charCodeAt(i) ^ (key + (i % 11))) & 255);
  }
  const arr = nextName();
  const dec = nextName();
  const fn = nextName();
  return (
    `-- Ghost VM (executor-safe)\n` +
    `local ${arr} = {${bytes.join(",")}}\n` +
    `local function ${dec}(t, k)\n` +
    `  local s = ""\n` +
    `  local _bx\n` +
    `  do\n` +
    `    local ok, b = pcall(function() return bit32 or bit end)\n` +
    `    if ok and b and b.bxor then\n` +
    `      _bx = function(a, c) return b.bxor(a, c) % 256 end\n` +
    `    else\n` +
    `      _bx = function(a, c)\n` +
    `        local r, bit = 0, 1\n` +
    `        a, c = a % 256, c % 256\n` +
    `        for _ = 1, 8 do\n` +
    `          local ab, cb = a % 2, c % 2\n` +
    `          if ab ~= cb then r = r + bit end\n` +
    `          a, c, bit = (a - ab) / 2, (c - cb) / 2, bit * 2\n` +
    `        end\n` +
    `        return r\n` +
    `      end\n` +
    `    end\n` +
    `  end\n` +
    `  for i = 1, #t do\n` +
    `    s = s .. string.char(_bx(t[i], (k + ((i - 1) % 11))))\n` +
    `  end\n` +
    `  return s\n` +
    `end\n` +
    `local __src = ${dec}(${arr}, ${key})\n` +
    `local __loader = loadstring or load\n` +
    `assert(__loader, "loadstring unavailable — use an executor")\n` +
    `local ${fn}, __err = __loader(__src)\n` +
    `assert(${fn}, tostring(__err or "compile failed"))\n` +
    `return ${fn}()\n`
  );
}

function entropy(s) {
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  const n = s.length || 1;
  let h = 0;
  for (const k in freq) {
    const p = freq[k] / n;
    if (p > 0) h -= p * Math.log2(p);
  }
  return Math.round(h * 100) / 100;
}

function obfuscate(source, options = {}) {
  const t0 = performance.now();
  const logs = [];
  const log = (step, detail, start) =>
    logs.push({
      step,
      detail,
      ms: Math.round((performance.now() - start) * 100) / 100,
    });

  const opts = {
    preset: "hardened",
    mangleIdentifiers: true,
    identifierStyle: "il1",
    encryptStrings: true,
    mutateNumbers: true,
    flattenControlFlow: false,
    injectJunk: true,
    antiTamper: true,
    virtualMachine: false,
    watermark: true,
    watermarkText: "-- [ Protected by Ghost Obfuscator ]",
    ...options,
  };

  const nextName = nameGen(opts.identifierStyle === "hex" ? "hex" : "il1");
  const decoderName = nextName();
  const xorKey = randInt(17, 220);

  let t = performance.now();
  const { code: withPlaceholders, strings } = extractStrings(source);
  log("Tokenize", `Extracted ${strings.length} string literals`, t);

  t = performance.now();
  let body = stripComments(withPlaceholders);
  log("Preprocess", `Stripped comments, ${body.length} bytes`, t);

  if (opts.mutateNumbers) {
    t = performance.now();
    body = mutateNumbers(body);
    log("Number Mutation", "Constants → arithmetic", t);
  }

  if (opts.mangleIdentifiers) {
    t = performance.now();
    body = mangleLocals(body, nextName);
    log("Identifier Mangling", `Style: ${opts.identifierStyle}`, t);
  }

  t = performance.now();
  if (opts.encryptStrings && strings.length > 0) {
    body = encryptStrings(body, strings, decoderName, xorKey);
    log("String Encryption", `XOR key ${xorKey}, ${strings.length} strings`, t);
  } else {
    body = restorePlainStrings(body, strings);
    log("String Restore", "Plain strings", t);
  }

  if (opts.injectJunk) {
    t = performance.now();
    body = injectJunk(body, nextName);
    log("Junk Injection", "Opaque noise", t);
  }

  if (opts.flattenControlFlow) {
    t = performance.now();
    body = flattenCF(body, nextName);
    log("Control Flow Flattening", "State machine", t);
  }

  if (opts.antiTamper) {
    t = performance.now();
    body = antiTamperStub(nextName) + body;
    log("Anti-Tamper", "Executor-safe stub (no getfenv)", t);
  }

  if (opts.virtualMachine) {
    t = performance.now();
    body = wrapVM(body, nextName);
    log("Ghost VM", "XOR payload + loadstring", t);
  }

  if (opts.watermark) {
    const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
    const stamp = new Date().toISOString();
    body =
      `${opts.watermarkText}\n` +
      `-- Build: ${tag}  |  Compiled: ${stamp}\n` +
      `-- Preset: ${opts.preset}\n` +
      body;
  }

  const originalBytes =
    typeof Blob !== "undefined"
      ? new Blob([source]).size
      : Buffer.byteLength(source);
  const obfuscatedBytes =
    typeof Blob !== "undefined"
      ? new Blob([body]).size
      : Buffer.byteLength(body);
  const compatibility = opts.virtualMachine
    ? "VM-Wrapped"
    : opts.flattenControlFlow
      ? "Partial"
      : "Full";

  log("Emit", `Total ${obfuscatedBytes} bytes`, t0);

  return {
    output: body,
    logs,
    metrics: {
      originalBytes,
      obfuscatedBytes,
      ratio:
        originalBytes === 0
          ? 0
          : Math.round((obfuscatedBytes / originalBytes) * 100) / 100,
      originalLines: source.split("\n").length,
      obfuscatedLines: body.split("\n").length,
      entropy: entropy(body),
      compatibility,
    },
  };
}

const PRESETS = {
  fast: {
    mangleIdentifiers: true,
    encryptStrings: false,
    mutateNumbers: false,
    flattenControlFlow: false,
    injectJunk: false,
    antiTamper: false,
    virtualMachine: false,
  },
  hardened: {
    mangleIdentifiers: true,
    encryptStrings: true,
    mutateNumbers: true,
    flattenControlFlow: false,
    injectJunk: true,
    antiTamper: true,
    virtualMachine: false,
  },
  ghostvm: {
    mangleIdentifiers: true,
    encryptStrings: true,
    mutateNumbers: true,
    flattenControlFlow: false,
    injectJunk: true,
    antiTamper: true,
    virtualMachine: true,
  },
};

export { obfuscate, PRESETS };
export default { obfuscate, PRESETS };
if (typeof module !== "undefined" && module.exports) {
  module.exports = { obfuscate, PRESETS };
}
