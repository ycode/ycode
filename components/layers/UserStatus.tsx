'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import Icon from '@/components/ui/icon';

import { cn } from '@/lib/utils';

interface UserStatusProps {
  className?: string;
  style?: React.CSSProperties;
  loginUrl?: string;
  profileLinks?: Array<{ label: string; url: string }>;
  settings?: {
    labels?: {
      login?: string;
      logout?: string;
      profile?: string;
    };
    styling?: {
      showAvatar?: boolean;
      avatarSource?: 'supabase' | 'cms';
      backgroundColor?: string;
      textColor?: string;
      dropdownBackgroundColor?: string;
      dropdownTextColor?: string;
      glassmorphism?: boolean;
    };
  };
}

export default function UserStatus({ 
  className, 
  style, 
  loginUrl = '/login', 
  profileLinks = [],
  settings = {}
}: UserStatusProps) {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [labels, setLabels] = useState<any>({ login: 'Log in', logout: 'Log out', profile: 'My Profile' });
  const [loading, setLoading] = useState(true);

  const { labels: customLabels = {}, styling = {} } = settings;
  const { 
    showAvatar = true, 
    backgroundColor = 'transparent', 
    textColor = 'inherit',
    dropdownBackgroundColor = 'white',
    dropdownTextColor = 'inherit',
    glassmorphism = false
  } = styling;

  // Use try/catch to avoid 'app router not mounted' error in builder canvas
  let router: any = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch (e) {
    // Silently ignore
  }

  useEffect(() => {
    setMounted(true);
    async function checkUser() {
      try {
        const locale = document.documentElement.lang || 'en';
        const headers: Record<string, string> = {};
        
        // In preview mode, check for simulated user cookie
        if (typeof window !== 'undefined') {
          const previewUserId = document.cookie
            .split('; ')
            .find(row => row.startsWith('ycode_preview_user_id='))
            ?.split('=')[1];
            
          if (previewUserId) {
            headers['x-ycode-preview-user-id'] = previewUserId;
          }
        }

        const response = await fetch(`/api/auth/me?locale=${locale}`, { headers });
        const data = await response.json();
        setUser(data.user);
        if (data.labels) setLabels(data.labels);
      } catch (error) {
        console.error('Failed to fetch user session:', error);
      } finally {
        setLoading(false);
      }
    }
    checkUser();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      if (router) {
        router.refresh();
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading || !mounted) {
    return <div className={className} style={style}><Spinner className="h-4 w-4" /></div>;
  }

  const effectiveLabels = {
    login: customLabels.login || labels.login,
    logout: customLabels.logout || labels.logout,
    profile: customLabels.profile || labels.profile,
  };

  const containerStyle: React.CSSProperties = {
    ...style,
    backgroundColor,
    color: textColor,
    backdropFilter: glassmorphism ? 'blur(8px)' : undefined,
    WebkitBackdropFilter: glassmorphism ? 'blur(8px)' : undefined,
  };

  if (!user) {
    return (
      <Link
        href={loginUrl} className={cn('inline-flex items-center transition-opacity hover:opacity-80 rounded-md', className)}
        style={containerStyle}
      >
        <Button
          variant="outline" size="sm"
          className="bg-transparent text-inherit border-current"
        >
          {effectiveLabels.login}
        </Button>
      </Link>
    );
  }

  const avatarUrl = user.cms_profile?.avatar || user.user_metadata?.avatar_url;
  const displayName = user.cms_profile?.name || user.user_metadata?.full_name || user.email;

  return (
    <div className={className} style={containerStyle}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 outline-none group">
            {showAvatar ? (
              <Avatar className="h-8 w-8 border shadow-sm transition-transform group-hover:scale-105">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {displayName?.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : (
              <span className="text-sm font-medium">{displayName}</span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="end" 
          className="w-56"
          style={{ 
            backgroundColor: dropdownBackgroundColor, 
            color: dropdownTextColor,
            backdropFilter: glassmorphism ? 'blur(12px)' : undefined,
            WebkitBackdropFilter: glassmorphism ? 'blur(12px)' : undefined,
          }}
        >
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none opacity-70">
                {user.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="opacity-20" />
          
          {profileLinks.map((link, i) => (
            <DropdownMenuItem
              key={i} asChild
              className="cursor-pointer"
            >
              <Link href={link.url}>{link.label || effectiveLabels.profile}</Link>
            </DropdownMenuItem>
          ))}
          
          {profileLinks.length > 0 && <DropdownMenuSeparator className="opacity-20" />}
          
          <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600 focus:text-red-600">
            <Icon name="logout" className="mr-2 h-4 w-4" />
            <span>{effectiveLabels.logout}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
