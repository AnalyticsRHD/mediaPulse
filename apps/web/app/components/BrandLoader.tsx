'use client';

type BrandLoaderProps = {
  label?: string;
  special?: boolean;
};

export function BrandLoader({ label = 'Cargando', special = false }: BrandLoaderProps) {
  return (
    <div
      className={`brand-loader-overlay${special ? ' brand-loader-overlay-special' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {special ? (
        <img
          className="special-loader-gif"
          src="https://media1.tenor.com/m/bkJxYJ_AvxcAAAAd/jesus-dancing.gif"
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
