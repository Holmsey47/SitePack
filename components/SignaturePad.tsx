import { Button } from '@/components/ui';
import { strokesToPngDataUrl, type SignaturePoint, type SignatureStroke } from '@/lib/signaturePng';
import { theme } from '@/lib/theme';
import { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

const WIDTH = 320;
const HEIGHT = 160;

function scaleStroke(stroke: SignatureStroke, width: number, height: number): SignatureStroke {
  return stroke.map((point) => ({
    x: (point.x / Math.max(width, 1)) * WIDTH,
    y: (point.y / Math.max(height, 1)) * HEIGHT,
  }));
}

/** Drawn signature. The PNG has no EXIF. */
export function SignaturePad({ onChange, disabled = false }: { onChange: (dataUrl: string | null) => void; disabled?: boolean }) {
  const [strokes, setStrokes] = useState<SignatureStroke[]>([]);
  const [active, setActive] = useState<SignaturePoint[]>([]);
  const strokesRef = useRef<SignatureStroke[]>([]);
  const disabledRef = useRef(disabled);
  const onChangeRef = useRef(onChange);
  disabledRef.current = disabled;
  const layout = useRef({ width: WIDTH, height: HEIGHT });
  onChangeRef.current = onChange;

  function publish(next: SignatureStroke[]) {
    strokesRef.current = next;
    setStrokes(next);
    const scaled = next.map((stroke) => scaleStroke(stroke, layout.current.width, layout.current.height));
    onChangeRef.current(next.length === 0 ? null : strokesToPngDataUrl(scaled, WIDTH, HEIGHT));
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: (event) => {
        setActive([{ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }]);
      },
      onPanResponderMove: (event) => {
        const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        setActive((current) => [...current, point]);
      },
      onPanResponderRelease: () => {
        setActive((current) => {
          if (current.length > 0) publish([...strokesRef.current, current]);
          return [];
        });
      },
    })
  ).current;

  const shown = active.length > 0 ? [...strokes, active] : strokes;

  return (
    <View style={{ gap: 8 }}>
      <View
        accessibilityLabel="Sign here"
        onLayout={(event) => {
          layout.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
        }}
        style={{
          minHeight: HEIGHT,
          height: HEIGHT,
          backgroundColor: '#F4F1EA',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.line,
          overflow: 'hidden',
          opacity: disabled ? 0.45 : 1,
        }}
        {...responder.panHandlers}>
        {shown.flat().map((point, index) => (
          <View
            key={`${index}-${point.x}-${point.y}`}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: point.x - 3,
              top: point.y - 3,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: '#111111',
            }}
          />
        ))}
      </View>
      <Button label="Clear signature" variant="secondary" minHeight={48} disabled={disabled} onPress={() => publish([])} />
    </View>
  );
}
