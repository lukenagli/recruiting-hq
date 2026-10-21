/** A Manhattan skyline at dusk, drawn in SVG (no image download). Decorative only. */
export default function Skyline() {
  // [x, width, height] for the plain towers; landmarks are drawn separately below.
  const towers: [number, number, number][] = [
    [0, 46, 70], [40, 38, 104], [74, 52, 82], [120, 34, 128], [150, 58, 96], [204, 30, 150], [230, 48, 112],
    [274, 40, 86], [310, 62, 132], [368, 36, 98], [400, 44, 160], [440, 54, 118], [490, 30, 92], [516, 48, 140],
    [608, 40, 120], [644, 56, 92], [696, 34, 136], [726, 50, 104], [772, 38, 168], [806, 58, 116], [860, 32, 94],
    [890, 46, 146], [972, 40, 110], [1008, 54, 88], [1058, 36, 124], [1090, 50, 100], [1136, 64, 78],
  ]
  return (
    <svg className="skyline" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="sky-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3f7a" />
          <stop offset="1" stopColor="#1b2a55" />
        </linearGradient>
        <linearGradient id="sky-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14204a" />
          <stop offset="1" stopColor="#0b1430" />
        </linearGradient>
        <pattern id="windows" width="9" height="11" patternUnits="userSpaceOnUse">
          <rect x="2" y="3" width="3" height="4" fill="#ffd98a" opacity="0.55" />
        </pattern>
      </defs>

      {/* far row */}
      <g fill="url(#sky-far)" opacity="0.9">
        {towers.map(([x, w, h], i) => (
          <rect key={`f${i}`} x={x + 12} y={260 - h * 0.8 - 30} width={w * 0.9} height={h * 0.8 + 30} />
        ))}
      </g>

      {/* landmarks */}
      <g fill="url(#sky-near)">
        {/* Empire State Building */}
        <path d="M560 260V120h8v-14h6V84h6V60h4V22h2v38h4v24h6v22h6v14h8v140z" />
        {/* Chrysler Building */}
        <path d="M938 260V118h4v-10h4l14-34 4-26 4 26 14 34h4v10h4v142z" />
        {/* One World Trade Center */}
        <path d="M30 260V112l20-56 20 56v148z" />
        <rect x="49" y="18" width="2" height="38" />
      </g>

      {/* near row with lit windows */}
      <g>
        {towers.map(([x, w, h], i) => (
          <g key={`n${i}`}>
            <rect x={x} y={260 - h} width={w} height={h} fill="url(#sky-near)" />
            {i % 3 !== 1 && <rect x={x + 4} y={260 - h + 10} width={w - 8} height={h - 18} fill="url(#windows)" opacity={0.35 + (i % 4) * 0.12} />}
          </g>
        ))}
      </g>
    </svg>
  )
}
