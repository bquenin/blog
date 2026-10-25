#!/usr/bin/env node
/**
 * Import Medium posts into AstroPaper content collection.
 *
 * Usage:
 *   node scripts/import-medium.mjs [--feed <url|file>] [--export <medium-export>/posts]
 *                                  [--out src/content/posts] [--tz America/Los_Angeles]
 *
 * Sources:
 *   - The RSS feed (default https://medium.com/feed/@bquenin) is the primary
 *     source: it decides which posts are imported and provides title, date,
 *     tags, canonical URL and full-size image URLs.
 *   - Optionally, the official Medium export (Settings > Download your
 *     information, the `posts/` folder). When a post's export HTML is
 *     available its body is used instead of the RSS body, because the RSS
 *     drops inline code, embed captions, link cards, subtitles and the
 *     gist ids behind code embeds.
 *
 * Code embeds are resolved to GitHub gists and inlined as fenced code blocks.
 * Gist API responses are cached in .cache/medium-import/. Set GITHUB_TOKEN to
 * raise the GitHub API rate limit (60 requests/hour unauthenticated).
 */
/* eslint-disable no-console -- CLI script */
import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import slugify from "slugify";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// ---------------------------------------------------------------- CLI args
function parseArgs(argv) {
  const args = {
    feed: "https://medium.com/feed/@bquenin",
    export: null,
    out: path.join(ROOT, "src/content/posts"),
    tz: "America/Los_Angeles",
    cache: path.join(ROOT, ".cache/medium-import"),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") continue; // `pnpm import:medium -- --export ...`
    const key = argv[i].replace(/^--/, "");
    if (!(key in args)) throw new Error(`Unknown option ${argv[i]}`);
    args[key] = argv[++i];
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------- helpers
const norm = s =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
const text = el => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

async function readCached(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}
async function writeCached(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function fetchText(url) {
  if (!/^https?:/.test(url)) return fs.readFile(url, "utf8");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- gists
const GIST_RE =
  /gist\.github\.com\/(?:[\w-]+\/)?([0-9a-f]{20,40})(?:\.git)?(?:\.js)?(?:\?file=([^"'&\s]+))?/i;

async function getGist(id) {
  const cacheFile = path.join(args.cache, "gists", `${id}.json`);
  const cached = await readCached(cacheFile);
  if (cached) return cached;
  const headers = {
    "User-Agent": "import-medium",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/gists/${id}`, { headers });
  if (!res.ok) throw new Error(`gist ${id}: HTTP ${res.status}`);
  const data = await res.json();
  const files = [];
  for (const f of Object.values(data.files)) {
    let content = f.content;
    if (f.truncated) content = await fetchText(f.raw_url);
    files.push({ filename: f.filename, language: f.language, content });
  }
  const gist = { id, files };
  await writeCached(cacheFile, gist);
  return gist;
}

/** Medium media iframe -> embed target (gist or other URL). */
async function resolveMediumMedia(mediaUrl) {
  const key = mediaUrl.replace(/[^\w]+/g, "_");
  const cacheFile = path.join(args.cache, "media", `${key}.json`);
  const cached = await readCached(cacheFile);
  if (cached) return cached;
  try {
    const res = await fetch(mediaUrl, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.text();
    const m = res.url.match(GIST_RE) || body.match(GIST_RE);
    const result = m
      ? { gist: m[1], file: m[2] && decodeURIComponent(m[2]) }
      : /medium\.com/.test(new URL(res.url).hostname)
        ? { error: "no gist reference found" }
        : { url: res.url };
    await writeCached(cacheFile, result);
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

const EXT_LANG = {
  go: "go",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  sh: "bash",
  bash: "bash",
  js: "js",
  mjs: "js",
  ts: "ts",
  py: "python",
  toml: "toml",
  mod: "go-mod",
  md: "markdown",
};
function langFromFilename(name, fallback) {
  const base = path.basename(name);
  if (/^dockerfile/i.test(base) || /\.dockerfile$/i.test(base))
    return "dockerfile";
  if (/^makefile$/i.test(base)) return "makefile";
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  return EXT_LANG[ext] ?? (fallback ? fallback.toLowerCase() : "");
}

/** Best-effort language guess for Medium <pre> blocks. */
function guessLang(code) {
  if (/[├└│]──/.test(code)) return "text";
  if (/^\s*[{[]/.test(code)) {
    try {
      JSON.parse(code);
      return "json";
    } catch {
      /* not json */
    }
  }
  if (
    /:=|\bfunc\s|\bpackage\s\w+|err != nil|\bif err\b|^\s*\/\/ /m.test(code)
  )
    return "go";
  if (/^\s*FROM\s+\S+/m.test(code) && /^\s*(RUN|COPY|CMD)\s/m.test(code))
    return "dockerfile";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/im.test(code)) return "sql";
  if (
    /^\s*(\$\s*)?(make|sqlc|docker|go|git|curl|npm|pnpm|brew|cd|export)\b/.test(
      code
    ) &&
    code.trim().split("\n").length <= 5
  )
    return "bash";
  if (/^[\w.-]+:\s*\S*$/m.test(code) && /^\s{2,}[\w.-]+:/m.test(code))
    return "yaml";
  return "";
}

// ---------------------------------------------------------------- images
const CT_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const imageIdFromUrl = url => decodeURIComponent(url.split("/").pop());

async function downloadImage(url, dir) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`image ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const id = imageIdFromUrl(url);
  let base = id.replace(/\*/g, "-").replace(/[^\w.-]+/g, "_");
  const ctExt = CT_EXT[(res.headers.get("content-type") || "").split(";")[0]];
  if (!/\.(jpe?g|png|gif|webp|svg)$/i.test(base))
    base += `.${ctExt ?? "jpg"}`;
  await fs.writeFile(path.join(dir, base), buf);
  return base;
}

// ---------------------------------------------------------------- feed
async function loadFeed() {
  const xml = await fetchText(args.feed);
  const parser = new XMLParser({ ignoreAttributes: false });
  const channel = parser.parse(xml).rss.channel;
  const items = [].concat(channel.item ?? []);
  return items.map(it => {
    const link = String(it.link).split("?")[0];
    const guid = typeof it.guid === "object" ? it.guid["#text"] : it.guid;
    const postId = String(guid).split("/").pop();
    return {
      title: String(it.title).trim(),
      link,
      postId,
      pubDate: new Date(it.pubDate),
      tags: [].concat(it.category ?? []).map(c => String(c).toLowerCase()),
      html: it["content:encoded"],
    };
  });
}

async function loadExport(postId) {
  if (!args.export) return null;
  const files = await fs.readdir(args.export);
  const file = files.find(f => f.endsWith(`-${postId}.html`));
  if (!file) return null;
  const html = await fs.readFile(path.join(args.export, file), "utf8");
  const { document } = parseHTML(html);
  const sections = [
    ...document.querySelectorAll('section[data-field="body"] .section-inner'),
  ];
  const body = sections
    .map((s, i) => (i > 0 ? "<hr>" : "") + s.innerHTML)
    .join("\n");
  return {
    file,
    subtitle: text(document.querySelector('section[data-field="subtitle"]')),
    body,
  };
}

// ---------------------------------------------------------------- convert
function makeTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    hr: "---",
  });
  td.use(gfm);
  td.remove(["script", "style", "iframe", "noscript"]);
  // Medium uses h3/h4 for sections; the page title is the only h1.
  td.addRule("headings", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content, node) => {
      const level = Math.min(6, Math.max(2, Number(node.nodeName[1]) - 1));
      const inner = content.trim().replace(/^\*\*(.+)\*\*$/, "$1");
      return `\n\n${"#".repeat(level)} ${inner}\n\n`;
    },
  });
  td.addRule("fencedPre", {
    filter: node => node.nodeName === "PRE",
    replacement: (_content, node) => {
      const code = node.textContent.replace(/\s+$/, "");
      const lang = node.getAttribute("data-lang") || "";
      const file = node.getAttribute("data-file");
      const ticks = Math.max(3, ...(code.match(/`+/g) ?? []).map(t => t.length + 1));
      const fence = "`".repeat(ticks);
      const meta = [lang, file ? `file=${file}` : ""].filter(Boolean).join(" ");
      return `\n\n${fence}${meta}\n${code}\n${fence}\n\n`;
    },
  });
  td.addRule("codeLink", {
    filter: node =>
      node.nodeName === "CODE" &&
      node.parentNode?.nodeName !== "PRE" &&
      node.querySelector("a"),
    replacement: (_c, node) => {
      const a = node.querySelector("a");
      return `[\`${node.textContent}\`](${a.getAttribute("href")})`;
    },
  });
  td.addRule("figcaption", {
    filter: "figcaption",
    replacement: content => (content.trim() ? `\n\n*${content.trim()}*\n\n` : ""),
  });
  td.addRule("comment", {
    filter: node => node.nodeName === "DIV" && node.hasAttribute("data-todo"),
    replacement: (_c, node) => `\n\n<!-- TODO: ${node.getAttribute("data-todo")} -->\n\n`,
  });
  return td;
}

function firstSentence(s) {
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : s).trim();
}

function pickDescription(paragraphs, subtitle, title) {
  if (/^part\s+\d+\s*:/i.test(subtitle)) return subtitle;
  for (const p of paragraphs) {
    if (!p || p.endsWith(":")) continue;
    if (/^(this article is the|all the code)/i.test(p)) continue;
    const s = firstSentence(p);
    if (s.length >= 40 && s.length <= 160) return s;
    break;
  }
  if (subtitle && !norm(title).includes(norm(subtitle)) && subtitle.split(" ").length >= 4)
    return subtitle;
  const s = firstSentence(paragraphs.find(Boolean) ?? title);
  return s.length <= 160 ? s : s.slice(0, 157).replace(/\s+\S*$/, "") + "…";
}

async function convertPost(item, ctx) {
  const { document } = parseHTML(
    `<!doctype html><html><body>${ctx.bodyHtml}</body></html>`
  );
  const body = document.body;
  const stats = { gists: 0, pre: 0, images: 0, links: 0, todos: [] };

  // Unwrap Medium layout containers so content is a flat list of blocks.
  for (const div of [...body.querySelectorAll("div")]) {
    if (div.classList.contains("graf--mixtapeEmbed")) continue;
    if (div.classList.contains("section-divider")) {
      div.remove();
      continue;
    }
    div.replaceWith(...div.childNodes);
  }

  // Boilerplate: tracking pixel, "originally published" footer.
  body.querySelectorAll('img[src*="medium.com/_/stat"]').forEach(i => i.remove());
  for (const p of [...body.querySelectorAll("p")]) {
    if (/was originally published in .* on Medium/i.test(text(p))) {
      let prev = p.previousElementSibling;
      p.remove();
      if (prev?.nodeName === "HR") prev.remove();
    }
  }
  while (body.firstElementChild?.nodeName === "HR") body.firstElementChild.remove();
  while (body.lastElementChild?.nodeName === "HR") body.lastElementChild.remove();

  // Leading title/subtitle block: drop headings that repeat the title.
  let subtitle = ctx.subtitle || "";
  for (const el of [...body.children]) {
    if (!/^H[1-4]$/.test(el.nodeName)) break;
    const t = text(el);
    if (el.nodeName === "H4" && !subtitle) subtitle = t;
    const a = norm(t);
    const b = norm(item.title);
    if (a === b || a.startsWith(b) || b.startsWith(a)) el.remove();
  }
  ctx.subtitle = subtitle;

  // Medium link cards -> plain links.
  for (const card of [...body.querySelectorAll(".graf--mixtapeEmbed")]) {
    const a = card.querySelector("a[href]");
    const label = text(card.querySelector("strong")) || a?.getAttribute("href");
    const p = document.createElement("p");
    if (a) {
      const link = document.createElement("a");
      link.setAttribute("href", a.getAttribute("href"));
      link.textContent = label;
      p.appendChild(link);
    }
    card.replaceWith(p);
  }

  // <pre> blocks -> fenced code with a guessed language.
  for (const pre of [...body.querySelectorAll("pre")]) {
    pre.querySelectorAll("br").forEach(br => br.replaceWith(document.createTextNode("\n")));
    const code = pre.textContent;
    const np = document.createElement("pre");
    const lang = guessLang(code);
    if (lang) np.setAttribute("data-lang", lang);
    np.textContent = code;
    pre.replaceWith(np);
    stats.pre++;
  }

  // Embeds (export: <figure><script src=gist>, RSS: <iframe><a href=medium media>).
  const embeds = [
    ...[...body.querySelectorAll("figure")].filter(f =>
      f.querySelector("script, iframe")
    ),
    ...[...body.querySelectorAll("iframe")].filter(i => !i.closest("figure")),
  ];
  for (const container of embeds) {
    const caption = text(container.querySelector("figcaption"));
    const iframe =
      container.nodeName === "IFRAME" ? container : container.querySelector("iframe");
    // iframe children are raw text to HTML parsers; Medium RSS puts the
    // media link there (<iframe src=""><a href=".../media/<id>/href">).
    const iframeInner = iframe?.innerHTML.match(/https:\/\/medium\.com\/media\/[^"<\s]+/);
    const src =
      container.querySelector("script")?.getAttribute("src") ||
      iframe?.getAttribute("src") ||
      iframeInner?.[0]?.replace(/&amp;/g, "&") ||
      "";
    let target = null;
    const gm = src.match(GIST_RE);
    if (gm) target = { gist: gm[1], file: gm[2] && decodeURIComponent(gm[2]) };
    else if (/medium\.com\/media\//.test(src)) target = await resolveMediumMedia(src);
    else if (src) target = { url: src };

    const frag = document.createDocumentFragment();
    if (target?.gist) {
      try {
        const gist = await getGist(target.gist);
        const files = target.file
          ? gist.files.filter(f => f.filename === target.file)
          : gist.files;
        for (const f of files) {
          const pre = document.createElement("pre");
          const lang = langFromFilename(f.filename, f.language);
          if (lang) pre.setAttribute("data-lang", lang);
          if (/^[\w.-]+$/.test(f.filename) && !/^gistfile\d/.test(f.filename))
            pre.setAttribute("data-file", f.filename);
          pre.textContent = f.content;
          frag.appendChild(pre);
        }
        stats.gists++;
        if (caption && !files.some(f => f.filename === caption)) {
          const p = document.createElement("p");
          const em = document.createElement("em");
          em.textContent = caption;
          p.appendChild(em);
          frag.appendChild(p);
        }
      } catch (e) {
        target = { error: e.message, gist: target.gist };
      }
    }
    if (!target || target.error) {
      const todo = document.createElement("div");
      const what = `unresolved embed ${src || "(no src)"}${target?.error ? ` (${target.error})` : ""}`;
      todo.setAttribute("data-todo", what.replace(/--/g, "- -"));
      todo.textContent = "TODO"; // non-empty, or turndown's blank rule drops it
      frag.appendChild(todo);
      stats.todos.push(what);
    } else if (target.url) {
      const p = document.createElement("p");
      const a = document.createElement("a");
      a.setAttribute("href", target.url);
      a.textContent = caption || `Embedded content on ${new URL(target.url).hostname}`;
      p.appendChild(a);
      frag.appendChild(p);
      stats.links++;
    }
    container.replaceWith(frag);
  }

  // Images: download next to the post, reference relatively.
  const downloaded = new Map();
  for (const img of [...body.querySelectorAll("img")]) {
    const src = img.getAttribute("src") || "";
    if (!/medium\.com/.test(src)) continue;
    const id = img.getAttribute("data-image-id") || imageIdFromUrl(src);
    let local = downloaded.get(id);
    if (!local) {
      const url = ctx.imageUrls.get(id) ?? src.replace(/\/max\/\d+\//, "/max/1024/");
      try {
        local = await downloadImage(url, ctx.dir);
        downloaded.set(id, local);
        stats.images++;
      } catch (e) {
        stats.todos.push(e.message);
        continue;
      }
    }
    img.setAttribute("src", `./${local}`);
    const cap = text(img.closest("figure")?.querySelector("figcaption"));
    img.setAttribute("alt", img.getAttribute("alt") || cap || "Image");
    if (!ctx.ogImage) ctx.ogImage = `./${local}`;
  }

  // Links to other imported posts -> local URLs.
  for (const a of [...body.querySelectorAll("a[href]")]) {
    const href = a.getAttribute("href");
    const m = href.match(/(?:medium\.com|betterprogramming\.pub)\/.*?([0-9a-f]{10,12})(?:[?#].*)?$/);
    if (m && ctx.slugById.has(m[1])) a.setAttribute("href", `/posts/${ctx.slugById.get(m[1])}/`);
  }

  // Drop empty paragraphs.
  for (const p of [...body.querySelectorAll("p")]) {
    if (!text(p) && !p.querySelector("img")) p.remove();
  }

  const paragraphs = [...body.children]
    .filter(el => el.nodeName === "P")
    .map(el => text(el))
    .filter(s => s && !/^(GitHub - |https?:\/\/)/.test(s));
  ctx.description = pickDescription(paragraphs, ctx.subtitle, item.title);

  // turndown pads list markers to 4 columns ("-   ", "1.  "); tighten them,
  // leaving fenced code untouched.
  let fence = null;
  const out = [];
  for (const line of makeTurndown().turndown(body.innerHTML).split("\n")) {
    const f = line.match(/^(`{3,})/);
    const inCode = fence !== null;
    if (f && (!fence || f[1] === fence)) fence = fence ? null : f[1];
    if (inCode || f) {
      out.push(line);
      continue;
    }
    if (!line.trim() && !out.at(-1)?.trim()) continue; // collapse blank runs
    out.push(
      line.replace(/^(\s*)-\s{3}/, "$1- ").replace(/^(\s*)(\d+\.)\s{2}/, "$1$2 ")
    );
  }
  const md = out.join("\n").trim();
  return { md, stats };
}

// ---------------------------------------------------------------- main
function yamlStr(s) {
  return JSON.stringify(s);
}

async function main() {
  const items = await loadFeed();
  const exports = new Map();
  for (const it of items) exports.set(it.postId, await loadExport(it.postId));

  // Subtitles (export summary, else first leading h4) -> "Part N" suffix for
  // posts whose titles collide once a leading "Build a" is ignored.
  const leadingH4 = html => {
    const m = html.match(/^\s*(?:<h3>.*?<\/h3>)?\s*<h4>(.*?)<\/h4>/s);
    return m ? m[1].replace(/<[^>]+>/g, "") : "";
  };
  for (const it of items) {
    it.subtitle = exports.get(it.postId)?.subtitle || leadingH4(it.html);
  }
  const key = t => norm(t.replace(/^build an?\s+/i, ""));
  const collides = new Set(
    items.filter(it => items.some(o => o !== it && key(o.title) === key(it.title)))
  );
  for (const it of items) {
    const collide = collides.has(it);
    const part = it.subtitle.match(/\bpart\s+(\d+)\b/i);
    if (collide && part && !/\bpart\s+\d+/i.test(it.title))
      it.title = `${it.title} — Part ${part[1]}`;
    it.slug = slugify(it.title, { lower: true, strict: true });
  }
  const slugById = new Map(items.map(it => [it.postId, it.slug]));

  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: args.tz,
  });

  const report = [];
  for (const it of items) {
    const dir = path.join(args.out, it.slug);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    // Full-size image URLs from the RSS, keyed by Medium image id.
    const imageUrls = new Map();
    for (const m of it.html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      const id = imageIdFromUrl(m[1]);
      if (!imageUrls.has(id) || /\/proxy\//.test(imageUrls.get(id)))
        imageUrls.set(id, m[1]);
    }
    const exp = exports.get(it.postId);
    const ctx = {
      dir,
      imageUrls,
      slugById,
      subtitle: it.subtitle,
      bodyHtml: exp?.body ?? it.html,
      ogImage: null,
      description: "",
    };
    const { md, stats } = await convertPost(it, ctx);

    const front = [
      "---",
      `title: ${yamlStr(it.title)}`,
      `pubDatetime: ${it.pubDate.toISOString()}`,
      `description: ${yamlStr(ctx.description)}`,
      "tags:",
      ...it.tags.map(t => `  - ${yamlStr(t)}`),
      `canonicalURL: ${yamlStr(it.link)}`,
      ...(ctx.ogImage ? [`ogImage: ${yamlStr(ctx.ogImage)}`] : []),
      "---",
      "",
      `*Originally published on [Medium](${it.link}) on ${dateFmt.format(it.pubDate)}.*`,
      "",
      md,
      "",
    ].join("\n");
    const file = path.join(dir, "index.md");
    const prettierOpts = (await prettier.resolveConfig(file)) ?? {};
    await fs.writeFile(
      file,
      await prettier.format(front, { ...prettierOpts, filepath: file })
    );
    report.push({
      slug: it.slug,
      source: exp ? "export" : "rss",
      gists: stats.gists,
      pre: stats.pre,
      images: stats.images,
      links: stats.links,
      todos: stats.todos.length,
    });
    for (const t of stats.todos) console.warn(`TODO ${it.slug}: ${t}`);
  }
  console.table(report);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
