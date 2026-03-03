'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const INTEGRATIONS_ITEMS = [
  { id: 'apps', label: 'Apps', path: '/ycode/integrations/apps' },
  { id: 'webhooks', label: 'Webhooks', path: '/ycode/integrations/webhooks' },
  { id: 'api', label: 'API', path: '/ycode/integrations/api' },
  { id: 'mcp', label: 'MCP', path: '/ycode/integrations/mcp' },
];

interface IntegrationsContentProps {
  children: React.ReactNode;
}

export default function IntegrationsContent({ children }: IntegrationsContentProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-60 border-r flex flex-col px-4">
        <header className="py-5 flex justify-between">
          <span className="font-medium">Integrations</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0">
            {INTEGRATIONS_ITEMS.map((item) => {
              const isActive = pathname === item.path;

              return (
                <button
                  key={item.id}
                  onClick={() => router.push(item.path)}
                  className={cn(
                    'group relative flex items-center h-8 outline-none focus:outline-none rounded-lg cursor-pointer select-none w-full text-left px-2 text-xs',
                    'hover:bg-secondary/50',
                    isActive && 'bg-primary text-primary-foreground hover:bg-primary',
                    !isActive && 'text-secondary-foreground/80 dark:text-muted-foreground'
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
