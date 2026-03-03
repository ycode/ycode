'use client';

/**
 * Welcome Wizard Page
 *
 * First-run setup experience for Ycode
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSetupStore } from '@/stores/useSetupStore';
import { useAuthSession } from '@/hooks/use-auth-session';
import type { SupabaseConfig } from '@/types';
import {
  connectSupabase,
  runMigrations,
  completeSetup,
  checkEmailConfirmDisabled,
} from '@/lib/api/setup';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend, FieldSeparator,
  FieldSet
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BuilderLoading from '@/components/BuilderLoading';
import { Spinner } from '@/components/ui/spinner';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

function LogoBottomRight() {
  return (
    <div className="pt-12 pb-8 flex items-center justify-center">
    <svg
      className="size-5 fill-current"
      viewBox="0 0 24 24"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        id="Symbols"
        stroke="none"
        strokeWidth="1"
        fill="none"
        fillRule="evenodd"
      >
        <g id="Sidebar" transform="translate(-30.000000, -30.000000)">
          <g id="Ycode">
            <g transform="translate(30.000000, 30.000000)">
              <rect
                id="Rectangle"
                x="0"
                y="0"
                width="24"
                height="24"
              />
              <path
                id="CurrentFill"
                d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                className="fill-current"
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
    </div>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const { currentStep, setStep, setSupabaseConfig, supabaseConfig, markComplete } = useSetupStore();
  const { session, isLoading: isAuthLoading } = useAuthSession();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVercel, setIsVercel] = useState<boolean | null>(null); // null = loading
  const [envVarsConfigured, setEnvVarsConfigured] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);

  // Admin account fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Supabase connection fields (pre-populated from store if available)
  const [anonKey, setAnonKey] = useState(supabaseConfig?.anonKey || '');
  const [serviceRoleKey, setServiceRoleKey] = useState(supabaseConfig?.serviceRoleKey || '');
  const [connectionUrl, setConnectionUrl] = useState(supabaseConfig?.connectionUrl || '');
  const [dbPassword, setDbPassword] = useState(supabaseConfig?.dbPassword || '');

  // Email confirmation setting check
  const [emailConfirmDisabled, setEmailConfirmDisabled] = useState(false);
  const [checkingEmailConfirm, setCheckingEmailConfirm] = useState(false);

  // Ensure dark mode is applied on client-side navigation
  useEffect(() => {
    document.documentElement.classList.add('dark');

    // Cleanup: remove dark class when leaving the page
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, []);

  // Copy to clipboard handler
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const handleCopy = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Check if running on Vercel and if env vars are configured
  // Redirect unauthenticated users to /ycode if setup is already complete
  useEffect(() => {
    if (isAuthLoading) return;

    const checkEnvironment = async () => {
      try {
        const response = await fetch('/ycode/api/setup/status');
        const data = await response.json();

        // If setup is complete, redirect unauthenticated users to /ycode (login screen)
        // Logged-in users can still access this page
        if (data.is_setup_complete && !session) {
          router.push('/ycode');
          return; // Keep showing loading screen during redirect
        }

        setIsVercel(data.is_vercel || false);
        setEnvVarsConfigured(data.is_configured || false);

        // Auto-skip to admin step when credentials are already configured via env vars
        // but setup isn't complete yet (no admin user created)
        if (data.is_configured && !data.is_setup_complete && currentStep === 'welcome') {
          setStep('admin');
          // Skip email confirm check for self-hosted setups (ENABLE_EMAIL_AUTOCONFIRM is set in Docker)
          if (!data.is_vercel) {
            setEmailConfirmDisabled(true);
          }
        }

        setStatusChecked(true);
      } catch (err) {
        console.error('Failed to check environment:', err);
        setIsVercel(false); // Default to local on error
        setStatusChecked(true);
      }
    };
    checkEnvironment();
  }, [currentStep, router, isAuthLoading, session]);

  // Block rendering until checks complete (prevents flash before redirect)
  if (isAuthLoading || !statusChecked) {
    return <BuilderLoading message="Checking setup" />;
  }

  // Step 1: Welcome
  if (currentStep === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 overflow-y-auto py-8">

          <div className="flex-1 flex items-center text-center flex-col gap-1 text-balance">

            <svg
              className="size-10 fill-current absolute animate-out fade-out slide-in-from-bottom-1 duration-700"
              style={{ animationDelay: '2000ms', animationFillMode: 'both' }}
              viewBox="0 0 24 24"
              version="1.1" xmlns="http://www.w3.org/2000/svg"
            >
              <g
                id="Symbols" stroke="none"
                strokeWidth="1" fill="none"
                fillRule="evenodd"
              >
                <g id="Sidebar" transform="translate(-30.000000, -30.000000)">
                  <g id="Ycode">
                    <g transform="translate(30.000000, 30.000000)">
                      <rect
                        id="Rectangle" x="0"
                        y="0" width="24"
                        height="24"
                      />
                      <path
                        id="CurrentFill" d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                        className="fill-current"
                      />
                    </g>
                  </g>
                </g>
              </g>
            </svg>

            <Label
              className="animate-in fade-in slide-in-from-bottom-1 duration-700"
              size="sm"
              style={{ animationDelay: '2500ms', animationFillMode: 'both' }}
            >
              Welcome to Ycode
            </Label>
            <Label
              variant="muted"
              size="sm"
              className="animate-in fade-in slide-in-from-bottom-1 duration-700"
              style={{ animationDelay: '2700ms', animationFillMode: 'both' }}
            >
              Let&apos;s get you set up in just a few steps.
            </Label>

            <div
              className="mt-4 animate-in fade-in slide-in-from-bottom-1 duration-700"
              style={{ animationDelay: '3700ms', animationFillMode: 'both' }}
            >
              <Button onClick={() => setStep('supabase')}>
                Get started
              </Button>
            </div>

          </div>

      </div>
    );
  }

  // Step 2: Connect Supabase
  if (currentStep === 'supabase') {
    // Show loading while checking environment
    if (isVercel === null) {
      return (
        <BuilderLoading message="Detecting environment..." />
      );
    }

    // On Vercel: Show environment variable instructions
    if (isVercel === true) {
      const handleCheckConfig = async () => {
        setLoading(true);
        setError(null);

        try {
          const response = await fetch('/ycode/api/setup/status');
          const data = await response.json();

          if (data.is_configured) {
            setEnvVarsConfigured(true);
            // Go to migration step
            setStep('migrate');
          } else {
            // Show specific error from API if available, otherwise generic message
            if (data.error) {
              setError(data.error);
            } else {
              setError(
                'Environment variables not detected. Please set them in Vercel Dashboard and redeploy.'
              );
            }
          }
        } catch (err) {
          setError('Failed to check configuration');
        } finally {
          setLoading(false);
        }
      };

      return (
        <div className="min-h-screen flex flex-col bg-neutral-950">

          <LogoBottomRight />

          <div className="flex-1 flex flex-col items-center justify-center py-10">

            <div className="grid grid-cols-3 gap-4 w-full max-w-xl">

              <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
                <Label variant="muted">Step 1</Label>
                <Label size="sm">Vercel + Supabase</Label>
              </div>

              <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
                <Label variant="muted">Step 2</Label>
                <Label size="sm">Run migrations</Label>
              </div>

              <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
                <Label variant="muted">Step 3</Label>
                <Label size="sm">Create account</Label>
              </div>

            </div>

            <div className="w-full max-w-xl py-10">

              <FieldGroup className="animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

                {error && (
                  <Alert>
                    <AlertDescription>
                      {error}
                    </AlertDescription>
                  </Alert>
                )}

                <FieldSet>

                  <FieldLegend>Add 4 environment variables in Vercel</FieldLegend>
                  <FieldDescription>Go to <span className="text-white/85">Vercel Dashboard</span> → <span className="text-white/85">Your Project</span> → <span className="text-white/85">Settings</span> → <span className="text-white/85">Environment Variables</span>. Add to all environments (Production, Preview, Development).</FieldDescription>

                  <FieldGroup className="mt-2">

                    <Field>
                      <InputGroup size="sm">
                        <InputGroupInput
                          value="SUPABASE_PUBLISHABLE_KEY" size="sm"
                          readOnly
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => handleCopy('SUPABASE_PUBLISHABLE_KEY', 'anon')}
                          >
                            <Icon name={copiedField === 'anon' ? 'check' : 'copy'} />
                            {copiedField === 'anon' ? 'Copied' : 'Copy'}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldDescription>
                        Find it in <span className="text-white/85">Supabase → Project settings → API keys</span>.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <InputGroup size="sm">
                        <InputGroupInput
                          value="SUPABASE_SECRET_KEY" size="sm"
                          readOnly
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => handleCopy('SUPABASE_SECRET_KEY', 'service')}
                          >
                            <Icon name={copiedField === 'service' ? 'check' : 'copy'} />
                            {copiedField === 'service' ? 'Copied' : 'Copy'}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldDescription>
                        Find it in <span className="text-white/85">Supabase → Project settings → API keys</span>.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <InputGroup size="sm">
                        <InputGroupInput
                          value="SUPABASE_CONNECTION_URL" size="sm"
                          readOnly
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => handleCopy('SUPABASE_CONNECTION_URL', 'connection')}
                          >
                            <Icon name={copiedField === 'connection' ? 'check' : 'copy'} />
                            {copiedField === 'connection' ? 'Copied' : 'Copy'}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldDescription>
                        Find it in <span className="text-white/85">Supabase → Connect → Connection String → Method: Transaction pooler</span>.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <InputGroup size="sm">
                        <InputGroupInput
                          value="SUPABASE_DB_PASSWORD" size="sm"
                          readOnly
                        />
                        <InputGroupAddon align="inline-end">
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => handleCopy('SUPABASE_DB_PASSWORD', 'password')}
                          >
                            <Icon name={copiedField === 'password' ? 'check' : 'copy'} />
                            {copiedField === 'password' ? 'Copied' : 'Copy'}
                          </Button>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldDescription>
                        The database password was created with the project. It can be reset in <span className="text-white/85">Database → Settings</span>.
                      </FieldDescription>
                    </Field>

                  </FieldGroup>

                </FieldSet>

                <FieldSeparator />

                <FieldSet>

                  <FieldLegend>Redeploy your application</FieldLegend>
                  <FieldDescription>Go to <span className="text-white/85">Deployment</span> click on <span className="text-white/85">...</span> and click <span className="text-white/85">Create Deployment</span>. After redeploying, click the button below to check if environment variables are detected.</FieldDescription>

                </FieldSet>

                <FieldSeparator />

                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    onClick={handleCheckConfig}
                    disabled={loading}
                  >
                    {loading ? <Spinner /> : 'Verify configuration'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep('welcome')}
                    disabled={loading}
                  >
                    Go back
                  </Button>
                </div>

              </FieldGroup>

            </div>

          </div>

        </div>
      );
    }

    // Local development: Show form to enter credentials (only if isVercel === false)
    if (isVercel === false) {
      const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const config: SupabaseConfig = {
          anonKey,
          serviceRoleKey,
          connectionUrl,
          dbPassword,
        };

        try {
          const result = await connectSupabase(config);

          if (result.error) {
            setError(result.error);
            return;
          }

          setSupabaseConfig(config);

          // Go to migration step
          setStep('migrate');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Connection failed');
        } finally {
          setLoading(false);
        }
      };

      return (
        <div className="min-h-screen flex flex-col bg-neutral-950">

          <LogoBottomRight />

          <div className="flex-1 flex flex-col items-center justify-center py-6">

            <div className="grid grid-cols-3 gap-4 w-full max-w-xl">

              <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
                <Label variant="muted">Step 1</Label>
                <Label size="sm">Connect Supabase</Label>
              </div>

              <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
                <Label variant="muted">Step 2</Label>
                <Label size="sm">Run migrations</Label>
              </div>

              <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
                <Label variant="muted">Step 3</Label>
                <Label size="sm">Create account</Label>
              </div>

            </div>

            <div className="w-full max-w-xl py-10">

              <form onSubmit={handleSubmit} className="">

                <FieldGroup className="animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>
                  <FieldSet>
                    <FieldGroup className="gap-8">

                      {error && (
                        <Alert variant="destructive">
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}

                      <Field>
                        <FieldLabel htmlFor="anon_key" size="sm">Publishable key</FieldLabel>
                        <Input
                          id="anon_key"
                          name="anon_key"
                          value={anonKey}
                          onChange={(e) => setAnonKey(e.target.value)}
                          required
                          size="sm"
                        />
                        <FieldDescription>
                          Find it in <span className="text-white/85">Supabase → Project settings → API keys</span>.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="service_role_key" size="sm">Secret key</FieldLabel>
                        <Input
                          id="service_role_key"
                          name="service_role_key"
                          value={serviceRoleKey}
                          onChange={(e) => setServiceRoleKey(e.target.value)}
                          required
                          size="sm"
                        />
                        <FieldDescription>
                          Find it in <span className="text-white/85">Supabase → Project settings → API keys</span>.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="connection_url" size="sm">Pooler connection URL</FieldLabel>
                        <Input
                          type="text"
                          id="connection_url"
                          name="connection_url"
                          value={connectionUrl}
                          onChange={(e) => setConnectionUrl(e.target.value)}
                          required
                          size="sm"
                        />
                        <FieldDescription>
                          Find it in <span className="text-white/85">Supabase → Connect → Connection String → Method: Transaction pooler</span>.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="connection_url" size="sm">Database Password</FieldLabel>
                        <Input
                          type="password"
                          id="db_password"
                          name="db_password"
                          value={dbPassword}
                          onChange={(e) => setDbPassword(e.target.value)}
                          required
                          size="sm"
                        />
                        <FieldDescription>
                          The database password was created with the project. It can be reset in <span className="text-white/85">Database → Settings</span>.
                        </FieldDescription>
                      </Field>

                      <div className="flex flex-col gap-2 mt-4">
                        <Button
                          type="submit"
                          disabled={loading}
                        >
                          {loading ? <Spinner /> : 'Continue'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setStep('welcome')}
                          disabled={loading}
                        >
                          Go back
                        </Button>
                      </div>

                    </FieldGroup>
                  </FieldSet>
                </FieldGroup>

              </form>
            </div>

          </div>

        </div>
      );
    }

    // This should never happen, but just in case
    return null;
  }

  // Step 3: Run Migrations (Automatic)
  if (currentStep === 'migrate') {
    const handleMigrate = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await runMigrations();

        if (result.error) {
          setError(result.error);
          return;
        }

        setStep('admin');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Migration failed');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="min-h-screen flex flex-col bg-neutral-950">

        <LogoBottomRight />

        <div className="flex-1 flex flex-col items-center justify-center py-10">

          <div className="grid grid-cols-3 gap-4 w-full max-w-xl">

            <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
              <Label variant="muted">Step 1</Label>
              <Label size="sm">Connect Supabase</Label>
            </div>

            <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
              <Label variant="muted">Step 2</Label>
              <Label size="sm">Run migrations</Label>
            </div>

            <div className="border-t-2 border-white/50 py-4 flex flex-col gap-0.5 opacity-50">
              <Label variant="muted">Step 3</Label>
              <Label size="sm">Create account</Label>
            </div>

          </div>

          <div className="w-full max-w-xl py-10">

            {error && (
              <div className="bg-red-950 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

              <div className="flex-1 flex items-center text-center flex-col gap-2 bg-white/5 py-10 rounded-2xl">
                <Icon name="database" className="size-4 mb-2" />
                <Label size="sm">Setup database</Label>
                <Label
                  variant="muted" size="sm"
                  className="leading-relaxed max-w-96"
                >We&apos;ll automatically create the necessary database tables and storage buckets in your Supabase project.</Label>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleMigrate}
                  disabled={loading}
                >
                  {loading ? <Spinner /> : 'Run migrations'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep('supabase')}
                  disabled={loading}
                >
                  Go back
                </Button>
              </div>

            </div>
          </div>

        </div>

      </div>
    );
  }

  // Step 4: Create Admin Account
  if (currentStep === 'admin') {
    const handleCheckEmailConfirm = async () => {
      setCheckingEmailConfirm(true);
      setError(null);

      try {
        const result = await checkEmailConfirmDisabled();

        if (result.error) {
          setError(result.error);
          return;
        }

        if (!result.autoconfirm) {
          setError('Confirm email setting in Supabase is not disabled.');
          return;
        }

        setEmailConfirmDisabled(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to check setting');
      } finally {
        setCheckingEmailConfirm(false);
      }
    };

    const handleComplete = async () => {
      setLoading(true);
      setError(null);

      // Validate inputs
      if (!email || !password || !confirmPassword) {
        setError('Please fill in all fields');
        setLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }

      try {
        // Dynamically import auth store to avoid SSR issues
        const { useAuthStore } = await import('@/stores/useAuthStore');
        const { signUp } = useAuthStore.getState();

        // Sign up admin user
        const result = await signUp(email, password);

        if (result.error) {
          setError(result.error);
          return;
        }

        // Complete setup
        const setupResult = await completeSetup();

        if (setupResult.error) {
          setError(setupResult.error);
          return;
        }

        markComplete();
        // Redirect to builder (will auto-login since signUp sets session)
        router.push('/ycode');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Setup failed');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="min-h-screen flex flex-col bg-neutral-950">

        <LogoBottomRight />

        <div className="flex-1 flex flex-col items-center justify-center py-10">

        <div className="grid grid-cols-3 gap-4 w-full max-w-xl">

          <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
            <Label variant="muted">Step 1</Label>
            <Label size="sm">Connect Supabase</Label>
          </div>

          <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
            <Label variant="muted">Step 2</Label>
            <Label size="sm">Run migrations</Label>
          </div>

          <div className="border-t-2 border-white py-4 flex flex-col gap-0.5">
            <Label variant="muted">Step 3</Label>
            <Label size="sm">Create account</Label>
          </div>

        </div>

        {!emailConfirmDisabled ? (
          <div className="w-full max-w-xl py-10 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

            <div className="flex-1 flex items-center text-center flex-col gap-4 bg-white/5 py-10 px-6 rounded-2xl">
              <div className="flex flex-col items-center gap-1">
                <Label size="sm">Adjust Supabase authentication settings</Label>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  In your Supabase project, find and disable the setting below.
                </p>
              </div>
              <div className="flex items-center gap-2 bg-white/5 rounded-lg px-4 py-2.5 text-sm text-white/90">
                <span>Authentication</span>
                <span className="text-muted-foreground">→</span>
                <span>Sign In / Providers</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium">Confirm email</span>
              </div>
              <p className="text-xs text-muted-foreground max-w-sm">
                The confirmation email is not needed.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <Button
                onClick={handleCheckEmailConfirm}
                disabled={checkingEmailConfirm}
              >
                {checkingEmailConfirm ? <Spinner /> : 'Confirm email disabled'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('migrate')}
                disabled={checkingEmailConfirm}
              >
                Go back
              </Button>
            </div>

          </div>
        ) : (
          <div className="w-full max-w-xl py-10 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

            <FieldGroup>
              <FieldSet>
                <FieldGroup className="gap-8">

                  {error && (
                    <Alert variant="destructive">
                      <AlertTitle>{error}</AlertTitle>
                    </Alert>
                  )}

                  <Field>
                    <FieldLabel htmlFor="email" size="sm">Email</FieldLabel>
                    <Input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      size="sm"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="password" size="sm">Password</FieldLabel>
                    <Input
                      type="password"
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      size="sm"
                    />
                    <FieldDescription>At least 6 characters</FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="confirmPassword" size="sm">Confirm password</FieldLabel>
                    <Input
                      type="password"
                      id="confirmPassword"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={loading}
                      size="sm"
                    />
                  </Field>

                  <div className="flex flex-col gap-4 mt-2">
                    <Button
                      type="submit"
                      onClick={handleComplete}
                      disabled={loading}
                    >
                      {loading ? <Spinner /> : 'Create account'}
                    </Button>
                    <FieldDescription className="text-center text-[10px] opacity-60">Your user will be stored securely in Supabase Auth.</FieldDescription>
                  </div>

                </FieldGroup>
              </FieldSet>
            </FieldGroup>

          </div>
        )}

      </div>

      </div>
    );
  }

  return null;
}
