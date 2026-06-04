'use client';

import { useState } from 'react';

export interface Series {
  label: string;
  color: string;
  data:  number[];          // one value per x tick (e.g. 12 months)
}

interface Props {
  title:    string;
  series:   Series[];
  xLabels:  string[];       // e.g. ['Jan','Feb',…]
  valueFmt?: (n: number) => string;
  /** Force the y-axis floor to 0 (counts/$). Rates also start at 0. */
  height?:  number;
}

// viewBox geometry — the SVG scales to its container width via w-full.
const W = 560;
const padL = 44, padR = 14, padT = 10, padB = 26;

function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export default function LineChart({ title, series, xLabels, valueFmt = (n) => String(n), height = 230 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const H = height;

  const n = xLabels.length;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const rawMax = Math.max(0, ...series.flatMap((s) => s.data.map((v) => (Number.isFinite(v) ? v : 0))));
  const yMax = niceMax(rawMax);
  const allZero = rawMax === 0;

  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (Math.max(0, v) / yMax) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  const tipW = 116;
  const tipH = 16 + series.length * 13;
  const tipX = hover === null ? 0 : Math.min(Math.max(x(hover) + 8, padL), W - padR - tipW);

  return (
    <div className="card p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5 px-1">{title}</div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 px-1">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
            <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto' }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Horizontal gridlines + y labels */}
        {gridLines.map((g) => {
          const yy = padT + plotH - g * plotH;
          return (
            <g key={g}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
                {valueFmt(yMax * g)}
              </text>
            </g>
          );
        })}

        {/* X labels */}
        {xLabels.map((lbl, i) => (
          <text key={lbl + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {lbl}
          </text>
        ))}

        {/* Series polylines */}
        {!allZero &&
          series.map((s) => (
            <polyline
              key={s.label}
              fill="none"
              stroke={s.color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.data.map((v, i) => `${x(i)},${y(Number.isFinite(v) ? v : 0)}`).join(' ')}
            />
          ))}

        {allZero && (
          <text x={W / 2} y={padT + plotH / 2} textAnchor="middle" fontSize={11} fill="#cbd5e1">
            No data yet
          </text>
        )}

        {/* Hover guide + dots */}
        {hover !== null && !allZero && (
          <>
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + plotH} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.label} cx={x(hover)} cy={y(Number.isFinite(s.data[hover]) ? s.data[hover] : 0)} r={2.75} fill={s.color} />
            ))}
            <g>
              <rect x={tipX} y={padT} width={tipW} height={tipH} rx={4} fill="#0f172a" opacity={0.92} />
              <text x={tipX + 7} y={padT + 12} fontSize={9} fill="#e2e8f0" fontWeight="600">
                {xLabels[hover]}
              </text>
              {series.map((s, k) => (
                <text key={s.label} x={tipX + 7} y={padT + 25 + k * 13} fontSize={9} fill="#e2e8f0">
                  <tspan fill={s.color}>●</tspan> {s.label}: {valueFmt(Number.isFinite(s.data[hover]) ? s.data[hover] : 0)}
                </text>
              ))}
            </g>
          </>
        )}

        {/* Invisible hit bands for hover */}
        {xLabels.map((_, i) => {
          const bw = plotW / Math.max(n - 1, 1);
          return (
            <rect
              key={i}
              x={x(i) - bw / 2}
              y={padT}
              width={bw}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>
    </div>
  );
}
