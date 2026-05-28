/**
 * GitHub-repo writer — pure REST API implementation.
 *
 * Pushes exported files to a GitHub repository using the Git Data API,
 * with no dependency on the `git` binary or any npm packages. This lets
 * the writer run in serverless environments (Vercel, Cloudflare Workers)
 * where `git` is unavailable.
 *
 * Flow:
 *   1. Resolve the branch's current HEAD commit + tree (or detect that
 *      the branch / repo is empty).
 *   2. Create a blob for every output file via POST /git/blobs.
 *   3. Create a root tree that contains exactly the exported files
 *      (previous tree content is NOT carried forward, so deletions are
 *      reflected — matching the old clone-wipe-commit behavior).
 *   4. Create a commit pointing at that tree.
 *   5. Fast-forward the branch ref (or create it if new).
 */

import type { ExportConfig } from '../types'
import type { OutputFile, Writer } from './types'

const GITHUB_API = 'https://api.github.com'

const GITHUB_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const GITHUB_BRANCH_RE = /^[A-Za-z0-9._/-]+$/
const GITHUB_TOKEN_RE = /^[A-Za-z0-9_.=-]+$/

export async function createGithubWriter(config: ExportConfig): Promise<Writer> {
  if (!GITHUB_REPO_RE.test(config.githubRepo)) {
    throw new Error('GitHub export selected but `githubRepo` must look like "owner/repo"')
  }
  if (!GITHUB_BRANCH_RE.test(config.githubBranch)) {
    throw new Error('GitHub export selected but `githubBranch` has invalid characters')
  }
  if (!GITHUB_TOKEN_RE.test(config.githubToken)) {
    throw new Error('GitHub export selected but `githubToken` looks malformed')
  }

  return {
    name: 'github',
    async flush(files) {
      return pushViaApi(config, files)
    },
  }
}

// ---------------------------------------------------------------------------
// Core push logic
// ---------------------------------------------------------------------------

async function pushViaApi(config: ExportConfig, files: OutputFile[]): Promise<number> {
  const { githubRepo: repo, githubBranch: branch, githubToken: token } = config
  const authorName = config.githubAuthorName.trim() || 'Ycode Static Export'
  const authorEmail = config.githubAuthorEmail.trim() || 'static-export@ycode.local'

  const headers = apiHeaders(token)

  // 1. Resolve current branch state
  let branchState = await getBranchState(repo, branch, headers)

  // 1a. Bootstrap empty repos. The Git Data API (blobs/trees/commits)
  // refuses to write to a repo with unborn HEAD and returns 409
  // "Git Repository is empty". The Contents API can create the first
  // commit and initialize the branch in one call, after which the rest
  // of the flow works normally. The placeholder file is overwritten by
  // the real tree on the next step (createTree replaces all paths).
  if (!branchState.exists) {
    await bootstrapEmptyRepo(repo, branch, authorName, authorEmail, headers)
    branchState = await getBranchState(repo, branch, headers)
    if (!branchState.exists || !branchState.commitSha) {
      throw new Error('Failed to bootstrap empty GitHub repository — branch ref still missing after Contents-API init')
    }
  }

  // 2. Create blobs for every file
  const treeEntries: TreeEntry[] = await Promise.all(
    files.map(async (f) => {
      const sha = await createBlob(repo, f, headers)
      return {
        path: f.key,
        mode: '100644' as const,
        type: 'blob' as const,
        sha,
      }
    }),
  )

  // 3. Create a brand-new root tree (no base_tree — wipes previous content)
  const treeSha = await createTree(repo, treeEntries, headers)

  // 4. Create the commit
  const message =
    `Static export — ${files.length} file${files.length === 1 ? '' : 's'} — ` +
    new Date().toISOString()

  const author = { name: authorName, email: authorEmail, date: new Date().toISOString() }
  const parents = branchState.commitSha ? [branchState.commitSha] : []
  const commitSha = await createCommit(repo, message, treeSha, parents, author, headers)

  // 5. Update or create the branch ref
  if (branchState.exists) {
    await updateRef(repo, branch, commitSha, headers)
  } else {
    await createRef(repo, branch, commitSha, headers)
  }

  return files.length
}

// ---------------------------------------------------------------------------
// Branch state
// ---------------------------------------------------------------------------

interface BranchState {
  exists: boolean
  commitSha: string | null
}

