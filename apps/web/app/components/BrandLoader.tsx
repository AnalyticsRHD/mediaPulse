'use client';

type BrandLoaderProps = {
  label?: string;
  special?: boolean;
  specialSrc?: string;
};

const DEFAULT_SPECIAL_LOADER_SRC = 'https://media1.tenor.com/m/bkJxYJ_AvxcAAAAd/jesus-dancing.gif';
const FRANCO_SPECIAL_LOADER_SRC = 'https://media.tenor.com/ECsezOJfFP0AAAAM/martin-palermo-boca.gif';

export function BrandLoader({
  label = 'Cargando',
  special = false,
  specialSrc = DEFAULT_SPECIAL_LOADER_SRC
}: BrandLoaderProps) {
  const isFrancoTheme = special && specialSrc === FRANCO_SPECIAL_LOADER_SRC;

  return (
    <div
      className={`brand-loader-overlay${special ? ' brand-loader-overlay-special' : ''}${isFrancoTheme ? ' brand-loader-overlay-franco' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {special ? (
        <img
          className={`special-loader-gif${isFrancoTheme ? ' special-loader-gif-franco' : ''}`}
          src={specialSrc}
          alt=""
          aria-hidden="true"
        />
      ) : (
        <img className="brand-loader-logo" src="/assets/rhd-no-bg.png" alt="" aria-hidden="true" />
      )}
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
