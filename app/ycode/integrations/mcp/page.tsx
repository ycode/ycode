'use client';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface McpToken {
  id: string;
  name: string;
  token?: string;
  token_prefix: string;
  mcp_url?: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export default function McpPage() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<McpToken | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [generatedToken, setGeneratedToken] = useState<McpToken | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchTokens();
  }, []);

  const fetchTokens = async () => {
    try {
      const response = await fetch('/ycode/api/mcp-tokens');
      const result = await response.json();
      if (result.data) {
        setTokens(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch MCP tokens:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!newTokenName.trim()) return;

    setIsGenerating(true);
    try {
      const response = await fetch('/ycode/api/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });

      const result = await response.json();
      if (result.data) {
        setGeneratedToken(result.data);
        setShowGenerateDialog(false);
        setShowUrlDialog(true);
        setNewTokenName('');
        fetchTokens();
      }
    } catch (error) {
      console.error('Failed to generate MCP token:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteToken = async () => {
    if (!tokenToDelete) return;

    try {
      await fetch(`/ycode/api/mcp-tokens/${tokenToDelete.id}`, {
        method: 'DELETE',
      });
      setTokens(tokens.filter(t => t.id !== tokenToDelete.id));
    } catch (error) {
      console.error('Failed to delete MCP token:', error);
    } finally {
      setShowDeleteDialog(false);
      setTokenToDelete(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatLastUsed = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return formatDate(dateString);
  };

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">

        <header className="pt-8 pb-3 flex items-center justify-between">
          <span className="text-base font-medium">MCP</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowGenerateDialog(true)}
          >
            Generate MCP URL
          </Button>
        </header>

        <p className="text-sm text-muted-foreground mb-6">
          Connect AI assistants like Claude, Cursor, or Windsurf to your YCode project.
          Generate an MCP URL and paste it into your AI tool&apos;s connector settings.
        </p>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            Loading...
          </div>
        ) : tokens.length > 0 ? (
          <div className="flex flex-col gap-3">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center gap-4 p-4 bg-secondary/20 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <Label className="font-medium">{token.name}</Label>
                    <code className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded font-mono">
                      {token.token_prefix}...
                    </code>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created {formatDate(token.created_at)} · Last used: {formatLastUsed(token.last_used_at)}
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="xs"
                    >
                      <Icon name="more" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        setTokenToDelete(token);
                        setShowDeleteDialog(true);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm border border-dashed rounded-lg">
            No MCP connections yet. Click &ldquo;Generate MCP URL&rdquo; to create one.
          </div>
        )}

        <header className="pt-10 pb-3">
          <span className="text-base font-medium">How to connect</span>
        </header>

        <div className="flex flex-col gap-6 bg-secondary/20 p-6 rounded-lg text-sm">
          <section>
            <h3 className="font-medium mb-2">Claude Desktop</h3>
            <p className="text-muted-foreground">
              Settings &rarr; Connectors &rarr; Add custom connector &rarr; Paste the MCP URL
            </p>
          </section>

          <section>
            <h3 className="font-medium mb-2">Cursor</h3>
            <p className="text-muted-foreground">
              Settings &rarr; MCP &rarr; Add new MCP server &rarr; Type: &ldquo;SSE&rdquo; &rarr; Paste the MCP URL
            </p>
          </section>

          <section>
            <h3 className="font-medium mb-2">Other AI tools</h3>
            <p className="text-muted-foreground">
              Any AI tool that supports the MCP Streamable HTTP transport can connect using the URL.
              No API key is needed — the URL contains the authentication token.
            </p>
          </section>
        </div>

        {/* Generate Dialog */}
        <Dialog
          open={showGenerateDialog}
          onOpenChange={setShowGenerateDialog}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate MCP URL</DialogTitle>
              <DialogDescription>
                Create a unique MCP URL for connecting an AI assistant to your YCode project.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="token-name">Connection name</Label>
              <Input
                id="token-name"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="e.g. Claude Desktop, Cursor"
                className="mt-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleGenerateToken();
                }}
              />
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowGenerateDialog(false);
                  setNewTokenName('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleGenerateToken}
                disabled={!newTokenName.trim() || isGenerating}
              >
                {isGenerating ? 'Generating...' : 'Generate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* URL Display Dialog */}
        <Dialog
          open={showUrlDialog}
          onOpenChange={setShowUrlDialog}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Your MCP URL</DialogTitle>
              <DialogDescription>
                Copy this URL and paste it into your AI tool. This URL will only be shown once.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {generatedToken?.mcp_url && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-secondary px-3 py-2.5 rounded-lg font-mono break-all select-all">
                    {generatedToken.mcp_url}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyToClipboard(generatedToken.mcp_url!)}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                Keep this URL private. Anyone with this URL can access your YCode project through MCP.
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setShowUrlDialog(false);
                  setGeneratedToken(null);
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          title="Delete MCP connection"
          description={`Are you sure you want to delete "${tokenToDelete?.name}"? AI tools using this URL will no longer be able to connect.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteToken}
          confirmVariant="destructive"
        />
      </div>
    </div>
  );
}
