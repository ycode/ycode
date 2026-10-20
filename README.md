<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://assets.ycodeapp.com/assets/app13650/Icons/9l3kz_ycode-logo-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://assets.ycodeapp.com/assets/app13650/Icons/arpQnWd8noiOpoMx0rFsCWN6MY0kCgpxPk3zbuzO.svg">
    <img alt="Ycode Logo" src="https://assets.ycodeapp.com/assets/app13650/Icons/arpQnWd8noiOpoMx0rFsCWN6MY0kCgpxPk3zbuzO.svg" width="200">
  </picture>
</p>

## About Ycode

Ycode is a visual website builder and CMS designed for creating and managing websites without writing code. It is available as a self-hosted Open Source project or as a fully managed [Cloud][cloud] service.

## Learning Ycode

Ycode has extensive [documentation][docs]. We actively maintain and improve it, so if something is unclear or incomplete, feel free to open an issue. We welcome any feedback that helps make the docs better.

## Setting Up Ycode Open Source

To self-host Ycode you will need:

- A [GitHub](https://github.com) account
- A [Supabase](https://supabase.com) account
- A [Vercel](https://vercel.com) account

Follow the [installation instructions][install] to get started.

## Connecting AI Assistants (MCP)

Every Ycode project exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at `https://<your-project-domain>/ycode/mcp`. Claude, Claude Code, Cursor, ChatGPT, VS Code, and any other MCP client can read and edit pages, collections, assets, and settings through it.

Self-hosted projects are not listed in the Claude or ChatGPT connector directories, because each install has its own URL. Add your project as a **custom connector** instead:

1. In the builder, open **Settings → MCP** and copy the MCP server URL.
2. In your AI client, add a custom (remote) MCP connector and paste the URL — for example in Claude: **Settings → Connectors → Add custom connector**.
3. Connect, sign in to Ycode, and approve access.

The MCP settings page has step-by-step instructions for each client and lists the connections you have approved so you can revoke them at any time. Clients that connect from the vendor's servers (Claude.ai, ChatGPT) need a publicly reachable HTTPS URL, so deploy your project first.

## Support

We provide official support on [Ycode Cloud][cloud] projects. Community-driven support for the Open Source version is available in [Discord][discord].

## Contributing

Thank you for considering contributing to Ycode! We ask that you review the [contribution guide][contributing] before opening issues or submitting pull requests.

## Code of Conduct

To ensure the Ycode community is welcoming to all, please review and abide by our [Code of Conduct][coc].

## Important Links

- [Ycode Website][cloud]
- [Ycode Documentation][docs]
- [Ycode Discord Community][discord]

[cloud]: https://www.ycode.com
[docs]: https://docs.ycode.com/
[install]: https://docs.ycode.com/docs/getting-started/installation
[discord]: https://discord.gg/xadfw2DV4q
[contributing]: https://github.com/ycode/ycode/blob/main/CONTRIBUTING.md
[coc]: https://github.com/ycode/ycode/blob/main/CODE_OF_CONDUCT.md

## Coursey Creative self-hosted fork

This branch adds an isolated multi-site development platform on one shared database.
See [the milestone report](coursey/MILESTONE-1.md), [authorization contract](coursey/AUTHORIZATION.md),
and [development/deployment runbook](coursey/DEPLOYMENT.md). Paid Ycode Cloud is outside this fork's scope.
The upstream MIT license and notices are retained. This development milestone is not production-ready.
