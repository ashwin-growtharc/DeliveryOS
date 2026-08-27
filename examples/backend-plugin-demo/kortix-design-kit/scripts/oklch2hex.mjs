// oklch(L C H [/ A]) -> sRGB hex. Standard CSS Color 4 conversion:
// OKLCh -> OKLab -> LMS -> linear sRGB -> gamma-encoded sRGB.
function oklchToHex(L, C, H, A = 1) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const enc = lin.map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  });

  const hex = '#' + enc.map((v) => v.toString(16).padStart(2, '0')).join('');
  if (A >= 1) return hex;
  return hex + Math.round(Math.min(1, Math.max(0, A)) * 255).toString(16).padStart(2, '0');
}

const RE = /oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*(?:\/\s*([0-9.]+)\s*)?\)/;

export function convert(value) {
  const m = RE.exec(value);
  if (!m) return null;
  return oklchToHex(+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]);
}

if (process.argv[2]) console.log(convert(process.argv[2]));
