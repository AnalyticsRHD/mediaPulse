type BrandLoaderProps = {
  label?: string;
};

export function BrandLoader({ label = 'Cargando' }: BrandLoaderProps) {
  return (
    <div className="brand-loader-overlay" role="status" aria-live="polite" aria-label={label}>
      <img
        className="brand-loader-logo"
        src="/assets/rhd-no-bg.png"
        alt=""
        aria-hidden="true"
      />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
