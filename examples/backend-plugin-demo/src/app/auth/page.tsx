'use client';

import { useRouter } from 'next/navigation';

import { AuthFrame } from '@/features/kortix-auth-shell/AuthShell';
import { EmailAuthForm } from '@/features/kortix-auth-shell/EmailAuthForm';
import { sendCode, verifyCode } from './actions';

export default function AuthPage() {
  const router = useRouter();

  return (
    <AuthFrame>
      <EmailAuthForm
        magicLinkEnabled
        passwordEnabled={false}
        onSendCode={sendCode}
        onVerifyCode={verifyCode}
        onAuthenticated={() => {
          // verifyCode already established the real session cookie via
          // signIn() -- just move on to the protected area.
          router.push('/dashboard');
        }}
      />
    </AuthFrame>
  );
}
