'use client';

import React from 'react';
import { AUTH_PROVIDERS } from '@/lib/auth-providers';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

interface SocialLoginProps {
  provider: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function SocialLogin({ provider, className, style }: SocialLoginProps) {
  const config = AUTH_PROVIDERS[provider];
  
  if (!config) {
    return <div className="text-xs text-red-500">Unknown provider: {provider}</div>;
  }

  const handleLogin = async () => {
    try {
      const configResponse = await fetch('/ycode/api/config');
      const { projectUrl, anonKey } = await configResponse.json();
      
      const { createBrowserClient } = await import('@supabase/ssr');
      const supabase = createBrowserClient(projectUrl, anonKey);
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: config.id as any,
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });

      if (error) throw error;
    } catch (error) {
      console.error(`Social login error (${config.name}):`, error);
    }
  };

  const { styling } = config;

  return (
    <button
      onClick={handleLogin}
      className={cn(
        'flex items-center justify-center transition-colors duration-200 border',
        className
      )}
      style={{
        ...style,
        backgroundColor: styling.backgroundColor,
        color: styling.textColor,
        borderColor: styling.borderColor,
        borderRadius: styling.borderRadius,
        fontSize: styling.fontSize,
        fontWeight: styling.fontWeight,
        gap: styling.gap,
        padding: styling.padding,
        height: '40px',
        width: '100%',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = styling.hoverBackgroundColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = styling.backgroundColor;
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.backgroundColor = styling.activeBackgroundColor;
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.backgroundColor = styling.hoverBackgroundColor;
      }}
    >
      <Icon name={config.iconName as any} className="size-[18px]" />
      <span>{config.buttonText}</span>
    </button>
  );
}