async function getBranchState(
  repo: string,
  branch: string,
  headers: HeadersInit,
): Promise<BranchState> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`, {
    headers,
  })

  // 404: branch doesn't exist yet (repo has other branches, just not this one).
  // 409: repo is empty / unborn HEAD (`Git Repository is empty`) — no refs at all.
  // Both cases fall through to the same create-initial-commit + createRef path.
  if (res.status === 404 || res.status === 409) {
    return { exists: false, commitSha: null }
  }

  if (!res.ok) {
    throw await apiError('Failed to get branch ref', res)
  }

  const body = (await res.json()) as { object: { sha: string } }
  return { exists: true, commitSha: body.object.sha }
}

// ---------------------------------------------------------------------------
// Blob creation
// ---------------------------------------------------------------------------

async function createBlob(
  repo: string,
  file: OutputFile,
  headers: HeadersInit,
): Promise<string> {
  const isBuffer = Buffer.isBuffer(file.body)
  const payload = isBuffer
    ? { content: (file.body as Buffer).toString('base64'), encoding: 'base64' }
    : { content: file.body as string, encoding: 'utf-8' }

  const res = await fetch(`${GITHUB_API}/repos/${repo}/git/blobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw await apiError(`Failed to create blob for "${file.key}"`, res)
  }

  const body = (await res.json()) as { sha: string }
  return body.sha
}

// ---------------------------------------------------------------------------
// Tree creation
// ---------------------------------------------------------------------------

interface TreeEntry {
  path: string
  mode: '100644'
  type: 'blob'
  sha: string
}

async function createTree(
  repo: string,
  tree: TreeEntry[],
  headers: HeadersInit,
): Promise<string> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tree }),
  })

  if (!res.ok) {
    throw await apiError('Failed to create tree', res)
  }

  const body = (await res.json()) as { sha: string }
  return body.sha
}

// ---------------------------------------------------------------------------
// Commit creation
// ---------------------------------------------------------------------------

interface CommitAuthor {
  name: string
  email: string
  date: string
}

async function createCommit(
  repo: string,
  message: string,
  treeSha: string,
  parents: string[],
  author: CommitAuthor,
  headers: HeadersInit,
): Promise<string> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, tree: treeSha, parents, author, committer: author }),
  })

  if (!res.ok) {
    throw await apiError('Failed to create commit', res)
  }

  const body = (await res.json()) as { sha: string }
  return body.sha
}

// ---------------------------------------------------------------------------
// Ref management
// ---------------------------------------------------------------------------

async function updateRef(
  repo: string,
  branch: string,
  sha: string,
  headers: HeadersInit,
): Promise<void> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha, force: true }),
  })

  if (!res.ok) {
    throw await apiError('Failed to update branch ref', res)
  }
}

async function createRef(
  repo: string,
  branch: string,
  sha: string,
  headers: HeadersInit,
): Promise<void> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  })

  if (!res.ok) {
    throw await apiError('Failed to create branch ref', res)
  }
}

// ---------------------------------------------------------------------------
// Empty-repo bootstrap
// ---------------------------------------------------------------------------

/**
 * Create an initial commit on an empty repo via the Contents API so the
 * Git Data API (blobs/trees/commits) becomes usable. Writes a single
 * tiny placeholder file (`.ycode-init`) which the next push immediately
 * replaces when `createTree` runs without a `base_tree`.
 */
async function bootstrapEmptyRepo(
  repo: string,
  branch: string,
  authorName: string,
  authorEmail: string,
  headers: HeadersInit,
): Promise<void> {
  const author = { name: authorName, email: authorEmail }
  // base64 of "Ycode static export — initializing repository\n"
  const content = Buffer.from('Ycode static export — initializing repository\n', 'utf-8').toString('base64')

  const res = await fetch(
    `${GITHUB_API}/repos/${repo}/contents/.ycode-init`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: 'Initialize repository for Ycode static export',
        content,
        branch,
        author,
        committer: author,
      }),
    },
  )

  if (!res.ok) {
    throw await apiError('Failed to initialize empty repository', res)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function apiError(context: string, res: Response): Promise<Error> {
  let detail: string
  try {
    const body = (await res.json()) as { message?: string }
    detail = body.message ?? res.statusText
  } catch {
    detail = res.statusText
  }
  return new Error(`${context}: ${res.status} ${detail}`)
}
