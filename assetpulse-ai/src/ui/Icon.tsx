// SF Symbols–style line icons (24×24, 1.8 stroke).

const PATHS: Record<string, string> = {
  check: 'M5 12.5l4.2 4.2L19 7',
  stop: 'M8.5 3.5h7l5 5v7l-5 5h-7l-5-5v-7z M12 8v5 M12 16.2v.1',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5L21 13l-1.5.2-7.8 7.8a2.1 2.1 0 0 1-3-3l7.8-7.8L16.7 9 14.7 6.3z M14.7 6.3L17.5 3.5',
  box: 'M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z M3.5 7.5L12 12l8.5-4.5 M12 12v9',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M15.5 15.5L20.5 20.5',
  doc: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
  gauge: 'M4 16a8 8 0 1 1 16 0 M12 16l4-5 M12 16h.01',
  archive: 'M3.5 5h17v4h-17z M5 9v10h14V9 M10 13h4',
  shield: 'M12 3l7.5 3v6c0 4.5-3.2 7.6-7.5 9-4.3-1.4-7.5-4.5-7.5-9V6z M8.5 12l2.5 2.5 4.5-5',
  alert: 'M12 3.5L21.5 20h-19z M12 10v4.5 M12 17.3v.1',
  bolt: 'M13 2.5L4.5 13.5H11L10 21.5l8.5-11H12z',
  home: 'M3.5 11L12 4l8.5 7 M6 9.5V20h12V9.5',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  pencil: 'M4 20l4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20z M14 7l3 3',
  flask: 'M9.5 3h5 M10.5 3v6L5 19a1.4 1.4 0 0 0 1.2 2h11.6a1.4 1.4 0 0 0 1.2-2l-5.5-10V3 M7.5 15h9',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20.5a2 2 0 0 0 4 0',
  chart: 'M4 20V4 M4 20h16 M8 16v-5 M12 16V8 M16 16v-3',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  stack: 'M4 15h16 M4 10h16 M4 5h16 M4 20h16',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  sliders: 'M4 7h10 M18 7h2 M16 5v4 M4 17h4 M12 17h8 M10 15v4',
  sync: 'M20 11a8 8 0 0 0-14.3-4.6L4 8 M4 13a8 8 0 0 0 14.3 4.6L20 16 M4 4v4h4 M20 20v-4h-4',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20.5a7.5 7.5 0 0 1 15 0',
  lock: 'M6 11h12v9.5H6z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  logout: 'M14 4h5v16h-5 M10 8l-4 4 4 4 M6 12h10',
  download: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 20h14',
  printer: 'M7 9V4h10v5 M5 9h14v7h-3 M8 16H5V9 M8 13h8v7H8z',
  x: 'M6 6l12 12 M18 6L6 18',
  minus: 'M6 12h12',
  plus: 'M12 6v12 M6 12h12',
  expand: 'M8 4H4v4 M16 4h4v4 M8 20H4v-4 M16 20h4v-4',
  chevronRight: 'M9.5 6l6 6-6 6',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 7.8v.1',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01',
  building: 'M5 21V5l7-2v18 M12 8h7v13 M8 8h.01 M8 12h.01 M8 16h.01 M15 12h.01 M15 16h.01 M3 21h18',
  calendar: 'M4.5 6h15v14h-15z M4.5 10h15 M8.5 3.5v4 M15.5 3.5v4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 18h2v2h-2z M14 18h2 M18 14h2',
  truck: 'M3 6h11v10H3z M14 10h4l3 3v3h-7 M7 18.5a1.5 1.5 0 1 0 0-.01 M17 18.5a1.5 1.5 0 1 0 0-.01',
  key: 'M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M11 11h10 M18 11v3 M21 11v2',
}

export function Icon({ name, size = 16, className = '', strokeWidth = 1.8, title }: { name: string; size?: number; className?: string; strokeWidth?: number; title?: string }) {
  const d = PATHS[name] ?? PATHS.info
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {d.split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  )
}

/** App icon: a squircle with a pulse line over a reach-stacker silhouette hint. */
export function AppIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
      <defs>
        <linearGradient id="ap-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e6bff" />
          <stop offset="0.55" stopColor="#4b3fd6" />
          <stop offset="1" stopColor="#0a1a4a" />
        </linearGradient>
        <linearGradient id="ap-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7cf7c4" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#ap-bg)" />
      <rect x="4" y="4" width="120" height="120" rx="28" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
      <path d="M24 92h80" stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeLinecap="round" />
      <path d="M34 92V66h22l10 14v12" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" strokeLinejoin="round" />
      <path d="M56 66l30-28h10" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M18 64h18l7-16 11 34 9-24 6 10h41"
        fill="none"
        stroke="url(#ap-line)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
