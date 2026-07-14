import { defineConfig } from "vite";

// GitHub Pages serves this repo as a project site at
// https://dchantlos.github.io/Badouzi/, so the PRODUCTION build must use that
// sub-path as its base URL (otherwise /style.css, /main.js, /esri-logo.jpg etc.
// resolve to the domain root and 404). The dev server stays at "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/Badouzi/" : "/"
}));
