export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { patchHtmlResponseStamp, startYcodePublishedAtRefresh } = await import('./lib/stamp-html-response');
  patchHtmlResponseStamp();
  await startYcodePublishedAtRefresh();
}
