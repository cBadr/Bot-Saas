'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useResetPassword } from '@/lib/queries-v3';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Schema = z.object({
  newPassword: z.string().min(8, 'At least 8 characters'),
  confirm: z.string().min(8),
}).refine((d) => d.newPassword === d.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
});
type FormData = z.infer<typeof Schema>;

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const reset = useResetPassword();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(Schema) });

  useEffect(() => {
    const t = search.get('token');
    if (t) setToken(t);
  }, [search]);

  const onSubmit = (data: FormData) => {
    if (!token) return toast.error('Missing reset token');
    reset.mutate({ token, newPassword: data.newPassword }, {
      onSuccess: () => {
        toast.success('Password reset! Please sign in.');
        router.push('/login');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  if (!token) {
    return (
      <Card className="animate-slide-in">
        <CardHeader>
          <CardTitle>Invalid link</CardTitle>
          <CardDescription>This reset link is missing the token.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/forgot-password" className="text-primary hover:underline text-sm">
            Request a new reset link →
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-slide-in">
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>Choose a strong password (at least 8 characters).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" type="password" {...register('newPassword')} />
            {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" {...register('confirm')} />
            {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={reset.isPending}>
            {reset.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Reset password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
