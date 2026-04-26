import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-background to-accent/30">
      <Link href="/" className="flex items-center gap-2 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
          🐋
        </div>
        <span className="text-2xl font-bold">Orca</span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
