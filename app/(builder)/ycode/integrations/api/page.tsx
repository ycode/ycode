'use client';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  api_key?: string; // Only present when newly created
  last_used_at: string | null;
  created_at: string;
}

export default function ApiPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<ApiKey | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlCopied, setBaseUrlCopied] = useState(false);

  // Fetch API keys on mount
  useEffect(() => {
    fetchApiKeys();
  }, []);

  // Read the origin after mount so the server render doesn't mismatch
  useEffect(() => {
    setBaseUrl(`${window.location.origin}/ycode/api/v1`);
  }, []);

  const fetchApiKeys = async () => {
    try {
      const response = await fetch('/ycode/api/api-keys');
      const result = await response.json();
      if (result.data) {
        setApiKeys(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) return;

    setIsGenerating(true);
    try {
      const response = await fetch('/ycode/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      const result = await response.json();
      if (result.data) {
        setGeneratedKey(result.data);
        setShowGenerateDialog(false);
        setShowKeyDialog(true);
        setNewKeyName('');
        // Refresh the list
        fetchApiKeys();
      }
    } catch (error) {
      console.error('Failed to generate API key:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!keyToDelete) return;

    try {
      await fetch(`/ycode/api/api-keys/${keyToDelete.id}`, {
        method: 'DELETE',
      });
      setApiKeys(apiKeys.filter(k => k.id !== keyToDelete.id));
    } catch (error) {
      console.error('Failed to delete API key:', error);
    } finally {
      setShowDeleteDialog(false);
      setKeyToDelete(null);
    }
  };

  const copyToClipboard = async (
    text: string,
    setIsCopied: (value: boolean) => void = setCopied
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
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

        <header className="pt-8 pb-6 flex items-center justify-between">
          <span className="text-base font-medium">Ycode API</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowGenerateDialog(true)}
          >
            Generate API key
          </Button>
        </header>

        <p className="text-sm text-muted-foreground mb-6">
          Manage API keys for accessing your site&apos;s public API.
        </p>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            Loading...
          </div>
        ) : apiKeys.length > 0 ? (
          <div className="flex flex-col gap-3">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center gap-4 p-4 bg-secondary/20 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <Label className="font-medium">{key.name}</Label>
                    <code className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded font-mono">
                      {key.key_prefix}...
                    </code>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created {formatDate(key.created_at)} · Last used: {formatLastUsed(key.last_used_at)}
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
                        setKeyToDelete(key);
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
            No API keys yet. Click &ldquo;Generate API key&rdquo; to create one.
          </div>
        )}

        <header className="pt-10 pb-3">
          <span className="text-base font-medium">API Documentation</span>
        </header>

        <div className="flex flex-col gap-8 bg-secondary/20 p-8 rounded-lg text-sm">

          {/* Base URL */}
          <section>
            <h3 className="font-medium mb-2">Base URL</h3>
            <p className="text-muted-foreground mb-3">
              Send requests to your site&apos;s domain. All endpoint paths below are relative to this URL. Each API key only works on the site it was created for.
            </p>
            <div className="flex items-center gap-2 bg-secondary p-3 rounded-lg">
              <code className="flex-1 text-xs font-mono break-all">
                {baseUrl || '/ycode/api/v1'}
              </code>
              <Button
                variant="secondary"
                size="xs"
                disabled={!baseUrl}
                onClick={() => copyToClipboard(baseUrl, setBaseUrlCopied)}
              >
                <Icon name={baseUrlCopied ? 'check' : 'copy'} />
                {baseUrlCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </section>

          {/* Authentication */}
          <section>
            <h3 className="font-medium mb-2">Authentication</h3>
            <p className="text-muted-foreground mb-3">
              All API requests require a valid API key passed in the <code className="text-xs bg-secondary px-1 py-0.5 rounded">Authorization</code> header:
            </p>
            <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`Authorization: Bearer YOUR_API_KEY`}
            </pre>
          </section>

          {/* Endpoints */}
          <section>
            <h3 className="font-medium mb-2">Endpoints</h3>
            <div className="space-y-4">

              <div>
                <h4 className="text-muted-foreground mb-1">Collections</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /collections</div>
                  <div><span className="text-green-500">GET</span> /collections/{'{collection_id}'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-muted-foreground mb-1">Collection Items</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /collections/{'{collection_id}'}/items</div>
                  <div><span className="text-blue-500">POST</span> /collections/{'{collection_id}'}/items</div>
                  <div><span className="text-green-500">GET</span> /collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                  <div><span className="text-yellow-500">PUT</span> /collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                  <div><span className="text-yellow-500">PATCH</span> /collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                  <div><span className="text-red-500">DELETE</span> /collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-muted-foreground mb-1">Forms</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /forms</div>
                  <div><span className="text-green-500">GET</span> /forms/{'{form_id}'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-muted-foreground mb-1">Form Submissions</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /forms/{'{form_id}'}/submissions</div>
                  <div><span className="text-blue-500">POST</span> /forms/{'{form_id}'}/submissions</div>
                  <div><span className="text-yellow-500">PATCH</span> /forms/{'{form_id}'}/submissions/{'{submission_id}'}</div>
                  <div><span className="text-red-500">DELETE</span> /forms/{'{form_id}'}/submissions/{'{submission_id}'}</div>
                </div>
              </div>

            </div>
          </section>

          {/* Collections API */}
          <section>
            <h3 className="font-medium mb-2">Collections API</h3>
            <p className="text-muted-foreground mb-3">
              Items are returned with their field values. Reference fields include linked item data.
            </p>

            <div className="space-y-4">
              <div>
                <div className="font-medium text-xs mb-2">List Items</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Supports pagination with <code className="bg-secondary px-1 py-0.5 rounded">page</code> and <code className="bg-secondary px-1 py-0.5 rounded">per_page</code> (max 100).
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /collections/{collection_id}/items?page=1&per_page=50`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Create Item</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Pass field values using each field&apos;s <code className="bg-secondary px-1 py-0.5 rounded">slug</code> (from <code className="bg-secondary px-1 py-0.5 rounded">GET /collections/{'{collection_id}'}</code>) as keys. Keys that don&apos;t match a field are ignored. For reference fields, pass the referenced item&apos;s <code className="bg-secondary px-1 py-0.5 rounded">_id</code> (UUID).
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`POST /collections/{collection_id}/items
Content-Type: application/json

{
  "name": "My Blog Post",
  "slug": "my-blog-post",
  "author": "550e8400-e29b-41d4-a716-446655440000"
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Update Item</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Use <code className="bg-secondary px-1 py-0.5 rounded">PUT</code> for full replacement or <code className="bg-secondary px-1 py-0.5 rounded">PATCH</code> for partial updates.
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`PATCH /collections/{collection_id}/items/{item_id}
Content-Type: application/json

{
  "name": "Updated Title"
}`}
                </pre>
              </div>
            </div>
          </section>

          {/* Response Format */}
          <section>
            <h3 className="font-medium mb-2">Response Format</h3>
            <p className="text-muted-foreground mb-3">
              Items include system fields (<code className="text-xs bg-secondary px-1 py-0.5 rounded">_id</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">ID</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">Created Date</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">Updated Date</code>) plus all collection field values:
            </p>
            <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`{
  "_id": "550e8400-e29b-41d4-a716-446655440000",
  "ID": 1,
  "Name": "My Blog Post",
  "Slug": "my-blog-post",
  "Created Date": "2026-01-05T10:00:00.000Z",
  "Updated Date": "2026-01-05T12:30:00.000Z",
  "Author": { "_id": "...", "Name": "John Doe" }
}`}
            </pre>
          </section>

          {/* Protected Fields */}
          <section>
            <h3 className="font-medium mb-2">Protected Fields</h3>
            <p className="text-muted-foreground mb-3">
              These auto-generated fields cannot be set or modified via the API:
            </p>
            <div className="bg-secondary p-3 rounded-lg text-xs space-y-2">
              <div><code className="text-blue-400">ID</code> - Auto-incrementing number, assigned on creation</div>
              <div><code className="text-blue-400">Created Date</code> - Set automatically when item is created</div>
              <div><code className="text-blue-400">Updated Date</code> - Updated automatically on every change</div>
            </div>
          </section>

          {/* Forms API */}
          <section>
            <h3 className="font-medium mb-2">Forms API</h3>
            <p className="text-muted-foreground mb-3">
              Access form submissions programmatically. Forms are identified by their <code className="text-xs bg-secondary px-1 py-0.5 rounded">form_id</code> (set in the form element settings).
            </p>

            <div className="space-y-4">
              <div>
                <div className="font-medium text-xs mb-2">List All Forms</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /forms

// Response:
{
  "forms": [
    {
      "id": "contact-form",
      "submissionCount": 42,
      "newCount": 5,
      "latestSubmission": "2026-01-29T10:30:00.000Z"
    }
  ]
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Get Form Details</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /forms/{form_id}

// Response:
{
  "id": "contact-form",
  "submissionCount": 42,
  "statusCounts": {
    "new": 5,
    "read": 30,
    "archived": 7,
    "spam": 0
  },
  "latestSubmission": "2026-01-29T10:30:00.000Z"
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">List Submissions</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Supports pagination and status filtering.
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /forms/{form_id}/submissions?page=1&per_page=50&status=new

// Response:
{
  "submissions": [
    {
      "id": "uuid",
      "formId": "contact-form",
      "payload": { "name": "John", "email": "john@example.com" },
      "metadata": { "user_agent": "...", "referrer": "..." },
      "status": "new",
      "createdAt": "2026-01-29T10:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "perPage": 50, "total": 42 }
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Create Submission</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Submit form data programmatically (e.g., from external frontends or integrations).
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`POST /forms/{form_id}/submissions
Content-Type: application/json

{
  "payload": {
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello!"
  },
  "metadata": {
    "page_url": "/contact"
  }
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Update Submission Status</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`PATCH /forms/{form_id}/submissions/{submission_id}
Content-Type: application/json

{
  "status": "read"  // new, read, archived, spam
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Delete Submission</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`DELETE /forms/{form_id}/submissions/{submission_id}

// Returns 204 No Content on success`}
                </pre>
              </div>
            </div>
          </section>

          {/* Error Responses */}
          <section>
            <h3 className="font-medium mb-2">Error Responses</h3>
            <p className="text-muted-foreground mb-3">
              Errors return a JSON object with <code className="text-xs bg-secondary px-1 py-0.5 rounded">error</code> and <code className="text-xs bg-secondary px-1 py-0.5 rounded">code</code> fields:
            </p>
            <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`{
  "error": "Collection not found",
  "code": "NOT_FOUND"
}`}
            </pre>
            <div className="mt-3 text-xs text-muted-foreground space-y-1">
              <div><code className="text-yellow-400">401</code> - Invalid or missing API key</div>
              <div><code className="text-yellow-400">404</code> - Collection or item not found</div>
              <div><code className="text-yellow-400">400</code> - Invalid request body</div>
              <div><code className="text-yellow-400">500</code> - Internal server error</div>
            </div>
          </section>

        </div>

      </div>

      {/* Generate API Key Dialog */}
      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API key</DialogTitle>
            <DialogDescription>
              Create a new API key for accessing your site&apos;s public API.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <FieldDescription>
                A descriptive name to identify this key (e.g., &ldquo;Production&rdquo;, &ldquo;CI/CD&rdquo;)
              </FieldDescription>
              <Input
                id="key-name"
                placeholder="My API Key"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newKeyName.trim()) {
                    handleGenerateKey();
                  }
                }}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setShowGenerateDialog(false);
                setNewKeyName('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerateKey}
              disabled={!newKeyName.trim() || isGenerating}
            >
              {isGenerating ? 'Generating...' : 'Generate key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Generated Key Dialog */}
      <Dialog
        open={showKeyDialog} onOpenChange={(open) => {
          if (!open) {
            setShowKeyDialog(false);
            setGeneratedKey(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key generated</DialogTitle>
            <DialogDescription>
              Copy your API key now. You won&apos;t be able to see it again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="p-4 bg-secondary rounded-lg">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono break-all">
                  {generatedKey?.api_key}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => generatedKey?.api_key && copyToClipboard(generatedKey.api_key)}
                >
                  {copied ? (
                    <>
                      <Icon name="check" className="size-3.5 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Icon name="copy" className="size-3.5 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <strong>Important:</strong> Store this key securely. For security reasons, we can&apos;t show it again.
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setShowKeyDialog(false);
                setGeneratedKey(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete API key?"
        description={`This will permanently delete the API key "${keyToDelete?.name}". Any applications using this key will no longer be able to access your API.`}
        confirmLabel="Delete key"
        cancelLabel="Cancel"
        confirmVariant="destructive"
        onConfirm={handleDeleteKey}
        onCancel={() => {
          setShowDeleteDialog(false);
          setKeyToDelete(null);
        }}
      />
    </div>
  );
}
