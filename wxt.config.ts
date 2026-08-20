import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",

  modules: [
    '@wxt-dev/module-react',
    '@wxt-dev/auto-icons',
  ],

  autoIcons: {
    baseIconPath: '../public/icon.png',
  },

  manifest: {
    name: "GitHub Get",
    description:
      "Finds the right release artifact for your platform and puts a real download button on every GitHub repository",
    permissions: ["storage", "downloads"],
    host_permissions: ["https://api.github.com/*"],
    action: { default_title: "GitHub Get" },
  },

  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
