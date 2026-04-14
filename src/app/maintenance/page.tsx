import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Maintenance — FitWhite Aesthetics',
  description: 'FitWhite Aesthetics POS is temporarily under maintenance.',
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #fdf8f5 0%, #fef3ee 50%, #fdf8f5 100%)',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          background: 'linear-gradient(135deg, #c9825a 0%, #a5633e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          boxShadow: '0 4px 24px rgba(169, 95, 54, 0.25)',
        }}
      >
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 22, letterSpacing: -0.5 }}>FW</span>
      </div>

      {/* Heading */}
      <h1
        style={{
          fontSize: '1.75rem',
          fontWeight: 700,
          color: '#3d2014',
          marginBottom: '0.75rem',
          letterSpacing: '-0.02em',
        }}
      >
        System Maintenance
      </h1>

      {/* Sub-text */}
      <p
        style={{
          fontSize: '1rem',
          color: '#7c5038',
          maxWidth: 400,
          lineHeight: 1.7,
          marginBottom: '2rem',
        }}
      >
        FitWhite Aesthetics is undergoing scheduled maintenance to
        improve your experience. We&apos;ll be back shortly.
      </p>

      {/* Decorative divider */}
      <div
        style={{
          width: 48,
          height: 3,
          borderRadius: 4,
          background: 'linear-gradient(90deg, #c9825a, #a5633e)',
          marginBottom: '1.5rem',
        }}
      />

      {/* Footer note */}
      <p style={{ fontSize: '0.8rem', color: '#b08060' }}>
        Thank you for your patience.
      </p>
    </div>
  );
}
