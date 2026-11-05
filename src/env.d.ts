/// <reference types="astro/client" />

/**
 * Audio assets imported for their URL.
 *
 * `astro/client` declares the image and media types Astro handles natively,
 * and `.m4a` is not among them -- so `import shuffle from '../assets/sfx/
 * shuffle.m4a'` resolved at build time (Vite emits the file and hands back a
 * URL) while reporting "cannot find module" to any type checker. Nothing
 * reported it, because until #115 this repo ran no type checker at all.
 */
declare module '*.m4a' {
  const src: string;
  export default src;
}
