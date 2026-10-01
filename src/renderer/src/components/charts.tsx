import { useEffect, useRef, useState } from 'react'

export function Sparkline({ data, width = 96, height = 26 }: { data: readonly number[]; width?: number; height?: number }) {
  if (data.length < 2) return <span className="muted">–</span>
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 6)] as const)
  // Os pontos são variação acumulada desde 7 dias atrás: a cor segue o sinal do último.
  const up = data[data.length - 1]! >= 0
  const color = up ? 'var(--up)' : 'var(--down)'
  const line = pts.map((p) => p.join(',')).join(' ')
  const last = pts[pts.length - 1]!
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      <polygon points={`2,${height} ${line} ${width - 2},${height}`} fill={color} fillOpacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} />
    </svg>
  )
}

/** Escolhe marcas "redondas" para o eixo (1, 2, 2.5, 5 × 10^n). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)))
  return ticks
}

export interface ChartPoint {
  date: string
  price: number
  volume: number
  sma7: number | null
  sma20: number | null
}

/** Largura real do contêiner, para o gráfico não escalar letras junto com a janela. */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function PriceChart({ points, format, unit }: { points: readonly ChartPoint[]; format: (v: number) => string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const [boxRef, W] = useWidth<HTMLDivElement>(640)
  // Altura fixa em pixels reais: o gráfico só estica na horizontal.
  const H = 260
  const padL = 56
  const padR = 12
  const padT = 10
  const priceH = 170
  const volTop = 192
  const volH = 44

  const values = points.flatMap((p) => [p.price, p.sma7 ?? p.price, p.sma20 ?? p.price])
  const ticks = niceTicks(Math.min(...values) * 0.97, Math.max(...values) * 1.03)
  const lo = ticks[0]!
  const hi = ticks[ticks.length - 1]!
  const x = (i: number) => padL + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - padL - padR))
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * priceH
  const vmax = Math.max(...points.map((p) => p.volume), 1)
  const barW = Math.max(2, Math.min(14, ((W - padL - padR) / points.length) * 0.6))
  const path = (pick: (p: ChartPoint) => number | null) =>
    points
      .map((p, i) => {
        const v = pick(p)
        return v === null ? null : `${x(i)},${y(v)}`
      })
      .filter(Boolean)
      .join(' ')
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))
  const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  const hp = hover !== null ? points[hover] : undefined

  return (
    <div ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ display: 'block', maxWidth: '100%' }}
        role="img"
        aria-label={unit}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const i = Math.round(((px - padL) / (W - padL - padR)) * (points.length - 1))
          setHover(Math.max(0, Math.min(points.length - 1, i)))
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" fontFamily="var(--font-mono)">
              {format(tick)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const bh = (p.volume / vmax) * volH
          return <rect key={p.date} x={x(i) - barW / 2} y={volTop + volH - bh} width={barW} height={bh} fill={hover === i ? 'var(--muted)' : 'var(--line)'} />
        })}
        <polygon points={`${x(0)},${y(lo)} ${path((p) => p.price)} ${x(points.length - 1)},${y(lo)}`} fill="var(--gold)" fillOpacity={0.08} />
        <polyline points={path((p) => p.sma20)} fill="none" stroke="var(--suffix)" strokeWidth={1.4} strokeDasharray="4 3" />
        <polyline points={path((p) => p.sma7)} fill="none" stroke="var(--prefix)" strokeWidth={1.4} />
        <polyline points={path((p) => p.price)} fill="none" stroke="var(--gold)" strokeWidth={2} />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!.price)} r={3.5} fill="var(--gold)" />
        {hp && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={volTop + volH} stroke="var(--muted)" strokeDasharray="2 3" />
            <circle cx={x(hover)} cy={y(hp.price)} r={4} fill="var(--fg)" />
          </g>
        )}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={`d${p.date}`}
              x={x(i)}
              y={H - 4}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--muted)"
              fontFamily="var(--font-mono)"
            >
              {shortDate(p.date)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="chart-tip">{hp ? `${shortDate(hp.date)} · ${format(hp.price)} ${unit} · ${Math.round(hp.volume)} Div` : ' '}</div>
    </div>
  )
}
