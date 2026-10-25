import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://bquenin.dev/",
    title: "qube",
    description: "Notes on agents, tooling and side projects.",
    author: "Bertrand Quenin",
    profile: "https://github.com/bquenin",
    ogImage: "default-og.jpg",
    lang: "en",
    timezone: "America/Los_Angeles",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: { enabled: false },
    search: "pagefind",
  },
  socials: [
    { name: "github",   url: "https://github.com/bquenin" },
    { name: "linkedin", url: "https://www.linkedin.com/in/bquenin/", linkTitle: "qube on LinkedIn" },
    { name: "medium",   url: "https://medium.com/@bquenin" },
  ],
  shareLinks: [
    { name: "whatsapp", url: "https://wa.me/?text=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "x",        url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});