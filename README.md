# qube

Source for [bquenin.dev](https://bquenin.dev), Bertrand Quenin's blog: notes on agents, tooling and side projects.

Built with [Astro](https://astro.build) on top of the [AstroPaper](https://github.com/satnaing/astro-paper) theme by Sat Naing (MIT, see [LICENSE](LICENSE)).

## Develop

Requires Node.js 22.12+ and pnpm.

```bash
pnpm install
pnpm dev      # dev server on http://localhost:4321
pnpm build    # type check, build to dist/, and generate the Pagefind search index
pnpm preview  # serve dist/
```

Posts live in `src/content/posts/<slug>/index.md`, with their images next to them. The About page is `src/content/pages/about.md`. Site settings are in `astro-paper.config.ts`.

## Re-import Medium posts

`scripts/import-medium.mjs` converts the Medium RSS feed (`https://medium.com/feed/@bquenin`) into posts. It downloads images and inlines GitHub gist code embeds as fenced code blocks.

```bash
pnpm import:medium -- --export ~/Downloads/medium-export-<id>/posts
```

The `--export` option takes the `posts/` folder of Medium's data export (Settings > Security and apps > Download your information) and is strongly recommended. The RSS feed drops inline code, embed captions and subtitles, and its code embeds can only be resolved through `medium.com/media/...`, which Cloudflare blocks for scripts. Without the export, unresolved embeds are left as `<!-- TODO -->` comments.

The importer overwrites the post folders it generates. Gist API responses are cached in `.cache/`. Set `GITHUB_TOKEN` if you hit the GitHub API rate limit.

`pnpm generate:og` regenerates `public/default-og.jpg`.

## Deploy

`.github/workflows/deploy.yml` builds the site and publishes it to GitHub Pages on every push to `main`. `public/CNAME` sets the custom domain.
