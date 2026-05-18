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

interface UserStatusProps {
  className?: string;
  style?: React.CSSProperties;
  loginUrl?: string;
  profileLinks?: Array<{ label: string; url: string }>;
}

export default function UserStatus({ className, style, loginUrl = '/login', profileLinks = [] }: UserStatusProps) {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [labels, setLabels] = useState<any>({ login: 'Log in', logout: 'Log out', profile: 'My Profile' });
  const [loading, setLoading] = useState(true);

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
        const response = await fetch(`/api/auth/me?locale=${locale}`);
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

  if (!user) {
    return (
      <Link
        href={loginUrl} className={className}
        style={style}
      >
        <Button variant="outline" size="sm">{labels.login}</Button>
      </Link>
    );
  }

  const avatarUrl = user.cms_profile?.avatar || user.user_metadata?.avatar_url;
  const displayName = user.cms_profile?.name || user.user_metadata?.full_name || user.email;

  return (
    <div className={className} style={style}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 outline-none">
            <Avatar className="h-8 w-8 border">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {displayName?.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {profileLinks.map((link, i) => (
            <DropdownMenuItem key={i} asChild>
              <Link href={link.url}>{link.label}</Link>
            </DropdownMenuItem>
          ))}
          
          {profileLinks.length > 0 && <DropdownMenuSeparator />}
          
          <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
            <Icon name="logout" className="mr-2 h-4 w-4" />
            <span>{labels.logout}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
