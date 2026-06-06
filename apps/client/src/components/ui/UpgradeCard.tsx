import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { UpgradeOption } from '@game/shared'
import * as THREE from 'three'

interface UpgradeCardProps {
  option: UpgradeOption
  position: [number, number, number]
  onSelect: (id: string) => void
}

const TYPE_COLORS = {
  weapon: '#4a9eff',
  passive: '#44cc88',
  evolution: '#ffcc00',
}

export function UpgradeCard({ option, position, onSelect }: UpgradeCardProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const tiltY = useRef(0)

  useFrame((_, delta) => {
    if (meshRef.current) {
      const targetTilt = hovered ? 0.3 : 0
      // Smooth lerp for hover tilt
      tiltY.current += (targetTilt - tiltY.current) * 10 * delta
      meshRef.current.rotation.y = tiltY.current
    }
  })

  const borderCol = TYPE_COLORS[option.kind] || '#ffffff'

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={() => onSelect(option.id)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[1.6, 2.4, 0.05]} />
        <meshStandardMaterial
          color={hovered ? '#ffffff' : '#1a1a2e'}
          roughness={0.3}
          metalness={0.1}
        />

        {/* Card header banner indicating type */}
        <mesh position={[0, 1.05, 0.03]}>
          <planeGeometry args={[1.6, 0.3]} />
          <meshBasicMaterial color={borderCol} />
        </mesh>

        {/* UI text rendered as Drei Html overlay to bypass SDF font mapping overhead */}
        <Html
          position={[0, 0, 0.04]}
          center
          distanceFactor={3}
          style={{
            width: '180px',
            textAlign: 'center',
            color: hovered ? '#1a1a2e' : '#f0f0f5',
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              fontSize: '16px',
              fontWeight: 'bold',
              marginBottom: '8px',
              textShadow: hovered ? 'none' : '0 2px 4px rgba(0,0,0,0.5)',
            }}
          >
            {option.displayName}
          </div>
          <div
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              backgroundColor: borderCol,
              color: option.kind === 'evolution' ? '#1a1a2e' : '#ffffff',
            }}
          >
            {option.kind}
          </div>
        </Html>
      </mesh>
    </group>
  )
}
