import React, { useEffect, useRef } from 'react';

/**
 * Trading3DScene
 * Motor gráfico interactivo 3D basado en HTML5 Canvas y proyección matemática tridimensional.
 * Diseñado con estética institucional de alta frecuencia para WTN ALGO-TRADING (WTN Solutions LLC).
 * Presenta una matriz cuántica giratoria, ondas de liquidez con velas 3D y partículas en azul eléctrico/cian.
 */
export default function Trading3DScene({ className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Estado del mouse e inercia de rotación
    let mouseX = 0;
    let mouseY = 0;
    let targetRotX = 0.2;
    let targetRotY = 0;
    let currentRotX = 0.2;
    let currentRotY = 0;

    // Redimensionamiento adaptativo de alta definición
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      targetRotY = ((clientX / width) - 0.5) * 1.2;
      targetRotX = ((clientY / height) - 0.5) * -1.0;
    };

    window.addEventListener('mousemove', handleMouseMove);

    // 1. GENERACIÓN DE ESTRUCTURA 3D: NÚCLEO POLIÉDRICO CUÁNTICO (Icosaedro)
    const phi = (1 + Math.sqrt(5)) / 2;
    const baseVertices = [
      [-1,  phi,  0], [ 1,  phi,  0], [-1, -phi,  0], [ 1, -phi,  0],
      [ 0, -1,  phi], [ 0,  1,  phi], [ 0, -1, -phi], [ 0,  1, -phi],
      [ phi,  0, -1], [ phi,  0,  1], [-phi,  0, -1], [-phi,  0,  1]
    ];
    const polyScale = 110;
    const coreVertices = baseVertices.map(([x, y, z]) => ({
      x: x * polyScale,
      y: y * polyScale,
      z: z * polyScale
    }));

    // Conexiones de aristas del icosaedro
    const edges = [];
    for (let i = 0; i < coreVertices.length; i++) {
      for (let j = i + 1; j < coreVertices.length; j++) {
        const dx = baseVertices[i][0] - baseVertices[j][0];
        const dy = baseVertices[i][1] - baseVertices[j][1];
        const dz = baseVertices[i][2] - baseVertices[j][2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (Math.abs(dist - 2.0) < 0.2) {
          edges.push([i, j]);
        }
      }
    }

    // 2. GENERACIÓN DE ANILLOS ORBITALES Y NODOS FINANCIEROS (BTC, ETH, SOL, WTN)
    const cryptoTags = [
      { label: 'BTC/USDT', color: '#38bdf8' },
      { label: 'ETH/USDT', color: '#60a5fa' },
      { label: 'SOL/USDT', color: '#00f0ff' },
      { label: 'BNB/USDT', color: '#38bdf8' },
      { label: 'WTN-ALGO', color: '#00f0ff' },
      { label: 'RSI-DCA', color: '#10b981' }
    ];

    const orbitalNodes = [];
    const orbitCount = cryptoTags.length;
    for (let i = 0; i < orbitCount; i++) {
      const angle = (i / orbitCount) * Math.PI * 2;
      const radius = 220 + (i % 2) * 40;
      orbitalNodes.push({
        baseAngle: angle,
        radius,
        speed: 0.006 + (i % 3) * 0.002,
        yOffset: (Math.sin(i) * 50),
        tag: cryptoTags[i].label,
        color: cryptoTags[i].color
      });
    }

    // 3. GENERACIÓN DE ONDA DE VELAS 3D (Liquid Candlestick Wave)
    const candleCount = 20;
    const candles = [];
    for (let i = 0; i < candleCount; i++) {
      const u = (i / (candleCount - 1)) - 0.5;
      const x = u * 480;
      const isBull = Math.sin(i * 1.5) >= -0.2;
      const bodyHeight = 22 + Math.abs(Math.cos(i * 0.9)) * 35;
      const wickHeight = bodyHeight + 15 + Math.random() * 12;
      candles.push({
        x,
        baseZ: Math.sin(u * Math.PI) * 120,
        yBase: Math.cos(u * Math.PI * 2) * 45,
        isBull,
        bodyHeight,
        wickHeight,
        phase: i * 0.3
      });
    }

    // 4. CAMPO DE PARTÍCULAS CUÁNTICAS DE PROFUNDIDAD (Constelación Cósmica)
    const particleCount = 95;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 600,
        z: (Math.random() - 0.5) * 800,
        size: 1.2 + Math.random() * 2.2,
        speed: 0.3 + Math.random() * 0.7,
        alpha: 0.2 + Math.random() * 0.7
      });
    }

    // Parámetros de la cámara 3D
    const focalLength = 480;
    let globalAngleY = 0;
    let globalAngleX = 0;

    // Bucle principal de animación 60 FPS
    const render = () => {
      // Interpolación suave del ángulo de la cámara (Dampening lerp)
      currentRotX += (targetRotX - currentRotX) * 0.04;
      currentRotY += (targetRotY - currentRotY) * 0.04;

      globalAngleY += 0.0035;
      globalAngleX = Math.sin(globalAngleY * 0.5) * 0.15;

      const rotY = globalAngleY + currentRotY;
      const rotX = currentRotX + globalAngleX;

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      // Limpieza con desvanecimiento sutil para estela de luz (Motion Glow Trail)
      ctx.clearRect(0, 0, width, height);

      const centerX = width * 0.5;
      const centerY = height * 0.5;

      // Función auxiliar de proyección 3D -> 2D
      const project = (x, y, z) => {
        // Rotación en Y
        const x1 = x * cosY - z * sinY;
        const z1 = z * cosY + x * sinY;
        // Rotación en X
        const y2 = y * cosX - z1 * sinX;
        const z2 = z1 * cosX + y * sinX;

        const depth = z2 + focalLength;
        if (depth < 10) return null;

        const scale = focalLength / depth;
        return {
          x: centerX + x1 * scale,
          y: centerY + y2 * scale,
          scale,
          z: z2
        };
      };

      // A. DIBUJAR CAMPO DE PARTÍCULAS DE FONDO
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.z -= p.speed;
        if (p.z < -400) p.z = 400;

        const proj = project(p.x, p.y, p.z);
        if (proj) {
          const sz = p.size * proj.scale;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, Math.max(0.6, sz), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(56, 189, 248, ${Math.min(1, p.alpha * proj.scale * 1.5)})`;
          ctx.fill();
        }
      }

      // B. DIBUJAR ONDA DE VELAS 3D (Liquid Candlesticks)
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const dynamicY = c.yBase + Math.sin(globalAngleY * 2 + c.phase) * 15 + 130;
        const proj = project(c.x, dynamicY, c.baseZ);
        if (proj) {
          const bodyW = 7 * proj.scale;
          const bodyH = c.bodyHeight * proj.scale;
          const wickH = c.wickHeight * proj.scale;

          const strokeColor = c.isBull ? '#00f0ff' : '#2563eb';
          const fillColor = c.isBull ? 'rgba(0, 240, 255, 0.45)' : 'rgba(37, 99, 235, 0.35)';

          // Mecha
          ctx.beginPath();
          ctx.moveTo(proj.x, proj.y - wickH * 0.5);
          ctx.lineTo(proj.x, proj.y + wickH * 0.5);
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(1, 1.2 * proj.scale);
          ctx.stroke();

          // Cuerpo de la vela
          ctx.beginPath();
          ctx.rect(proj.x - bodyW * 0.5, proj.y - bodyH * 0.5, bodyW, bodyH);
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(1, 1.5 * proj.scale);
          ctx.stroke();
        }
      }

      // C. DIBUJAR NÚCLEO POLIÉDRICO CUÁNTICO (Icosaedro y Aristas)
      const projectedCore = coreVertices.map((v) => project(v.x, v.y, v.z));

      // Líneas de conexión del núcleo con resplandor
      ctx.beginPath();
      edges.forEach(([i, j]) => {
        const p1 = projectedCore[i];
        const p2 = projectedCore[j];
        if (p1 && p2) {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
      });
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Vértices del núcleo
      projectedCore.forEach((p) => {
        if (!p) return;
        const r = Math.max(1.8, 3.5 * p.scale);
        // Halo de resplandor
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.fill();

        // Punto sólido brillante
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#f0f9ff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0; // reset
      });

      // D. DIBUJAR ANILLOS ORBITALES Y NODOS FINANCIEROS FLOTANTES
      orbitalNodes.forEach((node, idx) => {
        const curAngle = node.baseAngle + globalAngleY * (node.speed * 200);
        const nx = Math.cos(curAngle) * node.radius;
        const nz = Math.sin(curAngle) * node.radius;
        const ny = node.yOffset + Math.sin(globalAngleY * 3 + idx) * 25;

        const proj = project(nx, ny, nz);
        if (proj) {
          // Línea de rayo hacia el centro
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(proj.x, proj.y);
          ctx.strokeStyle = `rgba(37, 99, 235, ${0.12 * proj.scale})`;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Nodo orbital
          const r = Math.max(2.5, 4.8 * proj.scale);
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, r * 1.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(proj.x, proj.y, r, 0, Math.PI * 2);
          ctx.fillStyle = node.color;
          ctx.shadowColor = node.color;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;

          // Etiqueta flotante
          if (proj.scale > 0.8) {
            ctx.font = `600 ${Math.round(10 * proj.scale)}px "JetBrains Mono", monospace`;
            ctx.fillStyle = '#e0f2fe';
            ctx.textAlign = 'center';
            ctx.fillText(node.tag, proj.x, proj.y - 12 * proj.scale);
          }
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div className={`relative w-full h-full overflow-hidden pointer-events-none ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: '100%', height: '100%' }}
      />
      {/* Viñeta de degradado atmosférico radial */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.08) 0%, rgba(2, 6, 23, 0.4) 60%, rgba(2, 6, 23, 0.95) 100%)'
        }}
      />
    </div>
  );
}
