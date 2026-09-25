'use client';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="error-screen">
      <h1>Studio error</h1>
      <p>The last operation could not be rendered.</p>
      <button className="button button-primary" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
