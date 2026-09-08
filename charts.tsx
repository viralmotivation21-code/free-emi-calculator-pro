import { useMemo } from "react";
import type { AmortRow, YearlyRow } from "../lib/emi";
import { formatINR, formatINR0 } from "../lib/emi";

/** Compact Indian money: ₹2.45 Cr / ₹18.6 L / ₹45.2k */
export function compactINR(n: number): string {
  if (!Number.isFinite(n)) return "₹0";
  const a = Math.abs(n);
  if (a >= 10000000) return `₹${trim2(n / 10000000)} Cr`;
  if (a >= 100000) return `₹${trim2(n / 100000)} L`;
  if (a >= 1000) return `₹${trim2(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}
function trim2(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? r.toString() : r.toFixed(2).replace(/0$/, "");
}

/* ── Donut: principal vs interest, driven 100% by real calc values ── */
export function DonutChart({
  principal,
  totalInterest,
  principalPct,
  interestPct,
}: {
  principal: number;
  totalInterest: number;
  principalPct: number;
  interestPct: number;
}) {
  const size = 230;
  const stroke = 30;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pFrac = Math.min(1, Math.max(0, principalPct / 100));

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={`Principal ${principalPct}% versus interest ${interestPct}%`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e1d3" strokeWidth={stroke} />
          {/* interest arc (amber) as base ring segment */}
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="#d99a1f" strokeWidth={stroke}
            strokeDasharray={`${c} 0`}
            strokeLinecap="butt"
            style={{ transition: "stroke-dasharray .7s ease, stroke-dashoffset .7s ease" }}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
          {/* principal arc (emerald) overlaid */}
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="#0e7c5b" strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, pFrac * c - 2)} ${c}`}
            strokeLinecap="butt"
            style={{ transition: "stroke-dasharray .7s ease" }}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6b6353]">Interest share</span>
          <span className="mono num text-3xl font-bold text-[#0b1f3a]">{interestPct.toFixed(1)}%</span>
          <span className="mono num mt-1 text-xs text-[#6b6353]">{formatINR0(totalInterest)} interest</span>
        </div>
      </div>
      <div className="mt-4 grid w-full grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border border-[#e2dccb] bg-white/70 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm bg-[#0e7c5b]" aria-hidden />
            <span className="font-semibold text-[#0b1f3a]">Principal</span>
          </div>
          <div className="mono num mt-1 text-[13px] font-bold text-[#0b1f3a]">{formatINR(principal)}</div>
          <div className="mono num text-xs text-[#6b6353]">{principalPct.toFixed(2)}%</div>
        </div>
        <div className="rounded-xl border border-[#e2dccb] bg-white/70 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm bg-[#d99a1f]" aria-hidden />
            <span className="font-semibold text-[#0b1f3a]">Interest</span>
          </div>
          <div className="mono num mt-1 text-[13px] font-bold text-[#0b1f3a]">{formatINR(totalInterest)}</div>
          <div className="mono num text-xs text-[#6b6353]">{interestPct.toFixed(2)}%</div>
        </div>
      </div>
    </div>
  );
}

