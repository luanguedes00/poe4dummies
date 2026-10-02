// Fita de cotações que gira sozinha (em loop) quando não cabe na tela.
// Para com o mouse em cima (para poder clicar) e a roda do mouse empurra para o
// lado. Com "reduzir movimento" do Windows ligado, não gira: só a roda mexe.

import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Pixels por segundo. */
const SPEED = 32

export function TickerTape({ children, itemsKey }: { children: ReactNode; itemsKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)

  // Só gira (e duplica a lista) quando a fita passa da largura disponível.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const group = el.querySelector<HTMLElement>('.ticker-group')
      setOverflow(!!group && group.offsetWidth > el.clientWidth + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [itemsKey])

  useEffect(() => {
    const el = ref.current
    if (!el || !overflow) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Largura medida uma vez e só atualizada quando muda (ler a cada quadro força recálculo de layout).
    const group = el.querySelector<HTMLElement>('.ticker-group')
    let w = group?.offsetWidth || 1
    const ro = new ResizeObserver(() => (w = group?.offsetWidth || 1))
    if (group) ro.observe(group)
    const wrap = (x: number) => ((x % w) + w) % w
    let pos = el.scrollLeft
    let paused = false
    let last = performance.now()
    let raf = 0
    const step = (now: number) => {
      const dt = Math.min(now - last, 100)
      last = now
      if (!paused && !reduce) {
        pos = wrap(pos + (dt * SPEED) / 1000)
        el.scrollLeft = pos
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      pos = wrap(pos + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY))
      el.scrollLeft = pos
    }
    const pause = () => (paused = true)
    const resume = () => {
      paused = false
      pos = el.scrollLeft
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mouseenter', pause)
    el.addEventListener('mouseleave', resume)
    el.addEventListener('focusin', pause)
    el.addEventListener('focusout', resume)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mouseenter', pause)
      el.removeEventListener('mouseleave', resume)
      el.removeEventListener('focusin', pause)
      el.removeEventListener('focusout', resume)
    }
  }, [overflow, itemsKey])

  return (
    <div ref={ref} className={`ticker ${overflow ? 'moving' : ''}`}>
      <div className="ticker-group">{children}</div>
      {/* Segunda cópia para o loop não ter emenda; fora da leitura de tela e do Tab. */}
      {overflow && (
        <div className="ticker-group" aria-hidden="true" inert>
          {children}
        </div>
      )}
    </div>
  )
}
