import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#07090D',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            width: 26,
            height: 14,
            background: '#CFFF3D',
            borderRadius: 7,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: 3,
          }}
        >
          <div
            style={{
              width: 4,
              height: 4,
              background: '#07090D',
              borderRadius: '50%',
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
