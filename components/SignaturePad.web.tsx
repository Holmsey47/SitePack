import { Button } from '@/components/ui';
import { theme } from '@/lib/theme';
import { createElement, useEffect, useRef } from 'react';
import { View } from 'react-native';

type CanvasEl = {
  width: number;
  height: number;
  getContext: (kind: '2d') => {
    strokeStyle: string;
    lineWidth: number;
    lineCap: string;
    beginPath: () => void;
    moveTo: (x: number, y: number) => void;
    lineTo: (x: number, y: number) => void;
    stroke: () => void;
    clearRect: (x: number, y: number, w: number, h: number) => void;
  } | null;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  toDataURL: (type: string) => string;
  setPointerCapture: (id: number) => void;
};

/** Browser signature. Canvas export is a PNG with no EXIF GPS. */
export function SignaturePad({ onChange, disabled = false }: { onChange: (dataUrl: string | null) => void; disabled?: boolean }) {
  const canvasRef = useRef<CanvasEl | null>(null);
  const drawing = useRef(false);
  const moved = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.strokeStyle = '#111111';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  function point(event: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * canvas.width,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * canvas.height,
    };
  }

  function publish() {
    const canvas = canvasRef.current;
    onChange(moved.current && canvas ? canvas.toDataURL('image/png') : null);
  }

  return (
    <View style={{ gap: 8 }}>
      {createElement('canvas', {
        ref: canvasRef,
        width: 640,
        height: 280,
        'aria-label': 'Sign here',
        style: {
          width: '100%',
          height: 180,
          background: '#F4F1EA',
          borderRadius: 12,
          touchAction: 'none',
          border: `1px solid ${theme.line}`,
          opacity: disabled ? 0.45 : 1,
          pointerEvents: disabled ? 'none' : 'auto',
        },
        onPointerDown: (event: { clientX: number; clientY: number; pointerId: number }) => {
          if (disabled) return;
          const canvas = canvasRef.current;
          const context = canvas?.getContext('2d');
          if (!canvas || !context) return;
          drawing.current = true;
          moved.current = true;
          canvas.setPointerCapture(event.pointerId);
          const at = point(event);
          context.beginPath();
          context.moveTo(at.x, at.y);
        },
        onPointerMove: (event: { clientX: number; clientY: number }) => {
          if (!drawing.current) return;
          const context = canvasRef.current?.getContext('2d');
          if (!context) return;
          const at = point(event);
          context.lineTo(at.x, at.y);
          context.stroke();
        },
        onPointerUp: () => {
          drawing.current = false;
          publish();
        },
      })}
      <Button
        label="Clear signature"
        variant="secondary"
        minHeight={48}
        disabled={disabled}
        onPress={() => {
          const canvas = canvasRef.current;
          const context = canvas?.getContext('2d');
          if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
          moved.current = false;
          onChange(null);
        }}
      />
    </View>
  );
}