/* ── Balance-over-time area chart from the REAL schedule rows ── */
export function BalanceChart({ rows, principal }: { rows: AmortRow[]; principal: number }) {
  const { pathLine, pathArea, xTicks, yMax } = useMemo(() => {
    const W = 640;
    const H = 230;
    const PAD_L = 8;
    const PAD_B = 26;
    const PAD_T = 12;
    const iw = W - PAD_L * 2;
    const ih = H - PAD_T - PAD_B;
    const n = rows.length;
    if (n === 0 || !(principal > 0)) {
      return { pathLine: "", pathArea: "", xTicks: [] as { x: number; label: string }[], yMax: 0 };
    }
    const step = Math.max(1, Math.ceil(n / 140));
    const pts: { m: number; bal: number }[] = [{ m: 0, bal: principal }];
    for (let i = step - 1; i < n; i += step) pts.push({ m: rows[i].period, bal: rows[i].balance });
    if (pts[pts.length - 1].m !== n) pts.push({ m: n, bal: rows[n - 1].balance });
    const yMax = principal;
    const X = (m: number) => PAD_L + (m / n) * iw;
    const Y = (b: number) => PAD_T + (1 - b / yMax) * ih;
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.m).toFixed(1)},${Y(p.bal).toFixed(1)}`).join(" ");
    const area = `${line} L${X(n).toFixed(1)},${(PAD_T + ih).toFixed(1)} L${X(0).toFixed(1)},${(PAD_T + ih).toFixed(1)} Z`;
    const years = Math.ceil(n / 12);
    const tickYears = years <= 6 ? Array.from({ length: years + 1 }, (_, i) => i)
      : [0, Math.round(years / 2), years];
    const xTicks = tickYears.map((y) => ({ x: X(Math.min(n, y * 12)), label: y === 0 ? "Now" : `Yr ${y}` }));
    return { pathLine: line, pathArea: area, xTicks, yMax };
  }, [rows, principal]);

  if (!pathLine) {
    return <div className="rounded-xl bg-[#efeadd] p-6 text-center text-sm text-[#6b6353]">Chart appears after calculation.</div>;
  }

  return (
    <figure className="w-full">
      <svg viewBox="0 0 640 230" className="w-full" role="img" aria-label="Outstanding loan balance over time">
        <defs>
          <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0e7c5b" stopOpacity="0.35" />
            <stop offset="1" stopColor="#0e7c5b" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line x1="8" x2="632" y1={12 + (1 - f) * 192} y2={12 + (1 - f) * 192} stroke="#ddd6c2" strokeDasharray="4 5" strokeWidth="1" />
            <text x="632" y={12 + (1 - f) * 192 - 4} textAnchor="end" fontSize="11" fill="#8a8271" className="mono">
              {compactINR(yMax * f)}
            </text>
          </g>
        ))}
        <path d={pathArea} fill="url(#balFill)" />
        <path d={pathLine} fill="none" stroke="#0e7c5b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {xTicks.map((t) => (
          <text key={t.label} x={t.x} y={222} textAnchor="middle" fontSize="11" fill="#8a8271" fontWeight="600">
            {t.label}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 text-center text-xs text-[#6b6353]">
        Outstanding balance (reducing-balance) from disbursal to full repayment.
      </figcaption>
    </figure>
  );
}

/* ── Per-year principal vs interest stacked bars (real yearly rows) ── */
export function YearlyBars({ yearly }: { yearly: YearlyRow[] }) {
  const shown = yearly.slice(0, 50);
  const max = Math.max(1, ...shown.map((y) => y.totalPayment));
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-4 text-xs font-semibold text-[#6b6353]">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0e7c5b]" /> Principal</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#d99a1f]" /> Interest</span>
      </div>
      <div className="sched-wrap max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
        {shown.map((y) => {
          const pW = Math.max(1.5, (y.principalPaid / max) * 100);
          const iW = Math.max(y.interestPaid > 0 ? 1.5 : 0, (y.interestPaid / max) * 100);
          return (
            <div key={y.year} className="flex items-center gap-2" title={`Year ${y.year}: principal ${formatINR(y.principalPaid)}, interest ${formatINR(y.interestPaid)}`}>
              <span className="mono num w-9 shrink-0 text-right text-[11px] font-bold text-[#6b6353]">Y{y.year}</span>
              <div className="flex h-5 min-w-0 flex-1 overflow-hidden rounded-md bg-[#ece7d9]">
                <div className="h-full bg-[#0e7c5b]" style={{ width: `${pW}%`, transition: "width .5s ease" }} />
                <div className="h-full bg-[#d99a1f]" style={{ width: `${iW}%`, transition: "width .5s ease" }} />
              </div>
              <span className="mono num hidden w-24 shrink-0 text-right text-[11px] text-[#6b6353] sm:block">
                {compactINR(y.totalPayment)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
