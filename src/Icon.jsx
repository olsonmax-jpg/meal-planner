import React from 'react'
import { ICONS } from './icons.js'
export default function Icon({ name, size = 24, color = 'currentColor' }) {
  const paths = ICONS[name] || []
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" fill={color} aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}
