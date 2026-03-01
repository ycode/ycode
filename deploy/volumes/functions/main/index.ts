import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

serve(async () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
