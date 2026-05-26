'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { collectionsApi } from '@/lib/api';
import { USERS_COLLECTION_ID } from '@/lib/auth-constants';
import type { CollectionField } from '@/types';
import { Spinner } from '@/components/ui/spinner';

interface AuthFormProps {
  type: 'login' | 'register';
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  layerId: string;
  redirectUrl?: string;
}

export default function AuthForm({ type, children, className, style, layerId, redirectUrl: customRedirect }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectUrl = customRedirect || searchParams.get('redirect') || '/';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    
    // We need to handle both named inputs and CMS-mapped inputs
    // The register API expects { email, password, full_name, ...customData }
    const payload: Record<string, any> = {};
    
    formData.forEach((value, key) => {
      payload[key] = value;
    });

    try {
      const locale = document.documentElement.lang || 'en';
      const endpoint = type === 'login' ? `/api/auth/login?locale=${locale}` : `/api/auth/register?locale=${locale}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || 'Authentication failed');
      } else {
        toast.success(type === 'login' ? 'Logged in successfully' : 'Registration successful');
        // Small delay for cookie to propagate
        setTimeout(() => {
          router.push(redirectUrl);
          router.refresh();
        }, 500);
      }
    } catch (error) {
      toast.error('An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form 
      onSubmit={handleSubmit} 
      className={className} 
      style={style}
      data-layer-id={layerId}
    >
      {children}

      {isSubmitting && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-md z-50">
          <Spinner />
        </div>
      )}
    </form>
  );
}
