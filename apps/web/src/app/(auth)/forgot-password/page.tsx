'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useForgotPassword } from '@/lib/queries-v3';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Schema = z.object({ email: z.string().email() });
type FormData = z.infer<typeof Schema>;

export default function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [submitted, setSubmitted] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(Schema) });

  const onSubmit = (data: FormData) => {
    forgot.mutate(data.email, {
      onSuccess: (r) => {
        setSubmitted(true);
        if (r.devToken) setDevToken(r.devToken);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <Card className="animate-slide-in">
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          {submitted
            ? 'Check your account for the reset link (we send it via Telegram if connected).'
            : 'Enter your email and we will send you a reset link.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!submitted ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={forgot.isPending}>
              {forgot.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              If an account exists with that email, you will receive a reset link.
            </p>
            {devToken && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="font-semibold mb-1">Dev mode link:</p>
                <Link href={`/reset-password?token=${devToken}`} className="text-primary break-all hover:underline">
                  /reset-password?token={devToken.slice(0, 16)}...
                </Link>
              </div>
            )}
          </div>
        )}
        <p className="text-center text-sm text-muted-foreground mt-6">
          <Link href="/login" className="text-primary font-medium hover:underline">
            ← Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
