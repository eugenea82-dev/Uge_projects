import { useEffect, useState } from 'react'
import { AppIcon } from '../ui/Icon.tsx'

const STEPS = [
  'Connecting to EMMS…',
  'Loading asset register…',
  'Rebuilding failure events from status log…',
  'Calculating A-R-M KPIs (rolling 13 weeks)…',
  'Scoring failure risk…',
  'Ready',
]

export function Splash({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const total = 2600
    let raf = 0
    let timer = 0
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / total)
      setP(t)
      if (t < 1) raf = requestAnimationFrame(tick)
      else timer = window.setTimeout(onDone, 250)
    }
    raf = requestAnimationFrame(tick)
    const skip = (e: KeyboardEvent) => e.key === 'Enter' && onDone()
    window.addEventListener('keydown', skip)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      window.removeEventListener('keydown', skip)
    }
  }, [onDone])

  const eased = 1 - (1 - p) ** 2.2
  const step = STEPS[Math.min(STEPS.length - 1, Math.floor(p * STEPS.length))]

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center select-none cursor-default"
      style={{ background: 'radial-gradient(900px 600px at 50% 40%, #4a0a2e 0%, #0b0509 70%)' }}
      onClick={onDone}
      role="status"
      aria-label="Loading CHE Maintenance System"
    >
      <div className="animate-in flex flex-col items-center">
        <div style={{ filter: 'drop-shadow(0 18px 40px rgba(229, 0, 126, 0.45))' }}>
          <AppIcon size={112} />
        </div>
        <h1 className="mt-6 text-[30px] font-semibold tracking-tight text-white">
          CHE Maintenance <span className="font-light text-white/70">System</span>
        </h1>
        <p className="mt-1 text-[13px] text-white/55">AI-powered predictive maintenance &amp; monitoring for cargo-handling equipment</p>
        <div className="mt-10 w-[220px] h-[5px] rounded-full bg-white/15 overflow-hidden">
          <div className="h-full rounded-full bg-white/90" style={{ width: `${eased * 100}%` }} />
        </div>
        <p className="mt-3 h-4 text-[11.5px] text-white/45 tnum">{step}</p>
      </div>
      <div className="absolute bottom-6 text-center text-[11px] text-white/35 leading-relaxed">
        2GO Freight · Land-Based Equipment
        <br />
        Version 0.2 · Release 1 pilot prototype · simulated data
      </div>
    </div>
  )
}
